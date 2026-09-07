import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistWorkoutCompletion, getWorkoutCompletion, removeWorkoutCompletion } from '../src/storage.js';
import { resetVolatileStorageForTest } from '../src/safe-storage.js';

const mockUser = { id: 'athlete-a' };
const clearCloudAssignedMileWithProof = vi.fn();
const saveCloudMileTest = vi.fn();
const ensureCloudMileTestIdentity = vi.fn();
const ensureWorkoutProofUploaded = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  clearCloudAssignedMileWithProof: (...args) => clearCloudAssignedMileWithProof(...args),
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
  buildProgramProofKey: vi.fn(() => 'program:7:0:1'),
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

import {
  AthleteMutationBusyError,
  clearAthleteMutationLocksForTest,
  runAthleteMutation,
} from '../src/athlete-operation.js';
import { cloudHydrationTestHooks } from '../src/shell.js';

describe('assigned mile lifecycle races', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    clearAthleteMutationLocksForTest();
    vi.clearAllMocks();
    clearCloudAssignedMileWithProof.mockResolvedValue(true);
    ensureCloudMileTestIdentity.mockResolvedValue({
      clientRecordId: 'mile-1',
      created: false,
      rollbackOwned: false,
      reused: true,
    });
    ensureWorkoutProofUploaded.mockResolvedValue({ id: 'proof-1' });
    saveCloudMileTest.mockResolvedValue(undefined);
    cloudHydrationTestHooks.setShellHooksForTest({ showToast: vi.fn() });
    persistWorkoutCompletion({
      id: 'mile-assigned-1',
      completionKey: '0:2',
      completedAt: '2026-09-07T12:00:00.000Z',
      testKey: 'program:7:0:2',
      workoutContext: { weekIndex: 0, workoutIndex: 2 },
      cfg: { workoutContext: { weekIndex: 0, workoutIndex: 2 } },
      workoutLog: { distance: 1, totalMinutes: 8, avgBpm: 150, maxBpm: 170 },
      attachment: { id: 'proof-1' },
      proofPolicyVersion: 1,
    });
  });

  it('rejects mile-save while clear is in flight on the same assignment', async () => {
    let releaseClear;
    const gate = new Promise((resolve) => { releaseClear = resolve; });
    const clear = runAthleteMutation('0:2', 'mile-clear', async () => {
      await gate;
      return 'cleared';
    });
    await expect(runAthleteMutation('0:2', 'mile-save', async () => 'saved'))
      .rejects.toBeInstanceOf(AthleteMutationBusyError);
    releaseClear();
    await expect(clear).resolves.toBe('cleared');
  });

  it('rejects mile-save while Skip is in flight on the same assignment', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const skip = runAthleteMutation('0:2', 'skip', async () => {
      await gate;
      return 'skipped';
    });
    await expect(runAthleteMutation('0:2', 'mile-save', async () => 'saved'))
      .rejects.toBeInstanceOf(AthleteMutationBusyError);
    release();
    await expect(skip).resolves.toBe('skipped');
  });

  it('rejects stale mile-save while Clear is authoritative on the same assignment', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const clear = runAthleteMutation('0:2', 'clear', async () => {
      await gate;
      removeWorkoutCompletion(0, 2);
      return 'cleared';
    });
    await expect(runAthleteMutation('0:2', 'mile-save', async () => 'saved'))
      .rejects.toBeInstanceOf(AthleteMutationBusyError);
    release();
    await expect(clear).resolves.toBe('cleared');
    expect(getWorkoutCompletion(0, 2)).toBeFalsy();
  });
});
