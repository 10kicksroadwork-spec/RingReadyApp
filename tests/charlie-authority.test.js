import { describe, expect, it, beforeEach, vi } from 'vitest';
import { WORKOUT_COMPLETIONS_STORAGE_KEY } from '../src/constants.js';
import {
  getStorageItem,
  resetVolatileStorageForTest,
  resetStorageAvailabilityCache,
  writeJSON,
  removeStorageKey,
  isStorageKeyTombstoned,
} from '../src/safe-storage.js';
import { getWorkoutCompletion, getClearedWorkoutCompletions, isWorkoutCompletionCleared, getCloudPendingSprintSessions } from '../src/storage.js';
import { mapCloudSprintSessionRow } from '../src/cloud-record-mapper.js';
import { reconcileWorkoutCompletionsFromCloud } from '../src/shell-cloud-merge.js';

const mockUser = { id: 'user-a' };
const saveCloudWorkoutCompletion = vi.fn();
const saveCloudSprintSession = vi.fn();
const saveCloudMileTest = vi.fn();
const saveCloudProfile = vi.fn();
const loadCloudWorkoutCompletions = vi.fn();
const loadCloudProfile = vi.fn();
const loadCloudHRInfo = vi.fn();
const loadCloudSprintSessions = vi.fn();
const loadCloudMileTest = vi.fn();
const deleteCloudWorkoutCompletion = vi.fn();

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  saveCloudWorkoutCompletion: (...args) => saveCloudWorkoutCompletion(...args),
  saveCloudSprintSession: (...args) => saveCloudSprintSession(...args),
  saveCloudMileTest: (...args) => saveCloudMileTest(...args),
  saveCloudHRInfo: vi.fn(),
  saveCloudProfile: (...args) => saveCloudProfile(...args),
  loadCloudWorkoutCompletions: (...args) => loadCloudWorkoutCompletions(...args),
  loadCloudProfile: (...args) => loadCloudProfile(...args),
  loadCloudHRInfo: (...args) => loadCloudHRInfo(...args),
  loadCloudSprintSessions: (...args) => loadCloudSprintSessions(...args),
  loadCloudMileTest: (...args) => loadCloudMileTest(...args),
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
    saveCloudProfile.mockResolvedValue(undefined);
    loadCloudProfile.mockResolvedValue(null);
    loadCloudHRInfo.mockResolvedValue(null);
    loadCloudSprintSessions.mockResolvedValue([]);
    loadCloudMileTest.mockResolvedValue(null);
    deleteCloudWorkoutCompletion.mockResolvedValue(true);
  });

  it('does not backfill completions when the cloud read failed', async () => {
    localStorage.setItem(WORKOUT_COMPLETIONS_STORAGE_KEY, JSON.stringify({
      '0:1': {
        id: 'local-stale',
        completionKey: '0:1',
        completedAt: '2026-01-01T00:00:00.000Z',
        workoutContext: { weekIndex: 0, workoutIndex: 1 },
      },
    }));

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: false, error: new Error('timeout') },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: false, error: new Error('timeout') },
    });

    expect(saveCloudWorkoutCompletion).not.toHaveBeenCalled();
    expect(getWorkoutCompletion(0, 1)?.id).toBe('local-stale');
  });

  it('does not recreate stale local completions when cloud successfully returns empty', async () => {
    localStorage.setItem(WORKOUT_COMPLETIONS_STORAGE_KEY, JSON.stringify({
      '0:1': {
        id: 'local-stale',
        completionKey: '0:1',
        completedAt: '2026-01-01T00:00:00.000Z',
        cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
      },
    }));

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
    });

    expect(saveCloudWorkoutCompletion).not.toHaveBeenCalled();
    expect(getWorkoutCompletion(0, 1)).toBeNull();
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
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: false, error: new Error('timeout') },
    });

    expect(saveCloudSprintSession).not.toHaveBeenCalled();
  });

  it('retries only explicit cloudPending sprint sessions after successful cloud read', async () => {
    const pendingSession = {
      id: 'session-pending',
      date: '2026-01-01T00:00:00.000Z',
      cloudPending: true,
    };
    writeJSON('sprintTrainerHistory', [pendingSession, { id: 'session-local-only', date: '2026-01-02T00:00:00.000Z' }]);

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [] },
    });

    expect(saveCloudSprintSession).toHaveBeenCalledTimes(1);
    expect(saveCloudSprintSession.mock.calls[0][0].id).toBe('session-pending');
    expect(getCloudPendingSprintSessions()).toHaveLength(0);
  });

  it('does not re-queue cloud sessions that carry legacy cloudPending metadata', async () => {
    const cloudSession = mapCloudSprintSessionRow({
      session_id: 'session-pending',
      session_at: '2026-01-01T00:00:00.000Z',
      session_json: {
        id: 'session-pending',
        cloudPending: true,
        date: '2026-01-01T00:00:00.000Z',
      },
    });

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [cloudSession] },
      mileResult: { ok: true, value: null },
    });

    expect(getCloudPendingSprintSessions()).toHaveLength(0);
    saveCloudSprintSession.mockClear();

    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      completionsResult: { ok: true, value: {} },
      sessionsResult: { ok: true, value: [cloudSession] },
    });

    expect(saveCloudSprintSession).not.toHaveBeenCalled();
    expect(getCloudPendingSprintSessions()).toHaveLength(0);
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
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      mileResult: { ok: false, error: new Error('timeout') },
    });

    expect(saveCloudMileTest).not.toHaveBeenCalled();
  });

  it('reconciles successful cloud slices before maintenance writes finish', async () => {
    writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, {
      '0:1': { id: 'local-stale', completionKey: '0:1', completedAt: '2026-01-01T00:00:00.000Z' },
    });
    saveCloudProfile.mockImplementation(() => new Promise(() => {}));

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: {
        ok: true,
        value: {
          '0:2': {
            id: 'cloud-fresh',
            completionKey: '0:2',
            completedAt: '2026-02-01T00:00:00.000Z',
            cfg: { workoutContext: { weekIndex: 0, workoutIndex: 2 } },
          },
        },
      },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });

    expect(getWorkoutCompletion(0, 1)).toBeNull();
    expect(getWorkoutCompletion(0, 2)?.id).toBe('cloud-fresh');

    const maintenancePromise = cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: {} },
    });
    await Promise.resolve();
    expect(getWorkoutCompletion(0, 2)?.id).toBe('cloud-fresh');
    await maintenancePromise;
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

describe('Charlie volatile deletion tombstones', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
  });

  it('keeps keys logically absent after persistent removal fails and storage recovers', () => {
    localStorage.setItem('ringReadySharedKey', 'user-a-value');
    const originalRemove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function blockingRemoveItem(key) {
      if (String(key) === 'ringReadySharedKey') {
        throw new DOMException('Access to storage is not allowed', 'SecurityError');
      }
      return originalRemove.call(this, key);
    };

    try {
      const result = removeStorageKey('ringReadySharedKey');
      expect(result.logicalOk).toBe(true);
      expect(isStorageKeyTombstoned('ringReadySharedKey')).toBe(true);
      expect(getStorageItem('ringReadySharedKey', 'fallback').value).toBe('fallback');
    } finally {
      Storage.prototype.removeItem = originalRemove;
      expect(getStorageItem('ringReadySharedKey', 'fallback').value).toBe('fallback');
    }
  });
});

describe('Charlie clear-marker precedence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
  });

  it('accepts newer cloud re-completion over a stale local clear marker', () => {
    writeJSON('ringReadyClearedWorkoutCompletions', { '0:1': '2026-01-01T11:00:00.000Z' });

    const cloudCompletions = {
      '0:1': {
        id: 'cloud-recomplete',
        completionKey: '0:1',
        completedAt: '2026-01-01T13:00:00.000Z',
        cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
      },
    };

    const superseded = [];
    const merged = reconcileWorkoutCompletionsFromCloud(
      cloudCompletions,
      isWorkoutCompletionCleared,
      (key) => superseded.push(key),
    );

    expect(merged['0:1']?.id).toBe('cloud-recomplete');
    expect(superseded).toEqual(['0:1']);
  });

  it('keeps an accepted fresh cloud completion even when the clear marker is newer', () => {
    writeJSON('ringReadyClearedWorkoutCompletions', { '0:1': '2026-01-01T13:00:00.000Z' });

    const superseded = [];
    const merged = reconcileWorkoutCompletionsFromCloud(
      {
        '0:1': {
          id: 'cloud-fresh',
          completedAt: '2026-01-01T11:00:00.000Z',
        },
      },
      isWorkoutCompletionCleared,
      (key) => superseded.push(key),
    );

    expect(merged['0:1']?.id).toBe('cloud-fresh');
    expect(superseded).toEqual(['0:1']);
  });

  it('keeps an accepted cloud completion when cloud timestamp is missing but the key is present', () => {
    writeJSON('ringReadyClearedWorkoutCompletions', { '0:1': '2026-01-01T11:00:00.000Z' });

    const superseded = [];
    const merged = reconcileWorkoutCompletionsFromCloud(
      { '0:1': { id: 'cloud-no-ts' } },
      isWorkoutCompletionCleared,
      (key) => superseded.push(key),
    );

    expect(merged['0:1']?.id).toBe('cloud-no-ts');
    expect(superseded).toEqual(['0:1']);
  });

  it('removes stale clear markers during hydration reconcile', async () => {
    writeJSON('ringReadyClearedWorkoutCompletions', { '0:1': '2026-01-01T11:00:00.000Z' });

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: {
        ok: true,
        value: {
          '0:1': {
            id: 'cloud-recomplete',
            completionKey: '0:1',
            completedAt: '2026-01-01T13:00:00.000Z',
            cfg: { workoutContext: { weekIndex: 0, workoutIndex: 1 } },
          },
        },
      },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });

    expect(getWorkoutCompletion(0, 1)?.id).toBe('cloud-recomplete');
    expect(getClearedWorkoutCompletions()['0:1']).toBeUndefined();
  });

  it('does not delete cloud completions from a newer local clear tombstone during maintenance', async () => {
    writeJSON('ringReadyClearedWorkoutCompletions', { '0:4': '2026-09-04T14:20:00.000Z' });

    const generation = cloudHydrationTestHooks.getHydrationGeneration();
    const cloudCompletions = {
      '0:4': {
        id: 'cloud-long-run',
        completionKey: '0:4',
        completedAt: '2026-09-04T14:05:00.000Z',
        updatedAt: '2026-09-04T14:05:00.000Z',
        cfg: { workoutContext: { weekIndex: 0, workoutIndex: 4 } },
      },
    };

    await cloudHydrationTestHooks.applyCloudHydrationResults('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: cloudCompletions },
      sessionsResult: { ok: true, value: [] },
      mileResult: { ok: true, value: null },
    });
    await cloudHydrationTestHooks.runCloudHydrationMaintenance('user-a', generation, {
      profileResult: { ok: true, value: null },
      hrResult: { ok: true, value: null },
      completionsResult: { ok: true, value: cloudCompletions },
    });

    expect(getWorkoutCompletion(0, 4)?.id).toBe('cloud-long-run');
    expect(getClearedWorkoutCompletions()['0:4']).toBeUndefined();
    expect(deleteCloudWorkoutCompletion).not.toHaveBeenCalled();
  });
});

describe('Charlie session cloudPending', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
  });

  it('stores pending sprint intent on the session record itself', () => {
    writeJSON('sprintTrainerHistory', [{
      id: 'session-1',
      date: '2026-01-01T00:00:00.000Z',
      cloudPending: true,
    }]);
    const pending = getCloudPendingSprintSessions();
    expect(pending).toHaveLength(1);
    expect(pending[0].cloudPending).toBe(true);
    expect(pending[0].id).toBe('session-1');
  });
});
