import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistWorkoutCompletion, getWorkoutCompletion } from '../src/storage.js';
import { resetVolatileStorageForTest } from '../src/safe-storage.js';

const mockUser = { id: 'athlete-a' };
const clearCloudAssignedMileWithProof = vi.fn();
const saveCloudAssignedMileResult = vi.fn();
const saveCloudMileTest = vi.fn();
const ensureCloudMileTestIdentity = vi.fn();
const ensureWorkoutProofUploaded = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  clearCloudAssignedMileWithProof: (...args) => clearCloudAssignedMileWithProof(...args),
  saveCloudAssignedMileResult: (...args) => saveCloudAssignedMileResult(...args),
  saveCloudMileTest: (...args) => saveCloudMileTest(...args),
  ensureCloudMileTestIdentity: (...args) => ensureCloudMileTestIdentity(...args),
  saveCloudHRInfo: vi.fn(),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  saveCloudProfile: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  saveCloudWorkoutCompletion: vi.fn(),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
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
  buildProgramProofKey: vi.fn((camp, week, workout) => `program:${camp}:${week}:${workout}`),
  ensureWorkoutProofUploaded: (...args) => ensureWorkoutProofUploaded(...args),
  hasPendingWorkoutProof: vi.fn(() => true),
  hasWorkoutProof: vi.fn(() => true),
  initWorkoutProof: vi.fn(),
}));

vi.mock('../src/sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    flushSyncQueue: vi.fn(() => Promise.resolve({ dispatched: 0, status: 'idle' })),
    enqueueMileTestForSync: vi.fn(),
    enqueueWorkoutProofForSync: vi.fn(),
    getAthleteProfile: vi.fn(() => ({ athleteName: 'Mile Athlete', campLength: 7, defaultModality: 'running' })),
  };
});

vi.mock('../src/ui.js', () => ({
  withSavingButton: async (_button, task) => task(),
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

import { clearAthleteMutationLocksForTest } from '../src/athlete-operation.js';
import { cloudHydrationTestHooks } from '../src/shell.js';

function mountDetailDom() {
  document.body.innerHTML = `
    <div id="detail-week"></div>
    <div id="detail-title"></div>
    <div id="detail-desc"></div>
    <div id="detail-zone"></div>
    <div id="detail-bpm"></div>
    <div id="detail-skipped-card" hidden></div>
    <div id="detail-skipped-reason"></div>
    <div id="detail-skipped-detail"></div>
    <div id="detail-note-card"></div>
    <textarea id="detail-note-input"></textarea>
    <button id="detail-save-note-btn"></button>
    <div id="detail-note-status"></div>
    <div id="detail-note-counter"></div>
    <div id="detail-log-card" hidden></div>
    <div id="detail-skip-card" hidden></div>
    <button id="detail-skip-workout-btn"></button>
    <button id="detail-clear-completion-btn" hidden></button>
    <button id="detail-action-btn"></button>
    <div id="detail-completion-hints"></div>
    <div data-proof-host="detail"></div>
    <div id="week-list"></div>
  `;
}

describe('assigned mile canonical authority (Review B2)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    clearAthleteMutationLocksForTest();
    vi.clearAllMocks();
    cloudHydrationTestHooks.setShellHooksForTest({ showToast: vi.fn(), showScreen: vi.fn() });
    mountDetailDom();
  });

  it('does not let hydrated mile detail overwrite a canonical SKIPPED assignment', () => {
    persistWorkoutCompletion({
      id: 'skip-1',
      completionKey: '5:3',
      status: 'skipped',
      type: 'daily-workout-skip',
      completedAt: '2026-09-08T12:00:00.000Z',
      workoutContext: { weekIndex: 5, workoutIndex: 3 },
      cfg: { workoutContext: { weekIndex: 5, workoutIndex: 3 } },
      workoutLog: {
        status: 'skipped',
        skipReason: 'injury',
        skipReasonLabel: 'Injury / medical',
        coachApproved: true,
        completedAt: '2026-09-08T12:00:00.000Z',
      },
    });

    cloudHydrationTestHooks.cacheAssignedMileCompletion({
      id: 'stale-mile',
      testKey: 'program:7:5:3',
      distance: 1,
      totalMinutes: 7.5,
      totalSeconds: 450,
      avgBpm: 160,
      maxBpm: 180,
      savedAt: '2026-09-08T11:00:00.000Z',
    });

    const completion = getWorkoutCompletion(5, 3);
    expect(completion?.status).toBe('skipped');
    expect(completion?.workoutLog?.status).toBe('skipped');
    expect(completion?.workoutLog?.distance).toBeUndefined();
  });

  it('enables VIEW MILE RESULT for a completed assigned Mile', () => {
    persistWorkoutCompletion({
      id: 'mile-done',
      completionKey: '5:3',
      status: 'completed',
      completedAt: '2026-09-08T12:00:00.000Z',
      testKey: 'program:7:5:3',
      workoutContext: { weekIndex: 5, workoutIndex: 3, workoutType: 'Mile Re-Test' },
      cfg: { workoutContext: { weekIndex: 5, workoutIndex: 3, workoutType: 'Mile Re-Test' } },
      workoutLog: {
        distance: 1,
        totalMinutes: 7,
        totalSeconds: 420,
        avgBpm: 155,
        maxBpm: 175,
      },
      attachment: { id: 'proof-1' },
      proofPolicyVersion: 1,
    });

    cloudHydrationTestHooks.openWorkoutDetail(5, 3);
    const action = document.getElementById('detail-action-btn');
    expect(action.hidden).toBe(false);
    expect(action.disabled).toBe(false);
    expect(action.textContent).toBe('VIEW MILE RESULT');
    expect(action.dataset.action).toBe('mile-test');
  });

  it('keeps skip authoritative when mile hydration arrives after skip', async () => {
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const mileEpoch = cloudHydrationTestHooks.getMileMutationEpoch();
    const completionEpoch = cloudHydrationTestHooks.getCompletionMutationEpoch();

    persistWorkoutCompletion({
      id: 'skip-2',
      completionKey: '5:3',
      status: 'skipped',
      type: 'daily-workout-skip',
      completedAt: '2026-09-08T12:00:00.000Z',
      workoutContext: { weekIndex: 5, workoutIndex: 3 },
      cfg: { workoutContext: { weekIndex: 5, workoutIndex: 3 } },
      workoutLog: { status: 'skipped', skipReason: 'injury', coachApproved: true },
    });

    await cloudHydrationTestHooks.applyCloudHydrationResults('athlete-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: {
        ok: true,
        value: {
          '5:3': getWorkoutCompletion(5, 3),
        },
      },
      sessionsResult: { ok: true, value: [] },
      mileResult: {
        ok: true,
        value: {
          id: 'stale-mile-cloud',
          testKey: 'program:7:5:3',
          distance: 1,
          totalMinutes: 8,
          avgBpm: 150,
          maxBpm: 170,
          savedAt: '2026-09-08T11:00:00.000Z',
          assignedResults: [{
            id: 'stale-mile-cloud',
            testKey: 'program:7:5:3',
            distance: 1,
            totalMinutes: 8,
            avgBpm: 150,
            maxBpm: 170,
            savedAt: '2026-09-08T11:00:00.000Z',
          }],
        },
      },
    }, {
      completions: completionEpoch,
      sprints: cloudHydrationTestHooks.getSprintMutationEpoch(),
      miles: mileEpoch,
    });

    expect(getWorkoutCompletion(5, 3)?.status).toBe('skipped');
    expect(getWorkoutCompletion(5, 3)?.workoutLog?.status).toBe('skipped');
  });
});
