import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
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
import { clearSyncQueueForUser, getSyncQueue } from '../src/sync.js';
import { performSignOutCleanup } from '../src/logout.js';

const mockUser = { id: 'user-a' };

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

describe('account switch shared state', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.id = 'user-a';
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

  it('A logout then B switch leaves zero Athlete A shared leakage and preserves B queue', async () => {
    seedAthleteASharedLocker();

    const getCurrentUser = vi.fn(() => ({ id: 'user-a' }));
    const signOut = vi.fn(async () => {
      getCurrentUser.mockReturnValue(null);
    });
    const clearAccountLocalData = vi.fn((userId) => {
      if (userId) {
        clearSyncQueueForUser(userId);
        localStorage.removeItem(`${ACTIVE_SESSION_KEY_PREFIX}${userId}`);
      }
      clearSharedLocalState();
    });

    await performSignOutCleanup({
      getCurrentUser,
      signOut,
      clearAccountLocalData,
    });

    expect(clearAccountLocalData).toHaveBeenCalledWith('user-a');
    expect(getSyncQueue('user-a').length).toBe(0);
    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(WORKOUT_COMPLETIONS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('ringReadyActiveWeekIndex')).toBeNull();
    expect(localStorage.getItem(SC_MODE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('ringReadyCoachPreviewNotes')).toBeNull();
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_KEY)).toBeNull();

    // Athlete B signs in on the same device.
    if (shouldClearSharedStateOnSwitch('user-a', 'user-b')) {
      clearSharedLocalState();
    }
    localStorage.setItem('ringReadyAuthUserId', 'user-b');

    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(getSyncQueue('user-b').length).toBe(1);
    expect(localStorage.getItem('ringReadyAuthUserId')).toBe('user-b');
  });
});
