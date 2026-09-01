import { describe, expect, it, vi } from 'vitest';
import { performSignOutCleanup } from '../src/logout.js';
import { SYNC_QUEUE_KEY_PREFIX } from '../src/constants.js';
import { getSyncQueue } from '../src/sync.js';

describe('logout orchestration', () => {
  it('captures user id before sign-out and clears that user queue afterward', async () => {
    localStorage.clear();
    localStorage.setItem(`${SYNC_QUEUE_KEY_PREFIX}user-a`, JSON.stringify([
      { id: 'queued-for-a', userId: 'user-a', status: 'pending', payload: {} },
    ]));

    const getCurrentUser = vi.fn(() => ({ id: 'user-a' }));
    const signOut = vi.fn(async () => {
      getCurrentUser.mockReturnValue(null);
    });
    const clearAccountLocalData = vi.fn((userId) => {
      if (userId) {
        localStorage.removeItem(`${SYNC_QUEUE_KEY_PREFIX}${userId}`);
      }
    });

    await performSignOutCleanup({
      getCurrentUser,
      signOut,
      clearAccountLocalData,
    });

    expect(signOut).toHaveBeenCalledOnce();
    expect(clearAccountLocalData).toHaveBeenCalledWith('user-a');
    expect(getSyncQueue('user-a').length).toBe(0);
  });
});
