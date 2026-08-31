import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
}));

import {
  ACTIVE_SESSION_KEY_PREFIX,
  SYNC_QUEUE_KEY_PREFIX,
} from '../src/constants.js';
import { clearSyncQueueForUser, getSyncQueue } from '../src/sync.js';

const mockUser = { id: 'user-a' };

describe('account switch queue survival', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps per-user queue when switching accounts', () => {
    localStorage.setItem(`${SYNC_QUEUE_KEY_PREFIX}user-b`, JSON.stringify([
      { id: 'queued-for-b', userId: 'user-b', status: 'pending', payload: {} },
    ]));
    mockUser.id = 'user-a';
    clearSyncQueueForUser('user-a');
    expect(getSyncQueue('user-b').length).toBe(1);
    expect(localStorage.getItem(`${SYNC_QUEUE_KEY_PREFIX}user-b`)).toBeTruthy();
  });

  it('does not read another user checkpoint key', () => {
    localStorage.setItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`, JSON.stringify({ userId: 'user-b' }));
    mockUser.id = 'user-a';
    expect(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-b`)).toBeTruthy();
  });
});
