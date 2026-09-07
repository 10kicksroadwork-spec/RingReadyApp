import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKOUT_COMPLETIONS_STORAGE_KEY } from '../src/constants.js';
import { resetVolatileStorageForTest, resetStorageAvailabilityCache } from '../src/safe-storage.js';
import {
  getWorkoutCompletion,
  persistWorkoutCompletion,
} from '../src/storage.js';
import { updateWorkoutNoteFieldsReconciled } from '../src/workout-completion-reconcile.js';

const mockUser = { id: 'athlete-a' };
const updateCloudWorkoutNoteFields = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  updateCloudWorkoutNoteFields: (...args) => updateCloudWorkoutNoteFields(...args),
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
  withSavingButton: async (_button, task) => task(),
}));

import {
  AthleteMutationBusyError,
  clearAthleteMutationLocksForTest,
  runAthleteMutation,
} from '../src/athlete-operation.js';
import { cloudHydrationTestHooks, saveWorkoutNoteFromDetail } from '../src/shell.js';

function seedCompletion(note = 'steady pace') {
  return persistWorkoutCompletion({
    id: 'completion-0-1',
    completionKey: '0:1',
    completedAt: '2026-09-07T12:00:00.000Z',
    workoutContext: { weekIndex: 0, workoutIndex: 1 },
    cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
    workoutLog: { totalMinutes: 30, avgBpm: 150, maxBpm: 170, note },
    note,
  }).record;
}

function setupNoteDom() {
  document.body.innerHTML = `
    <button id="detail-save-note-btn" data-week-index="0" data-workout-index="1"></button>
    <textarea id="detail-note-input" data-week-index="0" data-workout-index="1"></textarea>
    <div id="detail-note-status"></div>
    <div id="detail-note-counter"></div>
  `;
}

describe('workout note authority', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    clearAthleteMutationLocksForTest();
    vi.clearAllMocks();
    setupNoteDom();
    cloudHydrationTestHooks.setShellHooksForTest({ showToast: vi.fn() });
    updateCloudWorkoutNoteFields.mockResolvedValue({ updated: true, absent: false, record: null });
  });

  afterEach(() => {
    clearAthleteMutationLocksForTest();
  });

  it('rejects note-save while clear is in flight', async () => {
    seedCompletion();
    let releaseClear;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    const clear = runAthleteMutation('0:1', 'clear', async () => {
      await clearGate;
      return 'cleared';
    });
    await expect(runAthleteMutation('0:1', 'note-save', async () => 'saved'))
      .rejects.toBeInstanceOf(AthleteMutationBusyError);
    releaseClear();
    await expect(clear).resolves.toBe('cleared');
  });

  it('does not recreate a cleared completion when cloud note update finds no row', async () => {
    seedCompletion('old note');
    updateCloudWorkoutNoteFields.mockResolvedValue({ updated: false, absent: true, record: null });
    document.getElementById('detail-note-input').value = 'late note';

    await saveWorkoutNoteFromDetail({
      currentTarget: document.getElementById('detail-save-note-btn'),
    });

    expect(getWorkoutCompletion(0, 1)).toBeFalsy();
    expect(localStorage.getItem(WORKOUT_COMPLETIONS_STORAGE_KEY) || '').not.toContain('completion-0-1');
    expect(localStorage.getItem('ringReadyWorkoutNotes') || '').toContain('late note');
  });
});

describe('updateWorkoutNoteFieldsReconciled', () => {
  it('updates an existing row without inserting', async () => {
    const updates = [];
    const client = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({
            data: {
              id: 'row-1',
              completion_key: '0:1',
              week_index: 0,
              workout_index: 1,
              record_json: { id: 'row-1', note: 'old' },
            },
            error: null,
          }),
          update(payload) {
            updates.push(payload);
            return {
              eq() { return this; },
              select() { return this; },
              maybeSingle: async () => ({
                data: { id: 'row-1', completion_key: '0:1', record_json: payload.record_json },
                error: null,
              }),
            };
          },
        };
      },
    };

    const result = await updateWorkoutNoteFieldsReconciled(client, 'user-a', {
      note: 'fresh note',
      cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
      workoutLog: { note: 'fresh note' },
    });

    expect(result.updated).toBe(true);
    expect(updates[0].record_json.note).toBe('fresh note');
  });

  it('returns absent when no completion row exists', async () => {
    const client = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle: async () => ({ data: null, error: null }),
        };
      },
    };

    const result = await updateWorkoutNoteFieldsReconciled(client, 'user-a', {
      note: 'orphan',
      cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
    });
    expect(result).toEqual({ updated: false, absent: true, record: null });
  });
});
