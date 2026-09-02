import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ACTIVE_SESSION_KEY_PREFIX } from '../src/constants.js';

const mockUser = { id: 'user-a' };
const saveCloudSprintSession = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  saveCloudSprintSession: (...args) => saveCloudSprintSession(...args),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: null,
}));

vi.mock('../src/sync.js', () => ({
  enqueueSessionForSync: vi.fn(),
  flushSyncQueue: vi.fn(() => Promise.resolve({ dispatched: 0, status: 'idle' })),
  getAthleteProfile: vi.fn(() => ({ athleteName: 'Test Athlete' })),
}));

vi.mock('../src/ui.js', () => ({
  showScreen: vi.fn(),
  setStatus: vi.fn(),
  setTimerDisplay: vi.fn(),
  setMainBtn: vi.fn(),
  resetChips: vi.fn(),
  setRing: vi.fn(),
  showToast: vi.fn(),
  showExportModal: vi.fn(),
  closeExportModal: vi.fn(),
  vibrate: vi.fn(),
  unlockAudio: vi.fn(),
  restCompleteAlert: vi.fn(),
  startRestLogAlert: vi.fn(),
  stopRestLogAlert: vi.fn(),
  syncHoldToCancelLabels: vi.fn(),
}));

vi.mock('../src/hr-service.js', () => ({
  getAutoCapturedHR: vi.fn(),
  isHRConnected: vi.fn(() => false),
  hasFreshHRSample: vi.fn(() => false),
  clearHRBufferForInterval: vi.fn(),
}));

import { saveActiveSessionCheckpoint, loadActiveSessionCheckpoint } from '../src/session-checkpoint.js';
import { resetVolatileStorageForTest, resetStorageAvailabilityCache } from '../src/safe-storage.js';
import { getCloudPendingSprintSessions, getSessionHistory } from '../src/storage.js';
import { cfg, finishSession, sprintLifecycleTestHooks, state } from '../src/app.js';

const STABLE_SESSION_ID = 'stable-sprint-session-id';

describe('Charlie sprint durability', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    vi.clearAllMocks();
    saveCloudSprintSession.mockRejectedValue(new Error('cloud save failed'));
    cfg.reps = 4;
    cfg.rest = 60;
    cfg.maxHR = 180;
    cfg.targetPct = 90;
    cfg.workoutContext = { weekIndex: 1, workoutIndex: 0, workoutType: 'Sprint' };
    state.phase = 'resting';
    state.currentRep = 4;
    state.seconds = 0;
    state.data = [{ sprintHR: 170, restHR: 120, drop: 50, suspicious: false }];
    state.pendingRep = null;
    state.awaitingModal = false;
    state.capturedSprintHR = null;
    state.capturedRestHR = null;

    saveActiveSessionCheckpoint(cfg, state, null, STABLE_SESSION_ID);
    sprintLifecycleTestHooks.applyCheckpoint(loadActiveSessionCheckpoint());
    expect(loadActiveSessionCheckpoint()?.sessionId).toBe(STABLE_SESSION_ID);
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeTruthy();
  });

  it('persists the same sessionId through checkpoint updates', () => {
    saveActiveSessionCheckpoint(cfg, state, null, STABLE_SESSION_ID);
    state.currentRep = 2;
    saveActiveSessionCheckpoint(cfg, state, null, STABLE_SESSION_ID);
    expect(loadActiveSessionCheckpoint()?.sessionId).toBe(STABLE_SESSION_ID);
  });

  it('retains the active checkpoint when cloud and local history persistence both fail', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).includes('sprintTrainerHistory')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      await finishSession();
      expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeTruthy();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('clears the active checkpoint when cloud sprint save succeeds even if local history fails', async () => {
    saveCloudSprintSession.mockResolvedValue(undefined);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).includes('sprintTrainerHistory')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      await finishSession();
      expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('attempts local persistence after bounded cloud sprint save times out', async () => {
    vi.useFakeTimers();
    saveCloudSprintSession.mockImplementation(() => new Promise(() => {}));

    const finishPromise = finishSession();
    await vi.advanceTimersByTimeAsync(12_001);
    await finishPromise;

    expect(getCloudPendingSprintSessions()).toHaveLength(1);
    expect(getCloudPendingSprintSessions()[0].cloudPending).toBe(true);
    vi.useRealTimers();
  });

  it('does not clear the checkpoint when cloud fails and session history is volatile-only', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function quotaThrowingSetItem(key, value) {
      if (String(key).includes('sprintTrainerHistory')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      await finishSession();
      expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeTruthy();
      expect(localStorage.getItem('sprintTrainerHistory')).toBeNull();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('marks explicit cloud pending when cloud fails and local history succeeds', async () => {
    saveCloudSprintSession.mockRejectedValue(new Error('cloud save failed'));

    await finishSession();

    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeNull();
    expect(getCloudPendingSprintSessions()).toHaveLength(1);
    expect(getCloudPendingSprintSessions()[0].cloudPending).toBe(true);
    expect(getCloudPendingSprintSessions()[0].id).toBe(STABLE_SESSION_ID);
    expect(getSessionHistory()[0]?.id).toBe(STABLE_SESSION_ID);
    expect(saveCloudSprintSession.mock.calls[0][0].id).toBe(STABLE_SESSION_ID);
  });

  it('reuses the checkpoint sessionId after cloud timeout and resume', async () => {
    vi.useFakeTimers();
    saveCloudSprintSession.mockImplementation(() => new Promise(() => {}));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockingSetItem(key, value) {
      if (String(key).includes('sprintTrainerHistory')) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };

    try {
      const finishPromise = finishSession();
      await vi.advanceTimersByTimeAsync(12_001);
      await finishPromise;

      const retained = loadActiveSessionCheckpoint();
      expect(retained?.sessionId).toBe(STABLE_SESSION_ID);

      saveCloudSprintSession.mockReset();
      saveCloudSprintSession.mockResolvedValue(undefined);
      Storage.prototype.setItem = original;

      sprintLifecycleTestHooks.applyCheckpoint(retained);
      expect(sprintLifecycleTestHooks.getActiveSessionId()).toBe(STABLE_SESSION_ID);
      state.phase = 'resting';

      await finishSession();
      expect(saveCloudSprintSession).toHaveBeenCalledTimes(1);
      expect(saveCloudSprintSession.mock.calls[0][0].id).toBe(STABLE_SESSION_ID);
    } finally {
      Storage.prototype.setItem = original;
      vi.useRealTimers();
    }
  });
});
