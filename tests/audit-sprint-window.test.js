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
import { getSessionHistory } from '../src/storage.js';
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

  it('keeps a durable finished session while cloud save is pending', async () => {
    vi.useFakeTimers();
    saveCloudSprintSession.mockImplementation(() => new Promise(() => {}));
    const finishing = finishSession();
    expect(state.phase).toBe('done');
    expect(getSessionHistory()).toHaveLength(1);
    // Exact callback invoked by visibilitychange(hidden) and pagehide.
    sprintLifecycleTestHooks.persistSessionCheckpoint();
    expect(loadActiveSessionCheckpoint()).toBeNull();
    expect(getSessionHistory()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12001);
    await finishing;
    vi.clearAllTimers();
    vi.useRealTimers();
  });
});
