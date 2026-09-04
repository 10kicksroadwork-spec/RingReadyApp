import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKOUT_COMPLETIONS_STORAGE_KEY } from '../src/constants.js';
import {
  resetVolatileStorageForTest,
  resetStorageAvailabilityCache,
  writeJSON,
} from '../src/safe-storage.js';
import {
  getClearedWorkoutCompletions,
  getWorkoutCompletion,
  isWorkoutCompletionCleared,
  markWorkoutCompletionCleared,
  persistWorkoutCompletion,
  removeWorkoutCompletion,
} from '../src/storage.js';
import { reconcileWorkoutCompletionsFromCloud } from '../src/shell-cloud-merge.js';

const mockUser = { id: 'user-a' };
const deleteCloudWorkoutCompletion = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  saveCloudWorkoutCompletion: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  saveCloudMileTest: vi.fn(),
  saveCloudHRInfo: vi.fn(),
  saveCloudProfile: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  deleteCloudWorkoutCompletion: (...args) => deleteCloudWorkoutCompletion(...args),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
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

import { cloudHydrationTestHooks } from '../src/shell.js';

function finalizedCloud(key = '0:4') {
  const [weekIndex, workoutIndex] = key.split(':').map(Number);
  return {
    id: `cloud-${key}`,
    completionKey: key,
    completedAt: '2026-09-04T14:05:51.910Z',
    updatedAt: '2026-09-04T14:05:51.910Z',
    proofPending: false,
    workoutContext: { weekIndex, workoutIndex },
    cfg: { workoutContext: { weekIndex, workoutIndex } },
    workoutLog: {
      totalMinutes: 30,
      avgBpm: 146,
      maxBpm: 159,
      distance: 4.02,
      completedAt: '2026-09-04T14:05:51.910Z',
    },
  };
}

describe('fresh cloud completions beat local clear tombstones', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    vi.clearAllMocks();
    deleteCloudWorkoutCompletion.mockResolvedValue(true);
    cloudHydrationTestHooks.invalidateCloudHydration();
  });

  it('keeps finalized cloud 0:4 and retires a persistent clear marker without deleting cloud', async () => {
    // Stale persistent tombstone that would previously suppress/delete the cloud row.
    writeJSON('ringReadyClearedWorkoutCompletions', {
      '0:4': '2026-09-04T14:20:00.000Z',
    });
    expect(isWorkoutCompletionCleared('0:4')).toBe(true);

    const cloud = { '0:4': finalizedCloud('0:4') };
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const epoch = cloudHydrationTestHooks.getCompletionMutationEpoch();

    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: cloud },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    }, epoch);
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: cloud },
    }, epoch);

    expect(getWorkoutCompletion(0, 4)?.id).toBe('cloud-0:4');
    expect(getClearedWorkoutCompletions()['0:4']).toBeUndefined();
    expect(deleteCloudWorkoutCompletion).not.toHaveBeenCalled();
  });

  it('restores green after simulated reload where volatile clear-marker removal was lost', async () => {
    // 1) Persistent clear marker exists.
    writeJSON('ringReadyClearedWorkoutCompletions', {
      '1:1': '2026-09-04T14:00:00.000Z',
    });

    // 2) Athlete recompletes; local cache write "succeeds" in memory and tries to
    //    clear the marker — then we simulate Safari reload by restoring only the
    //    persistent clear marker and dropping volatile completion state.
    const saved = persistWorkoutCompletion({
      id: 'local-1-1',
      completionKey: '1:1',
      completedAt: '2026-09-04T14:05:51.910Z',
      workoutContext: { weekIndex: 1, workoutIndex: 1 },
      cfg: { workoutContext: { weekIndex: 1, workoutIndex: 1 } },
      workoutLog: {
        totalMinutes: 30.03,
        avgBpm: 146,
        maxBpm: 159,
        distance: 4.02,
        completedAt: '2026-09-04T14:05:51.910Z',
      },
    });
    expect(saved.record).toBeTruthy();

    // Simulate failed persistent marker removal + reload: wipe completions and
    // re-seed only the old persistent clear tombstone.
    localStorage.removeItem(WORKOUT_COMPLETIONS_STORAGE_KEY);
    resetVolatileStorageForTest();
    writeJSON('ringReadyClearedWorkoutCompletions', {
      '1:1': '2026-09-04T14:00:00.000Z',
    });
    expect(getWorkoutCompletion(1, 1)).toBeFalsy();
    expect(isWorkoutCompletionCleared('1:1')).toBe(true);

    const cloud = { '1:1': finalizedCloud('1:1') };
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const epoch = cloudHydrationTestHooks.getCompletionMutationEpoch();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: cloud },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    }, epoch);

    expect(getWorkoutCompletion(1, 1)?.id).toBe('cloud-1:1');
    expect(getClearedWorkoutCompletions()['1:1']).toBeUndefined();
  });

  it('still rejects in-flight hydration after an explicit clear bumps the epoch', async () => {
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const epochAtStart = cloudHydrationTestHooks.getCompletionMutationEpoch();

    markWorkoutCompletionCleared(0, 4);
    removeWorkoutCompletion(0, 4);
    cloudHydrationTestHooks.noteCompletionMutation();

    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: {
        ok: true,
        value: { '0:4': finalizedCloud('0:4') },
      },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    }, epochAtStart);

    expect(getWorkoutCompletion(0, 4)).toBeFalsy();
    expect(isWorkoutCompletionCleared('0:4')).toBe(true);
  });

  it('reconcile retires clear markers for every accepted cloud key', () => {
    writeJSON('ringReadyClearedWorkoutCompletions', {
      '0:4': '2099-01-01T00:00:00.000Z',
    });
    const retired = [];
    const merged = reconcileWorkoutCompletionsFromCloud(
      { '0:4': finalizedCloud('0:4') },
      isWorkoutCompletionCleared,
      (key) => retired.push(key),
    );
    expect(merged['0:4']?.id).toBe('cloud-0:4');
    expect(retired).toEqual(['0:4']);
  });
});
