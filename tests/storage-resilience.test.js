import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => ({ id: 'user-a' })),
}));

import {
  STORAGE_ERROR,
  classifyStorageError,
  getStorageItem,
  isQuotaExceededError,
  isStorageAccessError,
  isStorageAvailable,
  listStorageKeys,
  probeStorageWrite,
  readJSONValue,
  readStorageJSON,
  removeStorageKey,
  resetStorageAvailabilityCache,
  resetVolatileStorageForTest,
  hasVolatileStorageKey,
  writeJSON,
} from '../src/safe-storage.js';
import { STORAGE_KEY } from '../src/constants.js';
import {
  buildSessionRecord,
  persistSessionRecord,
  persistWorkoutCompletion,
} from '../src/storage.js';
import {
  clearActiveSessionCheckpoint,
  isCheckpointStorageAvailable,
  saveActiveSessionCheckpoint,
} from '../src/session-checkpoint.js';

describe('safe-storage adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageAvailabilityCache();
    resetVolatileStorageForTest();
  });

  it('reads and writes JSON with structured success', () => {
    const writeResult = writeJSON('ringReadyTestKey', { count: 2 });
    expect(writeResult.ok).toBe(true);

    const readResult = readStorageJSON('ringReadyTestKey', {});
    expect(readResult.ok).toBe(true);
    expect(readResult.value).toEqual({ count: 2 });
    expect(readJSONValue('ringReadyTestKey', {})).toEqual({ count: 2 });
  });

  it('returns fallback when JSON parse fails', () => {
    localStorage.setItem('ringReadyBrokenJson', '{not-json');
    const result = readStorageJSON('ringReadyBrokenJson', { safe: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(STORAGE_ERROR.PARSE);
    expect(result.value).toEqual({ safe: true });
  });

  it('classifies quota exceeded errors', () => {
    const error = new DOMException('quota', 'QuotaExceededError');
    expect(isQuotaExceededError(error)).toBe(true);
    expect(classifyStorageError(error)).toBe(STORAGE_ERROR.QUOTA_EXCEEDED);
  });

  it('classifies SecurityError as unavailable, not quota', () => {
    const error = new DOMException('Access to storage is not allowed', 'SecurityError');
    expect(isStorageAccessError(error)).toBe(true);
    expect(isQuotaExceededError(error)).toBe(false);
    expect(classifyStorageError(error)).toBe(STORAGE_ERROR.UNAVAILABLE);
  });

  it('survives setItem throwing QuotaExceededError without crashing callers', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function quotaThrowingSetItem(key, value) {
      if (String(key).startsWith('ringReady')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      const result = writeJSON('ringReadyQuotaTest', { blocked: true });
      expect(result.ok).toBe(true);
      expect(result.persisted).toBe(false);
      expect(result.volatile).toBe(true);
      expect(result.code).toBe(STORAGE_ERROR.QUOTA_EXCEEDED);
      expect(readJSONValue('ringReadyQuotaTest', 'fallback')).toEqual({ blocked: true });
      expect(hasVolatileStorageKey('ringReadyQuotaTest')).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('survives blocked localStorage getter with structured unavailable result', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access to storage is not allowed', 'SecurityError');
      },
    });

    try {
      const result = getStorageItem('ringReadyBlocked', 'fallback');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(STORAGE_ERROR.UNAVAILABLE);
      expect(result.value).toBe('fallback');
      expect(probeStorageWrite().ok).toBe(false);
      expect(isStorageAvailable()).toBe(false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        delete globalThis.localStorage;
      }
    }
  });

  it('lists keys by prefix and removes them safely', () => {
    writeJSON('ringReadyPrefix:a', { a: 1 });
    writeJSON('ringReadyPrefix:b', { b: 2 });
    writeJSON('other:key', { c: 3 });

    const listed = listStorageKeys('ringReadyPrefix:');
    expect(listed.ok).toBe(true);
    expect(listed.value.sort()).toEqual(['ringReadyPrefix:a', 'ringReadyPrefix:b']);

    expect(removeStorageKey('ringReadyPrefix:a').ok).toBe(true);
    expect(getStorageItem('ringReadyPrefix:a').value).toBeNull();
  });

  it('probeStorageWrite succeeds on a healthy store', () => {
    expect(probeStorageWrite().ok).toBe(true);
    expect(isStorageAvailable()).toBe(true);
  });

  it('keeps volatile values readable when every persistent write fails', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).startsWith('ringReady')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      const writeResult = writeJSON('ringReadyVolatileOnly', { complete: true });
      expect(writeResult.ok).toBe(true);
      expect(writeResult.persisted).toBe(false);
      expect(writeResult.volatile).toBe(true);
      expect(localStorage.getItem('ringReadyVolatileOnly')).toBeNull();
      expect(readJSONValue('ringReadyVolatileOnly', null)).toEqual({ complete: true });
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('does not treat volatile cache as checkpoint persistence availability', () => {
    writeJSON('ringReadyActiveSession:user-a', { version: 1 }, { persistentOnly: true });
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access to storage is not allowed', 'SecurityError');
      },
    });

    try {
      writeJSON('ringReadyVolatileCheckpointProbe', { cached: true });
      expect(isCheckpointStorageAvailable()).toBe(false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        delete globalThis.localStorage;
      }
      resetStorageAvailabilityCache();
      resetVolatileStorageForTest();
    }
  });
});

describe('session checkpoint storage integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports checkpoint storage availability via probe', () => {
    expect(isCheckpointStorageAvailable()).toBe(true);

    const checkpoint = saveActiveSessionCheckpoint(
      { reps: 4, rest: 60, maxHR: 180, targetPct: 90, workoutContext: null },
      { phase: 'resting', currentRep: 1, seconds: 10, data: [], pendingRep: null, awaitingModal: false, capturedSprintHR: null, capturedRestHR: null },
    );
    expect(checkpoint?.state.currentRep).toBe(1);
    expect(checkpoint?.storageWriteFailed).not.toBe(true);
  });

  it('marks checkpoint write failure without throwing when storage rejects writes', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).includes('ringReadyActiveSession')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      const checkpoint = saveActiveSessionCheckpoint(
        { reps: 4, rest: 60, maxHR: 180, targetPct: 90, workoutContext: null },
        { phase: 'resting', currentRep: 2, seconds: 5, data: [], pendingRep: null, awaitingModal: false, capturedSprintHR: null, capturedRestHR: null },
      );
      expect(checkpoint?.storageWriteFailed).toBe(true);
      expect(checkpoint?.storageWriteCode).toBe(STORAGE_ERROR.QUOTA_EXCEEDED);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('removes user-scoped checkpoint keys when cleared', () => {
    saveActiveSessionCheckpoint(
      { reps: 4, rest: 60, maxHR: 180, targetPct: 90, workoutContext: null },
      { phase: 'idle', currentRep: 0, seconds: 0, data: [], pendingRep: null, awaitingModal: false, capturedSprintHR: null, capturedRestHR: null },
    );

    expect(localStorage.getItem('ringReadyActiveSession:user-a')).toBeTruthy();
    clearActiveSessionCheckpoint('user-a');
    expect(localStorage.getItem('ringReadyActiveSession:user-a')).toBeNull();
  });
});

describe('stable session record identity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the same session record when local cache write fails', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).includes(STORAGE_KEY)) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      const cfg = { reps: 4, rest: 60, maxHR: 180, targetPct: 90, workoutContext: null };
      const data = [{ sprintHR: 170, restHR: 120, drop: 50, suspicious: false }];
      const record = buildSessionRecord(cfg, data);
      const persisted = persistSessionRecord(record);
      expect(persisted.record.id).toBe(record.id);
      expect(persisted.localCacheOk).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('cloud-authoritative completion record', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns finalized record even when local cache write fails', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).includes('ringReadyWorkoutCompletions')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      const record = {
        id: 'workout-1',
        workoutContext: { weekIndex: 1, workoutIndex: 2 },
        cfg: { workoutContext: { weekIndex: 1, workoutIndex: 2 } },
        workoutLog: { totalMinutes: 30 },
      };
      const result = persistWorkoutCompletion(record);
      expect(result.record?.id).toBe('workout-1');
      expect(result.record?.completionKey).toBe('1:2');
      expect(result.localCacheOk).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
