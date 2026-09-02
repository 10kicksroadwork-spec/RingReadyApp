import { describe, expect, it, beforeEach, vi } from 'vitest';
import { WORKOUT_COMPLETIONS_STORAGE_KEY } from '../src/constants.js';
import { writeJSON, resetVolatileStorageForTest, resetStorageAvailabilityCache } from '../src/safe-storage.js';
import { getWorkoutCompletion } from '../src/storage.js';

const mockUser = { id: 'user-a' };
const saveCloudWorkoutCompletion = vi.fn();
const saveCloudSprintSession = vi.fn();
const saveCloudMileTest = vi.fn();
const loadCloudWorkoutCompletions = vi.fn();
const loadCloudProfile = vi.fn();
const loadCloudHRInfo = vi.fn();
const loadCloudSprintSessions = vi.fn();
const loadCloudMileTest = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  saveCloudWorkoutCompletion: (...args) => saveCloudWorkoutCompletion(...args),
  saveCloudSprintSession: (...args) => saveCloudSprintSession(...args),
  saveCloudMileTest: (...args) => saveCloudMileTest(...args),
  saveCloudHRInfo: vi.fn(),
  saveCloudProfile: vi.fn(),
  loadCloudWorkoutCompletions: (...args) => loadCloudWorkoutCompletions(...args),
  loadCloudProfile: (...args) => loadCloudProfile(...args),
  loadCloudHRInfo: (...args) => loadCloudHRInfo(...args),
  loadCloudSprintSessions: (...args) => loadCloudSprintSessions(...args),
  loadCloudMileTest: (...args) => loadCloudMileTest(...args),
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

describe('Charlie hydration authority', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    vi.clearAllMocks();
    cloudHydrationTestHooks.invalidateCloudHydration();
    saveCloudWorkoutCompletion.mockResolvedValue(undefined);
    saveCloudSprintSession.mockResolvedValue(undefined);
    saveCloudMileTest.mockResolvedValue(undefined);
    loadCloudProfile.mockResolvedValue(null);
    loadCloudHRInfo.mockResolvedValue(null);
    loadCloudSprintSessions.mockResolvedValue([]);
    loadCloudMileTest.mockResolvedValue(null);
  });

  it('does not backfill completions when the cloud read failed', async () => {
    writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, {
      '0:1': {
        id: 'local-stale',
        completionKey: '0:1',
        completedAt: '2026-01-01T00:00:00.000Z',
        workoutContext: { weekIndex: 0, workoutIndex: 1 },
      },
    });

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: false, error: new Error('timeout') },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });

    expect(saveCloudWorkoutCompletion).not.toHaveBeenCalled();
    expect(getWorkoutCompletion(0, 1)?.id).toBe('local-stale');
  });

  it('allows completion backfill only after a successful empty cloud read', async () => {
    writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, {
      '0:1': {
        id: 'local-only',
        completionKey: '0:1',
        completedAt: '2026-01-01T00:00:00.000Z',
        workoutContext: { weekIndex: 0, workoutIndex: 1 },
        cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
      },
    });

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });

    expect(saveCloudWorkoutCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not backfill sprint sessions when the cloud read failed', async () => {
    writeJSON('sprintTrainerHistory', [{ id: 'session-local', date: '2026-01-01T00:00:00.000Z' }]);

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: false, error: new Error('timeout') },
      mileResult: { ok: true, value: null },
    });

    expect(saveCloudSprintSession).not.toHaveBeenCalled();
  });

  it('does not backfill mile test when the cloud read failed', async () => {
    writeJSON('ringReadyMileTestResult', {
      id: 'mile-local',
      savedAt: '2026-01-01T00:00:00.000Z',
      distance: 1,
      totalMinutes: 8,
    });

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: false, error: new Error('timeout') },
    });

    expect(saveCloudMileTest).not.toHaveBeenCalled();
  });

  it('discards targeted workout rehydrate after logout invalidates generation', async () => {
    const owner = cloudHydrationTestHooks.captureClientStateOwner();
    loadCloudWorkoutCompletions.mockResolvedValue({
      '0:1': {
        id: 'cloud-record',
        completionKey: '0:1',
        completedAt: '2026-02-01T00:00:00.000Z',
        cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
      },
    });

    cloudHydrationTestHooks.invalidateCloudHydration();
    const applied = await cloudHydrationTestHooks.rehydrateWorkoutCompletionFromCloud({
      cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
    }, owner);

    expect(applied).toBe(false);
    expect(getWorkoutCompletion(0, 1)).toBeNull();
  });

  it('discards targeted workout rehydrate when account switches before apply', async () => {
    const owner = cloudHydrationTestHooks.captureClientStateOwner();
    loadCloudWorkoutCompletions.mockImplementation(async () => {
      mockUser.id = 'user-b';
      return {
        '0:1': {
          id: 'cloud-record',
          completionKey: '0:1',
          completedAt: '2026-02-01T00:00:00.000Z',
          cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
        },
      };
    });

    const applied = await cloudHydrationTestHooks.rehydrateWorkoutCompletionFromCloud({
      cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
    }, owner);

    expect(applied).toBe(false);
    expect(getWorkoutCompletion(0, 1)).toBeNull();
  });

  it('keeps background hydration pending while cloud loaders are unresolved', async () => {
    let resolveProfile;
    const profileGate = new Promise((resolve) => {
      resolveProfile = resolve;
    });
    loadCloudProfile.mockImplementation(() => profileGate);
    loadCloudHRInfo.mockResolvedValue(null);
    loadCloudWorkoutCompletions.mockResolvedValue({});
    loadCloudSprintSessions.mockResolvedValue([]);
    loadCloudMileTest.mockResolvedValue(null);

    const hydrationPromise = cloudHydrationTestHooks.hydrateCloudDataInBackground();
    let hydrationDone = false;
    hydrationPromise.then(() => {
      hydrationDone = true;
    });

    await Promise.resolve();
    expect(hydrationDone).toBe(false);

    resolveProfile(null);
    await hydrationPromise;
    expect(hydrationDone).toBe(true);
  });
});
