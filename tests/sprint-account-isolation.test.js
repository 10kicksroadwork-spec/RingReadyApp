import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const mockUser = { id: 'user-a' };

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  saveCloudWorkoutCompletion: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  saveCloudMileTest: vi.fn(),
  saveCloudProfile: vi.fn(),
  saveCloudHRInfo: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  archiveAndResetCamp: vi.fn(),
  clearAuthRedirectParams: vi.fn(),
  isPasswordRecoveryRedirect: vi.fn(() => false),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock('../src/coach-preview.js', () => ({
  canAccessCoachScreens: vi.fn(() => false),
  initCoachPreview: vi.fn(),
  isCoachScreen: vi.fn(() => false),
  openCoachPreviewIfRequested: vi.fn(),
  refreshCoachPreview: vi.fn(),
  renderCoachPage: vi.fn(),
  setSelectedCoachAthlete: vi.fn(),
  syncCoachPreviewChrome: vi.fn(),
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

import { ACTIVE_SESSION_KEY_PREFIX } from '../src/constants.js';
import {
  buildActiveSessionCheckpoint,
  loadActiveSessionCheckpoint,
  saveActiveSessionCheckpoint,
} from '../src/session-checkpoint.js';
import {
  resetVolatileStorageForTest,
  resetStorageAvailabilityCache,
} from '../src/safe-storage.js';
import { cloudHydrationTestHooks } from '../src/shell.js';
import {
  cfg,
  state,
  resetSprintRuntimeForAccountBoundary,
  sprintLifecycleTestHooks,
} from '../src/app.js';
import {
  hrState,
  setHRConnected,
  hrServiceTestHooks,
} from '../src/hr-service.js';

const B_SESSION_ID = 'athlete-b-checkpoint-session';

function seedAthleteALiveSprint({ phase = 'resting' } = {}) {
  cfg.reps = 6;
  cfg.rest = 90;
  cfg.maxHR = 185;
  cfg.targetPct = 90;
  cfg.workoutContext = { weekIndex: 2, workoutIndex: 1, workoutType: 'Sprint' };
  Object.assign(state, {
    phase,
    currentRep: 4,
    timer: setInterval(() => {}, 60000),
    seconds: 12,
    data: [
      { sprintHR: 172, restHR: 118, drop: 54, suspicious: false },
      { sprintHR: 175, restHR: 120, drop: 55, suspicious: false },
      { sprintHR: 178, restHR: 122, drop: 56, suspicious: false },
    ],
    pendingRep: { sprintHR: 180, restHR: null, needsManualRest: true },
    awaitingModal: false,
    capturedSprintHR: 180,
    capturedRestHR: null,
  });
  sprintLifecycleTestHooks.seedTimerCheckpointForTest({
    kind: 'rest',
    startedAt: Date.now() - 5000,
    totalRest: 90,
    restCaptureAt: 30,
    captureAttempted: false,
    delaySec: 0,
  });
  sprintLifecycleTestHooks.bindActiveSessionOwner('user-a');
  // Force active session id without going through UI start path.
  sprintLifecycleTestHooks.applyCheckpoint({
    userId: 'user-a',
    sessionId: 'athlete-a-live-session',
    cfg: { ...cfg },
    state: { ...state, timer: null },
    timer: sprintLifecycleTestHooks.getTimerCheckpoint(),
  });
  // Re-apply live timer after applyCheckpoint (which clears real interval).
  state.timer = setInterval(() => {}, 60000);
  state.phase = phase;
  state.currentRep = 4;
}

function seedAthleteBCheckpoint() {
  const bCfg = {
    reps: 5,
    rest: 75,
    maxHR: 180,
    targetPct: 90,
    workoutContext: { weekIndex: 1, workoutIndex: 0, workoutType: 'Sprint' },
  };
  const bState = {
    phase: 'resting',
    currentRep: 3,
    timer: null,
    seconds: 0,
    data: [
      { sprintHR: 160, restHR: 110, drop: 50, suspicious: false },
      { sprintHR: 162, restHR: 112, drop: 50, suspicious: false },
    ],
    pendingRep: null,
    awaitingModal: false,
    capturedSprintHR: null,
    capturedRestHR: null,
  };
  const checkpoint = buildActiveSessionCheckpoint(bCfg, bState, null, 'user-b', B_SESSION_ID);
  localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`, JSON.stringify(checkpoint));
  return JSON.parse(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`));
}

describe('sprint account isolation across A→B', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    cloudHydrationTestHooks.setShellHooksForTest({
      resetSprintRuntimeForAccountBoundary,
    });
    resetSprintRuntimeForAccountBoundary();
    hrServiceTestHooks.setAcceptTransportHRForTest(true);
    hrServiceTestHooks.setDisconnectOverrideForTest(null);
  });

  afterEach(() => {
    clearInterval(state.timer);
    state.timer = null;
    hrServiceTestHooks.setDisconnectOverrideForTest(null);
  });

  it('direct SIGNED_IN(B) + pagehide does not overwrite B checkpoint with A sprint runtime', () => {
    seedAthleteALiveSprint({ phase: 'resting' });
    const bBefore = seedAthleteBCheckpoint();

    mockUser.id = 'user-b';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(state.phase).toBe('idle');
    expect(state.currentRep).toBe(0);
    expect(state.data).toEqual([]);
    expect(state.timer).toBeNull();
    expect(sprintLifecycleTestHooks.getActiveSessionOwnerId()).toBe('');
    expect(cfg.reps).toBeNull();

    // Simulate global pagehide persistence after the switch.
    sprintLifecycleTestHooks.persistSessionCheckpoint();

    const bAfter = JSON.parse(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`));
    expect(bAfter.sessionId).toBe(B_SESSION_ID);
    expect(bAfter.state.currentRep).toBe(bBefore.state.currentRep);
    expect(bAfter.state.data).toEqual(bBefore.state.data);
    expect(bAfter.cfg.reps).toBe(bBefore.cfg.reps);
    expect(bAfter.state.data.some((row) => row.sprintHR === 180)).toBe(false);
  });

  it('stale A phase=done + pagehide does not delete B unfinished checkpoint', () => {
    seedAthleteALiveSprint({ phase: 'done' });
    seedAthleteBCheckpoint();

    mockUser.id = 'user-b';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(state.phase).toBe('idle');
    sprintLifecycleTestHooks.persistSessionCheckpoint();

    const bAfter = JSON.parse(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`));
    expect(bAfter).toBeTruthy();
    expect(bAfter.sessionId).toBe(B_SESSION_ID);
    expect(bAfter.state.currentRep).toBe(3);
  });

  it('after boundary, B starting a sprint binds owner and persists under B only', () => {
    seedAthleteALiveSprint({ phase: 'resting' });
    seedAthleteBCheckpoint();

    mockUser.id = 'user-b';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    cfg.reps = 4;
    cfg.rest = 60;
    Object.assign(state, {
      phase: 'idle',
      currentRep: 0,
      timer: null,
      seconds: 0,
      data: [],
      pendingRep: null,
      awaitingModal: false,
      capturedSprintHR: null,
      capturedRestHR: null,
    });
    sprintLifecycleTestHooks.bindActiveSessionOwner('user-b');
    // Simulate first persist of B's new session without clobbering via stale owner.
    state.phase = 'sprinting';
    state.currentRep = 1;
    saveActiveSessionCheckpoint(cfg, state, null, 'athlete-b-fresh-session');
    sprintLifecycleTestHooks.persistSessionCheckpoint();

    mockUser.id = 'user-b';
    const loaded = loadActiveSessionCheckpoint('user-b');
    // loadActiveSessionCheckpoint uses current user — ensure B key still has interval-3 original
    // until B intentionally overwrites via save with owner match. Fresh save above wrote sprinting.
    const raw = JSON.parse(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`));
    expect(raw.userId).toBe('user-b');
    expect(sprintLifecycleTestHooks.getActiveSessionOwnerId()).toBe('user-b');
    expect(loaded?.userId).toBe('user-b');
  });

  it('delayed A HR disconnect finally cannot clear B newly connected monitor', async () => {
    let resolveDisconnect;
    const disconnectGate = new Promise((resolve) => {
      resolveDisconnect = resolve;
    });
    hrServiceTestHooks.setDisconnectOverrideForTest(() => disconnectGate);

    setHRConnected("Athlete A's Monitor", 'web-ble');
    expect(hrState.connected).toBe(true);

    const pending = hrServiceTestHooks.beginAccountBoundaryHRDisconnect();
    await Promise.resolve();
    expect(typeof resolveDisconnect).toBe('function');
    expect(hrState.connected).toBe(false);
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(false);

    // B connects while A's disconnect is still pending.
    hrServiceTestHooks.setAcceptTransportHRForTest(true);
    setHRConnected("Athlete B's Monitor", 'native-ble');
    expect(hrState.connected).toBe(true);
    expect(hrState.deviceName).toBe("Athlete B's Monitor");

    resolveDisconnect();
    await pending;
    await Promise.resolve();
    await Promise.resolve();

    expect(hrState.connected).toBe(true);
    expect(hrState.deviceName).toBe("Athlete B's Monitor");
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(true);
  });
});
