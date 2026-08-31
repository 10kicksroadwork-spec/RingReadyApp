import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
}));

import {
  ACTIVE_SESSION_KEY_PREFIX,
  LEGACY_ACTIVE_SESSION_STORAGE_KEY,
  LEGACY_SYNC_QUEUE_KEY,
  LEGACY_SYNC_QUEUE_QUARANTINE_KEY,
  SYNC_QUEUE_KEY_PREFIX,
} from '../src/constants.js';
import {
  clearActiveSessionCheckpointsForAllUsers,
  saveActiveSessionCheckpoint,
  loadActiveSessionCheckpoint,
} from '../src/session-checkpoint.js';
import { quarantineLegacySyncQueue, getLegacySyncQueueQuarantineCount } from '../src/sync.js';

const mockUser = { id: 'user-a' };

describe('account-scoped session checkpoint', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUser.id = 'user-a';
  });

  it('stores checkpoint under user-scoped key with userId', () => {
    saveActiveSessionCheckpoint(
      { reps: 8, rest: 90, maxHR: 180, targetPct: 90, workoutContext: null },
      { phase: 'resting', currentRep: 3, seconds: 45, data: [{ sprintHR: 170, restHR: 120, drop: 50 }], pendingRep: null, awaitingModal: false, capturedSprintHR: null, capturedRestHR: null },
    );
    const raw = JSON.parse(localStorage.getItem(`${ACTIVE_SESSION_KEY_PREFIX}user-a`));
    expect(raw.userId).toBe('user-a');
    expect(loadActiveSessionCheckpoint()?.state.currentRep).toBe(3);
  });

  it('does not resume another user checkpoint', () => {
    saveActiveSessionCheckpoint(
      { reps: 8, rest: 90, maxHR: 180, targetPct: 90, workoutContext: null },
      { phase: 'resting', currentRep: 4, seconds: 10, data: [], pendingRep: null, awaitingModal: false, capturedSprintHR: null, capturedRestHR: null },
    );
    mockUser.id = 'user-b';
    expect(loadActiveSessionCheckpoint()).toBeNull();
  });

  it('clears legacy global checkpoint key', () => {
    localStorage.setItem(LEGACY_ACTIVE_SESSION_STORAGE_KEY, '{}');
    clearActiveSessionCheckpointsForAllUsers();
    expect(localStorage.getItem(LEGACY_ACTIVE_SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('legacy sync queue quarantine', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('quarantines global queue without assigning to current user', () => {
    localStorage.setItem(LEGACY_SYNC_QUEUE_KEY, JSON.stringify([{ id: '1', status: 'pending', payload: {} }]));
    const result = quarantineLegacySyncQueue();
    expect(result.quarantined).toBe(1);
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_KEY)).toBeNull();
    expect(getLegacySyncQueueQuarantineCount()).toBe(1);
    expect(localStorage.getItem(`${SYNC_QUEUE_KEY_PREFIX}user-a`)).toBeNull();
    expect(localStorage.getItem(LEGACY_SYNC_QUEUE_QUARANTINE_KEY)).toBeTruthy();
  });
});
