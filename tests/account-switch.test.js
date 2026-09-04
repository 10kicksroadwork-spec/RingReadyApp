import { describe, expect, it, beforeEach, vi } from 'vitest';

const mockUser = { id: 'user-a' };

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
  initSupabaseAuth: vi.fn(),
  isCoachUser: vi.fn(() => false),
  signInWithEmail: vi.fn(),
  signOut: vi.fn(),
  signUpWithEmail: vi.fn(),
  updatePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  loadCloudProfile: vi.fn(),
  loadCloudHRInfo: vi.fn(),
  loadCloudWorkoutCompletions: vi.fn(),
  loadCloudSprintSessions: vi.fn(),
  loadCloudMileTest: vi.fn(),
  saveCloudWorkoutCompletion: vi.fn(),
  saveCloudSprintSession: vi.fn(),
  saveCloudMileTest: vi.fn(),
  saveCloudProfile: vi.fn(),
  saveCloudHRInfo: vi.fn(),
  deleteCloudWorkoutCompletion: vi.fn(),
  clearCloudWorkoutCompletionWithProof: vi.fn(),
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

import {
  ACTIVE_SESSION_KEY_PREFIX,
  LEGACY_SYNC_QUEUE_KEY,
  LEGACY_SYNC_QUEUE_QUARANTINE_KEY,
  PROFILE_STORAGE_KEY,
  SYNC_QUEUE_KEY_PREFIX,
  WORKOUT_COMPLETIONS_STORAGE_KEY,
} from '../src/constants.js';
import {
  HR_INFO_STORAGE_KEY,
  MILE_TEST_STORAGE_KEY,
  SC_MODE_STORAGE_KEY,
  SC_WEEK_STORAGE_KEY,
} from '../src/app-content.js';
import {
  ATHLETE_SHARED_STORAGE_KEYS,
  clearSharedLocalState,
  shouldClearSharedStateOnSwitch,
  shouldFailClosedClearSharedCache,
} from '../src/account-switch.js';
import { getSyncQueue } from '../src/sync.js';
import { performSignOutCleanup } from '../src/logout.js';
import { setSelectedCoachAthlete } from '../src/coach-preview.js';
import { cloudHydrationTestHooks } from '../src/shell.js';
import {
  hrState,
  setHRConnected,
  hrServiceTestHooks,
} from '../src/hr-service.js';
import { MODALITY_RUNNING } from '../src/modality.js';
import {
  resetVolatileStorageForTest,
  resetStorageAvailabilityCache,
} from '../src/safe-storage.js';
import { resetSprintRuntimeForAccountBoundary } from '../src/app.js';

function seedAthleteASharedLocker() {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ athleteName: 'Athlete A' }));
  localStorage.setItem(WORKOUT_COMPLETIONS_STORAGE_KEY, JSON.stringify([{ id: 'a-complete' }]));
  localStorage.setItem(HR_INFO_STORAGE_KEY, JSON.stringify({ maxHr: 190 }));
  localStorage.setItem(MILE_TEST_STORAGE_KEY, JSON.stringify({ distance: 1 }));
  localStorage.setItem('ringReadyActiveWeekIndex', '3');
  localStorage.setItem(SC_MODE_STORAGE_KEY, 'Assault Bike');
  localStorage.setItem(SC_WEEK_STORAGE_KEY, '4');
  localStorage.setItem('ringReadyOnboardingDismissed', '1');
  localStorage.setItem('ringReadyModalitySwitchNoteSeen', '1');
  localStorage.setItem('ringReadyCoachPreviewNotes', JSON.stringify({ 'user-a': 'secret' }));
  localStorage.setItem(LEGACY_SYNC_QUEUE_KEY, JSON.stringify([{ id: 'legacy-a', payload: { athleteName: 'A' } }]));
  localStorage.setItem(LEGACY_SYNC_QUEUE_QUARANTINE_KEY, JSON.stringify([{ id: 'q-a' }]));
  localStorage.setItem(`${SYNC_QUEUE_KEY_PREFIX}user-a`, JSON.stringify([
    { id: 'queued-for-a', userId: 'user-a', status: 'pending', payload: {} },
  ]));
  localStorage.setItem(`${SYNC_QUEUE_KEY_PREFIX}user-b`, JSON.stringify([
    { id: 'queued-for-b', userId: 'user-b', status: 'pending', payload: {} },
  ]));
  localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`, JSON.stringify({ userId: 'user-a' }));
  localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`, JSON.stringify({ userId: 'user-b' }));
  localStorage.setItem('ringReadyAuthUserId', 'user-a');
}

function seedAthleteARuntime() {
  cloudHydrationTestHooks.seedAthleteRuntimeStateForTest({
    activeWeekIndex: 3,
    scMode: 'Assault Bike',
    scWeek: 4,
    detailModality: 'rower',
    detailModalityInitialized: true,
  });
  setSelectedCoachAthlete.mockClear();
  setHRConnected("Athlete A's Monitor", 'web-ble');
  hrServiceTestHooks.setAcceptTransportHRForTest(true);
}

describe('account switch shared state', () => {
  beforeEach(() => {
    localStorage.clear();
    resetVolatileStorageForTest();
    resetStorageAvailabilityCache();
    mockUser.id = 'user-a';
    cloudHydrationTestHooks.setShellHooksForTest({
      resetSprintRuntimeForAccountBoundary,
    });
    cloudHydrationTestHooks.resetAthleteRuntimeState();
    hrServiceTestHooks.setAcceptTransportHRForTest(true);
    setSelectedCoachAthlete.mockClear();
  });

  it('detects when a different user signs in', () => {
    expect(shouldClearSharedStateOnSwitch('user-a', 'user-b')).toBe(true);
    expect(shouldClearSharedStateOnSwitch('user-a', 'user-a')).toBe(false);
    expect(shouldClearSharedStateOnSwitch('', 'user-b')).toBe(false);
  });

  it('fail-closed clears when shared cache exists without an owner marker', () => {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ athleteName: 'Orphan' }));
    expect(shouldFailClosedClearSharedCache('', 'user-b')).toBe(true);
    expect(shouldFailClosedClearSharedCache('user-a', 'user-b')).toBe(false);
  });

  it('clears expanded shared locker keys without deleting per-user queues or checkpoints', () => {
    seedAthleteASharedLocker();
    mockUser.id = 'user-a';
    clearSharedLocalState();

    for (const key of ATHLETE_SHARED_STORAGE_KEYS) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_QUARANTINE_KEY)).toBeNull();
    expect(getSyncQueue('user-b').length).toBe(1);
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`)).toBeTruthy();
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeTruthy();
  });

  it('real clearAccountLocalData on logout clears A scoped + shared + runtime and severs HR', async () => {
    seedAthleteASharedLocker();
    seedAthleteARuntime();

    const getCurrentUser = vi.fn(() => ({ id: 'user-a' }));
    const signOut = vi.fn(async () => {
      getCurrentUser.mockReturnValue(null);
      mockUser.id = '';
    });

    await performSignOutCleanup({
      getCurrentUser,
      signOut,
      clearAccountLocalData: cloudHydrationTestHooks.clearAccountLocalData,
    });

    expect(getSyncQueue('user-a').length).toBe(0);
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeNull();
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_KEY)).toBeNull();
    expect(getSyncQueue('user-b').length).toBe(1);
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`)).toBeTruthy();

    const runtime = cloudHydrationTestHooks.getAthleteRuntimeSnapshot();
    expect(runtime.activeWeekIndex).toBe(0);
    expect(runtime.scMode).toBe('Gym Machines');
    expect(runtime.scWeek).toBe(1);
    expect(runtime.detailModality).toBe(MODALITY_RUNNING);
    expect(runtime.hrConnected).toBe(false);
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(false);
    expect(setSelectedCoachAthlete).toHaveBeenCalledWith('');
  });

  it('direct SIGNED_IN(B) without SIGNED_OUT resets A runtime and storage, keeps B scoped data', () => {
    seedAthleteASharedLocker();
    seedAthleteARuntime();

    // Multi-tab replacement: B becomes current user with no preceding SIGNED_OUT.
    mockUser.id = 'user-b';
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    for (const key of ATHLETE_SHARED_STORAGE_KEYS) {
      expect(localStorage.getItem(key), key).toBeNull();
    }
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_KEY)).toBeNull();
    expect(localStorage.getItem('ringReadyAuthUserId')).toBe('user-b');
    expect(getSyncQueue('user-b').length).toBe(1);
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`)).toBeTruthy();
    // A's scoped queue is intentionally not cleared on switch-in (logout path clears it).
    expect(getSyncQueue('user-a').length).toBe(1);

    const runtime = cloudHydrationTestHooks.getAthleteRuntimeSnapshot();
    expect(runtime.activeWeekIndex).toBe(0);
    expect(runtime.scMode).toBe('Gym Machines');
    expect(runtime.scWeek).toBe(1);
    expect(runtime.detailModality).toBe(MODALITY_RUNNING);
    expect(runtime.hrConnected).toBe(false);
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(false);
    expect(setSelectedCoachAthlete).toHaveBeenCalledWith('');
  });

  it('same-user SIGNED_IN(A) does not destructively reset A runtime or locker', () => {
    seedAthleteASharedLocker();
    seedAthleteARuntime();
    const before = cloudHydrationTestHooks.getAthleteRuntimeSnapshot();

    mockUser.id = 'user-a';
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toContain('Athlete A');
    expect(localStorage.getItem(SC_MODE_STORAGE_KEY)).toBe('Assault Bike');
    expect(getSyncQueue('user-a').length).toBe(1);
    expect(localStorage.getItem('ringReadyAuthUserId')).toBe('user-a');

    const after = cloudHydrationTestHooks.getAthleteRuntimeSnapshot();
    expect(after.activeWeekIndex).toBe(before.activeWeekIndex);
    expect(after.scMode).toBe(before.scMode);
    expect(after.scWeek).toBe(before.scWeek);
    expect(after.detailModality).toBe(before.detailModality);
    expect(after.hrConnected).toBe(true);
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(true);
  });

  it('late HR sample after account boundary does not reconnect Athlete B', () => {
    seedAthleteARuntime();
    expect(hrState.connected).toBe(true);

    mockUser.id = 'user-b';
    localStorage.setItem('ringReadyAuthUserId', 'user-a');
    cloudHydrationTestHooks.prepareAccountSwitchSafety();

    expect(hrState.connected).toBe(false);
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(false);

    hrServiceTestHooks.handleTransportHR({
      hr: 168,
      avg: 165,
      at: Date.now(),
      source: 'web-ble',
    });

    expect(hrState.connected).toBe(false);
    expect(hrState.current).toBeNull();
    expect(cloudHydrationTestHooks.getAthleteRuntimeSnapshot().hrConnected).toBe(false);
  });
});
