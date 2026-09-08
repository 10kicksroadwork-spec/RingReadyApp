import { describe, expect, it, beforeEach, vi } from 'vitest';
import { clearSingleFlightsForTest } from '../src/single-flight.js';
import { getWorkoutCompletion } from '../src/storage.js';

const mockUser = { id: 'user-a' };
const ensureCloudWorkoutIdentity = vi.fn();
const rollbackCloudWorkoutIdentity = vi.fn();
const saveCloudWorkoutCompletion = vi.fn();
const ensureCloudMileTestIdentity = vi.fn();
const rollbackCloudMileTestIdentity = vi.fn();
const saveCloudMileTest = vi.fn();
const saveCloudHRInfo = vi.fn();
const ensureWorkoutProofUploaded = vi.fn();
const hasWorkoutProof = vi.fn();
const hasPendingWorkoutProof = vi.fn();
const initWorkoutProof = vi.fn();
const flushSyncQueue = vi.fn();
const loadCloudWorkoutCompletions = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  ensureCloudWorkoutIdentity: (...args) => ensureCloudWorkoutIdentity(...args),
  rollbackCloudWorkoutIdentity: (...args) => rollbackCloudWorkoutIdentity(...args),
  saveCloudWorkoutCompletion: (...args) => saveCloudWorkoutCompletion(...args),
  ensureCloudMileTestIdentity: (...args) => ensureCloudMileTestIdentity(...args),
  rollbackCloudMileTestIdentity: (...args) => rollbackCloudMileTestIdentity(...args),
  saveCloudMileTest: (...args) => saveCloudMileTest(...args),
  saveCloudAssignedMileResult: vi.fn(),
  skipCloudAssignedMile: vi.fn(),
  clearCloudAssignedMileWithProof: vi.fn(),
  saveCloudHRInfo: (...args) => saveCloudHRInfo(...args),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  loadCloudHRInfo: vi.fn(),
  loadCloudMileTest: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudWorkoutCompletions: (...args) => loadCloudWorkoutCompletions(...args),
  saveCloudProfile: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  archiveAndResetCamp: vi.fn(),
  clearAuthRedirectParams: vi.fn(),
  isPasswordRecoveryRedirect: vi.fn(() => false),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: {},
}));

vi.mock('../src/proof.js', () => ({
  PROOF_POLICY_VERSION: 1,
  buildProgramProofKey: vi.fn(() => 'program:7:0:1'),
  ensureWorkoutProofUploaded: (...args) => ensureWorkoutProofUploaded(...args),
  hasPendingWorkoutProof: (...args) => hasPendingWorkoutProof(...args),
  hasWorkoutProof: (...args) => hasWorkoutProof(...args),
  initWorkoutProof: (...args) => initWorkoutProof(...args),
}));

vi.mock('../src/sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    flushSyncQueue: (...args) => flushSyncQueue(...args),
    enqueueDailyWorkoutForSync: vi.fn(),
    enqueueWorkoutProofForSync: vi.fn(),
    enqueueMileTestForSync: vi.fn(),
    getAthleteProfile: vi.fn(() => ({ athleteName: 'Test Athlete', campLength: 7, defaultModality: 'running' })),
  };
});

vi.mock('../src/ui.js', () => ({
  withSavingButton: async (button, task) => task(),
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

import { cloudHydrationTestHooks, completeWorkoutFromDetail, saveMileTestResult } from '../src/shell.js';

function setupDetailDom() {
  document.body.innerHTML = `
    <button id="detail-action-btn" data-action="complete-workout" data-week-index="0" data-workout-index="1"></button>
    <div id="detail-completion-hints"></div>
    <input id="detail-total-minutes-input" value="30:00">
    <input id="detail-avg-bpm-input" value="150">
    <input id="detail-max-bpm-input" value="170">
    <input id="detail-output-input" value="3.1">
    <input id="detail-note-input" value="">
    <div id="detail-modality-note" hidden></div>
    <div id="detail-log-card"></div>
  `;
}

function setupMileDom() {
  document.body.innerHTML = `
    <button id="save-mile-test-btn"></button>
    <div id="mile-completion-hints"></div>
    <input id="mile-distance-input" value="1">
    <input id="mile-time-input" value="8:00">
    <input id="mile-avg-bpm-input" value="160">
    <input id="mile-max-bpm-input" value="180">
    <div id="mile-last-result"></div>
    <div id="mile-location-list"></div>
  `;
}

describe('Bravo completion integration', () => {
  beforeEach(() => {
    localStorage.clear();
    clearSingleFlightsForTest();
    vi.clearAllMocks();
    hasWorkoutProof.mockReturnValue(true);
    hasPendingWorkoutProof.mockReturnValue(true);
    ensureCloudWorkoutIdentity.mockResolvedValue({
      created: true,
      insertedThisAttempt: true,
      rollbackOwned: true,
      reused: false,
      clientRecordId: 'cloud-record-1',
    });
    ensureCloudMileTestIdentity.mockResolvedValue({
      created: true,
      insertedThisAttempt: true,
      rollbackOwned: true,
      reused: false,
      clientRecordId: 'mile-record-1',
    });
    rollbackCloudWorkoutIdentity.mockResolvedValue(undefined);
    ensureWorkoutProofUploaded.mockResolvedValue({ id: 'proof-attachment-1' });
    saveCloudWorkoutCompletion.mockResolvedValue(true);
    saveCloudMileTest.mockResolvedValue(undefined);
    saveCloudHRInfo.mockResolvedValue(undefined);
    flushSyncQueue.mockResolvedValue({ dispatched: 0, status: 'idle' });
    loadCloudWorkoutCompletions.mockResolvedValue({});
  });

  it('retains entered metrics after failed final save and checks cloud state', async () => {
    setupDetailDom();
    saveCloudWorkoutCompletion.mockRejectedValue(new Error('Failed to fetch'));
    await completeWorkoutFromDetail(0, 1);
    expect(document.getElementById('detail-total-minutes-input').value).toBe('30:00');
    expect(document.getElementById('detail-avg-bpm-input').value).toBe('150');
    expect(loadCloudWorkoutCompletions).toHaveBeenCalled();
  });
  it('keeps the saved mile when dependent HR update fails', async () => {
    setupMileDom();
    saveCloudHRInfo.mockRejectedValue(new Error('Failed to fetch'));
    await saveMileTestResult();
    expect(saveCloudMileTest).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ringReadyMileTestResult')).toBeTruthy();
  });
  it('discards A delayed save after switching to B', async () => {
    setupDetailDom();
    mockUser.id = 'user-a';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    saveCloudWorkoutCompletion.mockImplementation(async () => {
      mockUser.id = 'user-b';
      cloudHydrationTestHooks.prepareAccountSwitchSafety();
      expect(getWorkoutCompletion(0, 1)).toBeNull();
      return true;
    });
    await completeWorkoutFromDetail(0, 1);
    expect(mockUser.id).toBe('user-b');
    expect(getWorkoutCompletion(0, 1)).toBeNull();
    mockUser.id = 'user-a';
  });
  it('rejects stale mile hydration after a new save', async () => {
    setupMileDom();
    const owner = cloudHydrationTestHooks.captureClientStateOwner();
    const epoch = cloudHydrationTestHooks.getCompletionMutationEpoch();
    await saveMileTestResult();
    expect(localStorage.getItem('ringReadyMileTestResult')).toBeTruthy();
    await cloudHydrationTestHooks.applyCloudHydrationResults(owner.userId, owner.generation, {
      mileResult: { ok: true, value: null },
    }, epoch);
    expect(localStorage.getItem('ringReadyMileTestResult')).toBeTruthy();
  });
  it('bounds onboarding cloud reads', async () => {
    const auth = await import('../src/auth.js');
    const { enforceAthleteOnboarding } = await import('../src/onboarding.js');
    document.body.innerHTML = '<div id="app"></div>';
    vi.useFakeTimers();
    auth.loadCloudProfile.mockImplementation(() => new Promise(() => {}));
    auth.loadCloudHRInfo.mockResolvedValue(null);
    let settled = false;
    void enforceAthleteOnboarding({ showScreen: vi.fn() }).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(60000);
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });});


