import { describe, expect, it, beforeEach, vi } from 'vitest';
import { clearSingleFlightsForTest } from '../src/single-flight.js';

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

import { cloudHydrationTestHooks } from '../src/shell.js';

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

  it('clears selected proof at account boundary before B opens same workout', async () => {
    const proof = await import('../src/proof.js');
    proof.__resetProofStateForTest();
    document.body.innerHTML = '<div data-proof-host="detail"></div>';
    mockUser.id = 'user-a';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    proof.initWorkoutProof('detail', { proofKey: 'program:7:0:1', context: {} });
    const a = proof.__getProofStateForTest('detail');
    a.processed = { blob: new Blob(['A screenshot']), width: 10, height: 10, mimeType: 'image/png' };
    a.filename = 'athlete-a-private-proof.png';
    a.previewUrl = 'blob:athlete-a';
    mockUser.id = 'user-b';
    cloudHydrationTestHooks.prepareAccountSwitchSafety();
    proof.initWorkoutProof('detail', { proofKey: 'program:7:0:1', context: {}, existingAttachment: null });
    expect(proof.hasPendingWorkoutProof('detail')).toBe(false);
    expect(document.querySelector('.proof-preview')).toBeNull();
    expect(document.body.textContent).not.toContain('athlete-a-private-proof.png');
    mockUser.id = 'user-a';
  });

  it('preserves pending local proof when explicit existingAttachment:null is passed on same key', async () => {
    const proof = await import('../src/proof.js');
    proof.__resetProofStateForTest();
    document.body.innerHTML = '<div data-proof-host="detail"></div>';
    proof.initWorkoutProof('detail', { proofKey: 'program:7:0:1', context: {} });
    const stateBefore = proof.__getProofStateForTest('detail');
    stateBefore.processed = { blob: new Blob(['pending']), width: 10, height: 10, mimeType: 'image/png' };
    stateBefore.filename = 'pending-proof.png';
    stateBefore.previewUrl = 'blob:pending';
    proof.initWorkoutProof('detail', {
      proofKey: 'program:7:0:1',
      context: {},
      existingAttachment: null,
    });
    expect(proof.hasPendingWorkoutProof('detail')).toBe(true);
    expect(proof.__getProofStateForTest('detail').existingAttachment).toBeNull();
  });
});
