import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/build-info.js', () => ({
  APP_BUILD_SHA: 'abc1234',
  PROOF_CONTRACT_VERSION: 2,
  formatBuildLabel: () => 'abc1234',
}));

import {
  STORAGE_ERROR,
  getStorageDiagnostics,
  resetStorageAvailabilityCache,
  resetVolatileStorageForTest,
  writeJSON,
} from '../src/safe-storage.js';
import * as safeStorageModule from '../src/safe-storage.js';
import {
  captureStorageDiagnosticSnapshot,
  formatStorageDiagnosticDetail,
  getLatestStorageDiagnostics,
  scheduleStorageDiagnosticCapture,
} from '../src/storage-diagnostics.js';
import {
  captureRuntimeDiagnostic,
  clearCapturedDiagnostics,
  getCapturedDiagnostics,
} from '../src/runtime-diagnostics.js';

describe('getStorageDiagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
  });

  it('reports healthy Web Storage when available and probe succeeds', async () => {
    const diagnostics = await getStorageDiagnostics();

    expect(diagnostics.available).toBe(true);
    expect(diagnostics.probe.ok).toBe(true);
    expect(diagnostics.probe.code).toBeNull();
    expect(diagnostics.volatileKeys).toBe(0);
  });

  it('still resolves when localStorage getter throws SecurityError', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access to storage is not allowed', 'SecurityError');
      },
    });

    try {
      const diagnostics = await getStorageDiagnostics();
      expect(diagnostics.available).toBe(false);
      expect(diagnostics.probe.ok).toBe(false);
      expect(diagnostics.probe.code).toBe(STORAGE_ERROR.UNAVAILABLE);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        delete globalThis.localStorage;
      }
      resetStorageAvailabilityCache();
    }
  });

  it('returns estimate usage and quota when navigator.storage.estimate exists', async () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({ usage: 1024, quota: 4096 })),
        persisted: vi.fn(async () => true),
      },
    });

    try {
      const diagnostics = await getStorageDiagnostics();
      expect(diagnostics.estimate).toEqual({ usage: 1024, quota: 4096 });
      expect(diagnostics.persisted).toBe(true);
      expect(diagnostics.estimateError).toBeNull();
      expect(diagnostics.persistedError).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('records estimateError when estimate rejects without failing diagnostics', async () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => {
          throw new Error('estimate failed');
        }),
        persisted: vi.fn(async () => false),
      },
    });

    try {
      const diagnostics = await getStorageDiagnostics();
      expect(diagnostics.estimate).toBeNull();
      expect(diagnostics.estimateError).toBe(STORAGE_ERROR.UNKNOWN);
      expect(diagnostics.persisted).toBe(false);
    } finally {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('records persistedError when persisted rejects without failing diagnostics', async () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({ usage: 1, quota: 10 })),
        persisted: vi.fn(async () => {
          throw new Error('persisted failed');
        }),
      },
    });

    try {
      const diagnostics = await getStorageDiagnostics();
      expect(diagnostics.estimate).toEqual({ usage: 1, quota: 10 });
      expect(diagnostics.persisted).toBeNull();
      expect(diagnostics.persistedError).toBe(STORAGE_ERROR.UNKNOWN);
    } finally {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('returns null estimate and persisted when navigator.storage is absent', async () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: undefined,
    });

    try {
      const diagnostics = await getStorageDiagnostics();
      expect(diagnostics.estimate).toBeNull();
      expect(diagnostics.persisted).toBeNull();
      expect(diagnostics.estimateError).toBeNull();
      expect(diagnostics.persistedError).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('counts active volatile fallback keys without tombstones', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function quotaThrowingSetItem(key, value) {
      if (String(key).startsWith('ringReady')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      writeJSON('ringReadyVolatileOnly', { count: 1 });
      const diagnostics = await getStorageDiagnostics();
      expect(diagnostics.volatileKeys).toBeGreaterThan(0);
    } finally {
      Storage.prototype.setItem = original;
      resetVolatileStorageForTest();
      resetStorageAvailabilityCache();
    }
  });
});

describe('storage diagnostic reporting', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    clearCapturedDiagnostics();
  });

  it('captures an observational runtime snapshot without throwing', async () => {
    const diagnostics = await captureStorageDiagnosticSnapshot({ stage: 'startup' });

    expect(diagnostics?.available).toBe(true);
    expect(getLatestStorageDiagnostics()).toEqual(diagnostics);
    expect(getCapturedDiagnostics()[0]).toMatchObject({
      kind: 'storage_snapshot',
      stage: 'startup',
      message: 'web_storage_available',
    });
  });

  it('formats diagnostic detail for support review', async () => {
    const detail = formatStorageDiagnosticDetail({
      available: true,
      probe: { ok: true, code: null },
      volatileKeys: 2,
      estimate: { usage: 100, quota: 1000 },
      persisted: false,
    });

    expect(detail).toContain('available=true');
    expect(detail).toContain('probe=ok');
    expect(detail).toContain('volatile=2');
    expect(detail).toContain('usage=100');
    expect(detail).toContain('browserPersisted=false');
  });

  it('schedules capture without blocking callers', () => {
    const originalStorage = navigator.storage;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({ usage: 1, quota: 2 })),
        persisted: vi.fn(async () => true),
      },
    });

    try {
      expect(() => scheduleStorageDiagnosticCapture({ stage: 'startup' })).not.toThrow();
    } finally {
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: originalStorage,
      });
    }
  });

  it('does not mutate app state when collecting diagnostics', async () => {
    localStorage.setItem('ringReadyAthleteProfile', JSON.stringify({ athleteName: 'Test Athlete' }));
    const before = localStorage.getItem('ringReadyAthleteProfile');

    await captureStorageDiagnosticSnapshot({ stage: 'unit' });

    expect(localStorage.getItem('ringReadyAthleteProfile')).toBe(before);
    expect(getCapturedDiagnostics()).toHaveLength(1);
  });

  it('records collect_failed without throwing when diagnostics collection rejects', async () => {
    const spy = vi.spyOn(safeStorageModule, 'getStorageDiagnostics')
      .mockRejectedValueOnce(new Error('collect exploded'));

    await captureStorageDiagnosticSnapshot({ stage: 'startup' });

    expect(getCapturedDiagnostics()[0]).toMatchObject({
      kind: 'storage_snapshot',
      detail: 'collect_failed',
    });

    spy.mockRestore();
  });
});

describe('storage diagnostics are observational only', () => {
  it('does not import gating modules from storage-diagnostics', async () => {
    const module = await import('../src/storage-diagnostics.js');
    expect(Object.keys(module).sort()).toEqual([
      'captureStorageDiagnosticSnapshot',
      'formatStorageDiagnosticDetail',
      'getLatestStorageDiagnostics',
      'scheduleStorageDiagnosticCapture',
    ]);
  });

  it('does not veto workout flows through runtime diagnostic capture', () => {
    clearCapturedDiagnostics();
    captureRuntimeDiagnostic({
      kind: 'storage_snapshot',
      stage: 'startup',
      detail: 'available=false probe=storage_unavailable volatile=3',
      message: 'web_storage_degraded',
    });

    const record = getCapturedDiagnostics()[0];
    expect(record.kind).toBe('storage_snapshot');
    expect(record.detail).toContain('available=false');
  });
});
