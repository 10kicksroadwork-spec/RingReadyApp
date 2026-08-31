import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
}));

import {
  ACTIVE_SESSION_KEY_PREFIX,
  PROFILE_STORAGE_KEY,
  SYNC_QUEUE_KEY_PREFIX,
} from '../src/constants.js';
import {
  clearSharedLocalState,
  shouldClearSharedStateOnSwitch,
} from '../src/account-switch.js';
import { clearSyncQueueForUser, getSyncQueue } from '../src/sync.js';

const mockUser = { id: 'user-a' };

describe('account switch shared state', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('detects when a different user signs in', () => {
    expect(shouldClearSharedStateOnSwitch('user-a', 'user-b')).toBe(true);
    expect(shouldClearSharedStateOnSwitch('user-a', 'user-a')).toBe(false);
    expect(shouldClearSharedStateOnSwitch('', 'user-b')).toBe(false);
  });

  it('clears shared display keys without deleting per-user queues or checkpoints', () => {
    localStorage.setItem(`${SYNC_QUEUE_KEY_PREFIX}user-b`, JSON.stringify([
      { id: 'queued-for-b', userId: 'user-b', status: 'pending', payload: {} },
    ]));
    localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`, JSON.stringify({ userId: 'user-b' }));
    localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`, JSON.stringify({ userId: 'user-a' }));
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ athleteName: 'Shared' }));

    mockUser.id = 'user-a';
    clearSharedLocalState();

    expect(localStorage.getItem(PROFILE_STORAGE_KEY)).toBeNull();
    expect(getSyncQueue('user-b').length).toBe(1);
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`)).toBeTruthy();
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`)).toBeTruthy();
  });

  it('simulates A to B switch: B queue survives after clearSharedLocalState', () => {
    localStorage.setItem(`${SYNC_QUEUE_KEY_PREFIX}user-b`, JSON.stringify([
      { id: 'queued-for-b', userId: 'user-b', status: 'pending', payload: {} },
    ]));
    localStorage.setItem('ringReadyAuthUserId', 'user-a');

    if (shouldClearSharedStateOnSwitch('user-a', 'user-b')) {
      clearSharedLocalState();
    }

    clearSyncQueueForUser('user-a');
    expect(getSyncQueue('user-b').length).toBe(1);
  });
});
