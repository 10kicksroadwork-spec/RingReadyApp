import { describe, expect, it, beforeEach, vi } from 'vitest';
import { clearSingleFlightsForTest } from '../src/single-flight.js';
import { getWorkoutCompletion } from '../src/storage.js';
import { createProofUploadError, PROOF_UPLOAD_PHASE } from '../src/proof-diagnostics.js';

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

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  ensureCloudWorkoutIdentity: (...args) => ensureCloudWorkoutIdentity(...args),
  rollbackCloudWorkoutIdentity: (...args) => rollbackCloudWorkoutIdentity(...args),
  saveCloudWorkoutCompletion: (...args) => saveCloudWorkoutCompletion(...args),
  ensureCloudMileTestIdentity: (...args) => ensureCloudMileTestIdentity(...args),
  rollbackCloudMileTestIdentity: (...args) => rollbackCloudMileTestIdentity(...args),
  saveCloudMileTest: (...args) => saveCloudMileTest(...args),
  saveCloudHRInfo: (...args) => saveCloudHRInfo(...args),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  loadCloudHRInfo: vi.fn(),
  loadCloudMileTest: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
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

import { completeWorkoutFromDetail, saveMileTestResult } from '../src/shell.js';

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
    ensureCloudWorkoutIdentity.mockResolvedValue({ created: true, clientRecordId: 'cloud-record-1' });
    ensureCloudMileTestIdentity.mockResolvedValue({ created: true, clientRecordId: 'mile-record-1' });
    rollbackCloudWorkoutIdentity.mockResolvedValue(undefined);
    ensureWorkoutProofUploaded.mockResolvedValue({ id: 'proof-attachment-1' });
    saveCloudWorkoutCompletion.mockResolvedValue(true);
    saveCloudMileTest.mockResolvedValue(undefined);
    saveCloudHRInfo.mockResolvedValue(undefined);
    flushSyncQueue.mockResolvedValue({ dispatched: 0, status: 'idle' });
  });

  it('deduplicates concurrent detail completion submissions', async () => {
    setupDetailDom();

    await Promise.all([
      completeWorkoutFromDetail(0, 1),
      completeWorkoutFromDetail(0, 1),
    ]);

    expect(ensureCloudWorkoutIdentity).toHaveBeenCalledTimes(1);
    expect(ensureWorkoutProofUploaded).toHaveBeenCalledTimes(1);
    expect(getWorkoutCompletion(0, 1)).toBeTruthy();
  });

  it('deduplicates concurrent mile test save submissions', async () => {
    setupMileDom();

    await Promise.all([
      saveMileTestResult(),
      saveMileTestResult(),
    ]);

    expect(ensureCloudMileTestIdentity).toHaveBeenCalledTimes(1);
    expect(ensureWorkoutProofUploaded).toHaveBeenCalledTimes(1);
  });

  it('restores mile save button after bounded HR cloud timeout', async () => {
    setupMileDom();
    vi.useFakeTimers();
    saveCloudMileTest.mockResolvedValue(undefined);
    saveCloudHRInfo.mockImplementation(() => new Promise(() => {}));

    const savePromise = saveMileTestResult();
    await vi.advanceTimersByTimeAsync(12_001);
    await savePromise;

    const button = document.getElementById('save-mile-test-btn');
    expect(button.disabled).toBe(false);
    vi.useRealTimers();
  });

  it('detail retry keeps canonical linked record id after ambiguous proof failure', async () => {
    setupDetailDom();
    ensureCloudWorkoutIdentity
      .mockResolvedValueOnce({ created: true, clientRecordId: 'record-A' })
      .mockResolvedValueOnce({ created: true, clientRecordId: 'record-A' });
    ensureWorkoutProofUploaded
      .mockRejectedValueOnce(createProofUploadError(new TypeError('Load failed'), PROOF_UPLOAD_PHASE.RPC))
      .mockResolvedValueOnce({ id: 'proof-attachment-1' });

    await completeWorkoutFromDetail(0, 1);
    await completeWorkoutFromDetail(0, 1);

    expect(ensureWorkoutProofUploaded.mock.calls[0][1]).toBe('record-A');
    expect(ensureWorkoutProofUploaded.mock.calls[1][1]).toBe('record-A');
    expect(rollbackCloudWorkoutIdentity).not.toHaveBeenCalled();
  });

  it('mile retry keeps canonical linked record id after ambiguous proof failure', async () => {
    setupMileDom();
    ensureCloudMileTestIdentity
      .mockResolvedValueOnce({ created: true, clientRecordId: 'mile-record-A' })
      .mockResolvedValueOnce({ created: true, clientRecordId: 'mile-record-A' });
    ensureWorkoutProofUploaded
      .mockRejectedValueOnce(createProofUploadError(new TypeError('Load failed'), PROOF_UPLOAD_PHASE.RPC))
      .mockResolvedValueOnce({ id: 'proof-attachment-1' });

    await saveMileTestResult();
    await saveMileTestResult();

    expect(ensureWorkoutProofUploaded.mock.calls[0][1]).toBe('mile-record-A');
    expect(ensureWorkoutProofUploaded.mock.calls[1][1]).toBe('mile-record-A');
    expect(rollbackCloudMileTestIdentity).not.toHaveBeenCalled();
  });

  it('does not roll back provisional identity after ambiguous then deterministic proof failure', async () => {
    setupDetailDom();
    ensureCloudWorkoutIdentity.mockResolvedValue({ created: true, clientRecordId: 'record-A' });
    const deterministicAfterAmbiguous = createProofUploadError(new Error('Bucket not found'), PROOF_UPLOAD_PHASE.STORAGE);
    deterministicAfterAmbiguous.proofPreserveProvisionalIdentity = true;
    ensureWorkoutProofUploaded
      .mockRejectedValueOnce(createProofUploadError(new TypeError('Load failed'), PROOF_UPLOAD_PHASE.RPC))
      .mockRejectedValueOnce(deterministicAfterAmbiguous);

    await completeWorkoutFromDetail(0, 1);
    await completeWorkoutFromDetail(0, 1);

    expect(rollbackCloudWorkoutIdentity).not.toHaveBeenCalled();
  });

  it('rolls back provisional detail identity after deterministic storage failure', async () => {
    setupDetailDom();
    ensureWorkoutProofUploaded.mockRejectedValue(
      createProofUploadError(new Error('Bucket not found'), PROOF_UPLOAD_PHASE.STORAGE),
    );

    await completeWorkoutFromDetail(0, 1);

    expect(rollbackCloudWorkoutIdentity).toHaveBeenCalledTimes(1);
    expect(getWorkoutCompletion(0, 1)).toBeNull();
  });
});
