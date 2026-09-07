import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSingleFlightsForTest } from '../src/single-flight.js';

const saveCloudSprintSession = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => ({ id: 'user-a' })),
  saveCloudSprintSession: (...args) => saveCloudSprintSession(...args),
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
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  archiveAndResetCamp: vi.fn(),
  clearAuthRedirectParams: vi.fn(),
  isPasswordRecoveryRedirect: vi.fn(() => false),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {},
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
  recoverAudioAfterBackground: vi.fn(),
  restCompleteAlert: vi.fn(),
  startRestLogAlert: vi.fn(),
  stopRestLogAlert: vi.fn(),
  syncHoldToCancelLabels: vi.fn(),
  withSavingButton: vi.fn(async (_el, fn) => fn()),
}));

vi.mock('../src/sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    enqueueSessionForSync: vi.fn(),
    flushSyncQueue: vi.fn(() => Promise.resolve({ dispatched: 0, status: 'idle' })),
    getAthleteProfile: vi.fn(() => ({ athleteName: 'Sprint Athlete', campLength: 7 })),
  };
});

import { showScreen, showToast } from '../src/ui.js';
import {
  cfg,
  finishSession,
  sprintLifecycleTestHooks,
  startSession,
  state,
} from '../src/app.js';
import {
  doesActiveSprintOwnNavigation,
  getFinalizingSessionId,
  isSessionFinalizationBlocking,
  resetSprintNavigationForTest,
} from '../src/sprint-navigation.js';

describe('finished sprint finalization authority', () => {
  beforeEach(() => {
    clearSingleFlightsForTest();
    vi.clearAllMocks();
    saveCloudSprintSession.mockResolvedValue(undefined);
    sprintLifecycleTestHooks.resetSprintRuntimeForAccountBoundary();
    resetSprintNavigationForTest();
    document.body.innerHTML = `
      <div id="results-body"></div>
      <div id="results-date"></div>
      <div id="results-kicker"></div>
      <div id="sprint-recovery-banner" hidden><p id="sprint-recovery-banner-copy"></p></div>
      <div data-proof-host="sprint"></div>
      <button id="complete-workout-btn"></button>
      <button id="clear-result-completion-btn" hidden></button>
      <div id="sprint-completion-hints"></div>
    `;
    cfg.reps = 5;
    cfg.rest = 90;
    cfg.workoutContext = { weekIndex: 0, workoutIndex: 0, workoutType: 'Sprint Intervals' };
    Object.assign(state, {
      phase: 'resting',
      currentRep: 5,
      data: [{ sprintHR: 170, restHR: 120, drop: 50, suspicious: false }],
      pendingRep: null,
      awaitingModal: false,
    });
  });

  afterEach(() => {
    resetSprintNavigationForTest();
    sprintLifecycleTestHooks.resetSprintRuntimeForAccountBoundary();
  });

  it('acquires navigation authority before async finalization completes', async () => {
    saveCloudSprintSession.mockReset();
    let resolveCloud;
    saveCloudSprintSession.mockImplementation(() => new Promise((resolve) => { resolveCloud = resolve; }));
    const finalizePromise = finishSession();
    expect(doesActiveSprintOwnNavigation()).toBe(true);
    expect(isSessionFinalizationBlocking()).toBe(true);
    expect(getFinalizingSessionId()).toBeTruthy();
    expect(showScreen).not.toHaveBeenCalledWith('results');
    await Promise.resolve();
    expect(typeof resolveCloud).toBe('function');
    resolveCloud();
    await finalizePromise;
    expect(showScreen).toHaveBeenCalledWith('results');
    expect(isSessionFinalizationBlocking()).toBe(false);
  });

  it('blocks starting a fresh sprint while finalization is unresolved', async () => {
    saveCloudSprintSession.mockReset();
    let resolveCloud;
    saveCloudSprintSession.mockImplementation(() => new Promise((resolve) => { resolveCloud = resolve; }));
    const finalizePromise = finishSession();
    await Promise.resolve();
    expect(isSessionFinalizationBlocking()).toBe(true);
    startSession();
    expect(showToast).toHaveBeenCalledWith('FINISHING SPRINT — WAIT FOR RESULTS');
    expect(showScreen).toHaveBeenCalledWith('session');
    resolveCloud();
    await finalizePromise;
  });

  it('does not double-finalize repeated recovery attempts for the same session', async () => {
    await finishSession();
    const callsAfterFirst = saveCloudSprintSession.mock.calls.length;
    const checkpoint = {
      version: 1,
      userId: 'user-a',
      sessionId: sprintLifecycleTestHooks.getActiveSessionId(),
      cfg,
      state: { ...state, phase: 'done' },
      timer: null,
    };
    await sprintLifecycleTestHooks.recoverFinishedSessionFromCheckpoint(checkpoint);
    await sprintLifecycleTestHooks.recoverFinishedSessionFromCheckpoint(checkpoint);
    expect(saveCloudSprintSession.mock.calls.length).toBe(callsAfterFirst);
  });
});
