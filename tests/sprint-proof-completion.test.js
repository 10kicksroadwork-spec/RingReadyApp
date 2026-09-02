import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  getWorkoutCompletion,
  saveWorkoutCompletion,
} from '../src/storage.js';

const mockUser = { id: 'user-a' };
const showToast = vi.fn();
const clearCloudWorkoutCompletionWithProof = vi.fn();
const saveCloudSprintSession = vi.fn();
const saveCloudWorkoutCompletion = vi.fn();
const ensureWorkoutProofUploaded = vi.fn();
const hasWorkoutProof = vi.fn();
const hasPendingWorkoutProof = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  saveCloudSprintSession: (...args) => saveCloudSprintSession(...args),
  saveCloudWorkoutCompletion: (...args) => saveCloudWorkoutCompletion(...args),
  clearCloudWorkoutCompletionWithProof: (...args) => clearCloudWorkoutCompletionWithProof(...args),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
  supabase: null,
}));

vi.mock('../src/proof.js', () => ({
  PROOF_POLICY_VERSION: 1,
  buildProgramProofKey: vi.fn(() => '1:0'),
  ensureWorkoutProofUploaded: (...args) => ensureWorkoutProofUploaded(...args),
  hasPendingWorkoutProof: (...args) => hasPendingWorkoutProof(...args),
  hasWorkoutProof: (...args) => hasWorkoutProof(...args),
  initWorkoutProof: vi.fn(),
}));

vi.mock('../src/ui.js', () => ({
  showScreen: vi.fn(),
  setStatus: vi.fn(),
  setTimerDisplay: vi.fn(),
  setMainBtn: vi.fn(),
  resetChips: vi.fn(),
  setRing: vi.fn(),
  showToast: (...args) => showToast(...args),
  showExportModal: vi.fn(),
  closeExportModal: vi.fn(),
  selectExportText: vi.fn(),
  vibrate: vi.fn(),
  unlockAudio: vi.fn(),
  restCompleteAlert: vi.fn(),
  startRestLogAlert: vi.fn(),
  stopRestLogAlert: vi.fn(),
  syncHoldToCancelLabels: vi.fn(),
  withSavingButton: async (_button, task) => task(),
}));

import {
  clearResultWorkoutCompletion,
  completeWorkout,
  showSavedWorkoutResult,
} from '../src/app.js';

function buildSprintResultRecord(overrides = {}) {
  return {
    id: 'sprint-session-1',
    date: '2026-09-01T12:00:00.000Z',
    cfg: {
      reps: 8,
      rest: 90,
      maxHR: 180,
      targetPct: 90,
      workoutContext: { weekIndex: 1, workoutIndex: 0, workoutType: 'Sprint' },
    },
    data: [{ sprintHR: 170, restHR: 120, drop: 50, suspicious: false }],
    avgDrop: 50,
    peakHR: 170,
    attachment: { id: 'proof-attachment-1' },
    ...overrides,
  };
}

function setupResultsDom() {
  document.body.innerHTML = `
    <div id="results-body"></div>
    <div id="results-date"></div>
    <button id="complete-workout-btn"></button>
    <button id="clear-result-completion-btn" hidden></button>
    <div id="sprint-completion-hints"></div>
  `;
}

describe('sprint proof completion', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setupResultsDom();
    window.confirm = vi.fn(() => true);
    hasWorkoutProof.mockReturnValue(true);
    hasPendingWorkoutProof.mockReturnValue(false);
    saveCloudSprintSession.mockResolvedValue(undefined);
    saveCloudWorkoutCompletion.mockResolvedValue(undefined);
    ensureWorkoutProofUploaded.mockResolvedValue({ id: 'proof-attachment-1' });
    clearCloudWorkoutCompletionWithProof.mockResolvedValue(undefined);
  });

  it('does not show success toast or remove completion when transactional clear fails', async () => {
    const record = buildSprintResultRecord();
    const completed = saveWorkoutCompletion(record);
    showSavedWorkoutResult(completed);
    clearCloudWorkoutCompletionWithProof.mockRejectedValue(new Error('proof clear failed'));

    await clearResultWorkoutCompletion();

    expect(clearCloudWorkoutCompletionWithProof).toHaveBeenCalledWith(1, 0, 'proof-attachment-1');
    expect(showToast).toHaveBeenCalledWith('PROOF CLEAR FAILED');
    expect(showToast).not.toHaveBeenCalledWith('WORKOUT MARKED INCOMPLETE');
    expect(getWorkoutCompletion(1, 0)).toBeTruthy();
  });

  it('retries cloud sprint save before proof upload during completion', async () => {
    const record = buildSprintResultRecord({ completedAt: undefined, completionKey: undefined });
    showSavedWorkoutResult(record);
    const callOrder = [];
    saveCloudSprintSession.mockImplementation(async () => {
      callOrder.push('saveCloudSprintSession');
    });
    ensureWorkoutProofUploaded.mockImplementation(async () => {
      callOrder.push('ensureWorkoutProofUploaded');
      return { id: 'proof-attachment-1' };
    });

    await completeWorkout();

    expect(callOrder).toEqual(['saveCloudSprintSession', 'ensureWorkoutProofUploaded']);
    expect(saveCloudWorkoutCompletion).toHaveBeenCalledTimes(1);
    expect(getWorkoutCompletion(1, 0)).toBeTruthy();
  });

  it('does not upload proof when the identity staging cloud save fails', async () => {
    showSavedWorkoutResult(buildSprintResultRecord());
    saveCloudSprintSession.mockRejectedValue(new Error('cloud save failed'));

    await completeWorkout();

    expect(ensureWorkoutProofUploaded).not.toHaveBeenCalled();
    expect(saveCloudWorkoutCompletion).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('CLOUD SAVE FAILED');
    expect(getWorkoutCompletion(1, 0)).toBeNull();
  });

  it('does not persist completion locally when cloud workout save fails', async () => {
    showSavedWorkoutResult(buildSprintResultRecord({ completedAt: undefined, completionKey: undefined }));
    saveCloudWorkoutCompletion.mockRejectedValue(new Error('cloud completion failed'));

    await completeWorkout();

    expect(ensureWorkoutProofUploaded).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('COULD NOT SAVE WORKOUT');
    expect(getWorkoutCompletion(1, 0)).toBeNull();
  });

  it('deduplicates concurrent completeWorkout calls', async () => {
    showSavedWorkoutResult(buildSprintResultRecord({ completedAt: undefined, completionKey: undefined }));

    await Promise.all([completeWorkout(), completeWorkout()]);

    expect(saveCloudSprintSession).toHaveBeenCalledTimes(1);
    expect(ensureWorkoutProofUploaded).toHaveBeenCalledTimes(1);
    expect(getWorkoutCompletion(1, 0)).toBeTruthy();
  });
});
