import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKOUT_COMPLETIONS_STORAGE_KEY } from '../src/constants.js';
import { resetVolatileStorageForTest, resetStorageAvailabilityCache } from '../src/safe-storage.js';
import {
  getWorkoutCompletion,
  getWorkoutCompletions,
  markWorkoutCompletionCleared,
  persistWorkoutCompletion,
  removeWorkoutCompletion,
} from '../src/storage.js';

const mockUser = { id: 'user-a' };

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
  deleteCloudWorkoutCompletion: vi.fn(),
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

function seedLocalCompletion(weekIndex = 0, workoutIndex = 1) {
  return persistWorkoutCompletion({
    id: `local-${weekIndex}-${workoutIndex}`,
    completionKey: `${weekIndex}:${workoutIndex}`,
    completedAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:00:00.000Z',
    workoutContext: { weekIndex, workoutIndex },
    cfg: { workoutContext: { weekIndex, workoutIndex } },
    workoutLog: {
      totalMinutes: 20,
      avgBpm: 140,
      maxBpm: 160,
      distance: 2.5,
    },
  });
}

describe('completion mutation epoch vs stale hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    cloudHydrationTestHooks.invalidateCloudHydration();
  });

  it('keeps a saved completion when a stale empty cloud hydration finishes later', async () => {
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const epochAtStart = cloudHydrationTestHooks.getCompletionMutationEpoch();

    const saved = seedLocalCompletion(0, 1);
    expect(saved.record).toBeTruthy();
    cloudHydrationTestHooks.noteCompletionMutation();

    await cloudHydrationTestHooks.applyCloudHydrationResults(
      'user-a',
      generation,
      {
        profileResult: { ok: true, value: null },
        hrResult: { ok: true, value: null },
        completionsResult: { ok: true, value: {} },
        sessionsResult: { ok: true, value: [] },
        mileResult: { ok: true, value: null },
      },
      epochAtStart,
    );

    expect(getWorkoutCompletion(0, 1)?.id).toBe('local-0-1');
    expect(getWorkoutCompletions()['0:1']).toBeTruthy();
  });

  it('keeps a cleared completion absent when a stale completed cloud hydration finishes later', async () => {
    seedLocalCompletion(0, 1);
    cloudHydrationTestHooks.noteCompletionMutation();

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const epochAtStart = cloudHydrationTestHooks.getCompletionMutationEpoch();

    markWorkoutCompletionCleared(0, 1);
    removeWorkoutCompletion(0, 1);
    cloudHydrationTestHooks.noteCompletionMutation();
    expect(getWorkoutCompletion(0, 1)).toBeFalsy();

    await cloudHydrationTestHooks.applyCloudHydrationResults(
      'user-a',
      generation,
      {
        profileResult: { ok: true, value: null },
        hrResult: { ok: true, value: null },
        completionsResult: {
          ok: true,
          value: {
            '0:1': {
              id: 'cloud-old',
              completionKey: '0:1',
              completedAt: '2026-09-04T11:00:00.000Z',
              updatedAt: '2026-09-04T11:00:00.000Z',
              cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
            },
          },
        },
        sessionsResult: { ok: true, value: [] },
        mileResult: { ok: true, value: null },
      },
      epochAtStart,
    );

    expect(getWorkoutCompletion(0, 1)).toBeFalsy();
    expect(localStorage.getItem(WORKOUT_COMPLETIONS_STORAGE_KEY) || '').not.toContain('cloud-old');
  });

  it('still applies a fresh cloud hydration when no completion mutation occurred during the read', async () => {
    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const epochAtStart = cloudHydrationTestHooks.getCompletionMutationEpoch();

    await cloudHydrationTestHooks.applyCloudHydrationResults(
      'user-a',
      generation,
      {
        profileResult: { ok: true, value: null },
        hrResult: { ok: true, value: null },
        completionsResult: {
          ok: true,
          value: {
            '0:1': {
              id: 'cloud-fresh',
              completionKey: '0:1',
              completedAt: '2026-09-04T13:00:00.000Z',
              updatedAt: '2026-09-04T13:00:00.000Z',
              cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
            },
          },
        },
        sessionsResult: { ok: true, value: [] },
        mileResult: { ok: true, value: null },
      },
      epochAtStart,
    );

    expect(getWorkoutCompletion(0, 1)?.id).toBe('cloud-fresh');
  });
});
