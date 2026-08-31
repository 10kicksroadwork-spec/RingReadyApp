import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => mockUser),
}));

vi.mock('../src/proof.js', () => ({}));

import { SYNC_ENDPOINT_KEY, SYNC_QUEUE_KEY_PREFIX } from '../src/constants.js';
import {
  MAX_QUEUE_ITEMS,
  MAX_SYNC_ATTEMPTS,
  enqueuePayloadForSync,
  flushSyncQueue,
  getFailedSyncCount,
  getPendingSyncCount,
  getSyncQueue,
  needsManualSyncRetry,
  trimSyncQueue,
} from '../src/sync.js';

const mockUser = { id: 'user-a' };

function queueKey() {
  return `${SYNC_QUEUE_KEY_PREFIX}${mockUser.id}`;
}

describe('sync retry and queue trimming', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    vi.stubGlobal('navigator', { onLine: true });
    localStorage.setItem(SYNC_ENDPOINT_KEY, 'https://script.google.com/macros/s/test/exec');
  });

  it('retries failed items automatically under the attempt cap', async () => {
    localStorage.setItem(queueKey(), JSON.stringify([
      { id: '1', userId: 'user-a', status: 'failed', attempts: 1, lastError: 'offline', payload: { eventType: 'mile_test', userId: 'user-a' } },
    ]));
    await flushSyncQueue();
    const item = getSyncQueue()[0];
    expect(item.status).toBe('dispatched');
    expect(item.attempts).toBe(2);
  });

  it('requires manual retry after the attempt cap', async () => {
    localStorage.setItem(queueKey(), JSON.stringify([
      { id: '1', userId: 'user-a', status: 'failed', attempts: MAX_SYNC_ATTEMPTS, lastError: 'blocked', payload: { eventType: 'mile_test', userId: 'user-a' } },
    ]));
    await flushSyncQueue();
    expect(getSyncQueue()[0].status).toBe('failed');
    expect(needsManualSyncRetry()).toBe(true);
    expect(getFailedSyncCount()).toBe(1);
    await flushSyncQueue({ manualRetry: true });
    expect(getSyncQueue()[0].status).toBe('dispatched');
    expect(getSyncQueue()[0].attempts).toBe(1);
  });

  it('evicts dispatched history before pending items at cap', () => {
    const queue = [];
    for (let i = 0; i < MAX_QUEUE_ITEMS; i += 1) {
      queue.push({ id: `pending-${i}`, status: 'pending', createdAt: new Date(Date.now() - i * 1000).toISOString() });
    }
    queue.push({ id: 'old-dispatched', status: 'dispatched', createdAt: '2020-01-01T00:00:00.000Z' });
    const trimmed = trimSyncQueue(queue);
    expect(trimmed.length).toBe(MAX_QUEUE_ITEMS);
    expect(trimmed.some((item) => item.id === 'old-dispatched')).toBe(false);
    expect(trimmed.filter((item) => item.status === 'pending').length).toBe(MAX_QUEUE_ITEMS);
  });

  it('preserves 51 pending items when no disposable history exists', () => {
    const queue = [];
    for (let i = 0; i < 51; i += 1) {
      queue.push({ id: `pending-${i}`, status: 'pending', createdAt: new Date(Date.now() - i * 1000).toISOString() });
    }
    const trimmed = trimSyncQueue(queue);
    expect(trimmed.length).toBe(51);
  });

  it('preserves mixed pending and failed overflow', () => {
    const queue = [];
    for (let i = 0; i < 30; i += 1) {
      queue.push({ id: `pending-${i}`, status: 'pending' });
    }
    for (let i = 0; i < 21; i += 1) {
      queue.push({ id: `failed-${i}`, status: 'failed', attempts: 1 });
    }
    const trimmed = trimSyncQueue(queue);
    expect(trimmed.length).toBe(51);
    expect(trimmed.filter((item) => item.status === 'pending').length).toBe(30);
    expect(trimmed.filter((item) => item.status === 'failed').length).toBe(21);
  });

  it('includes linkedRecordId and proofKey in workout row payloads', () => {
    enqueuePayloadForSync({
      eventType: 'daily_workout',
      userId: 'user-a',
      linkedRecordId: 'record-123',
      proofKey: 'program:7:0:2',
      workoutContext: { weekIndex: 0, workoutIndex: 2 },
    });
    const item = getSyncQueue()[0];
    expect(item.payload.linkedRecordId).toBe('record-123');
    expect(item.payload.proofKey).toBe('program:7:0:2');
    expect(getPendingSyncCount()).toBe(1);
  });

  it('workout_proof payload contains attachmentId only', () => {
    enqueuePayloadForSync({
      eventType: 'workout_proof',
      userId: 'user-a',
      attachmentId: 'attach-123',
      proofPolicyVersion: 2,
    });
    const item = getSyncQueue()[0];
    expect(item.payload.attachmentId).toBe('attach-123');
    expect(item.payload.linkedRecordId).toBeUndefined();
    expect(item.payload.proofKey).toBeUndefined();
  });

  it('dispatches daily_workout before workout_proof (oldest first)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const posted = [];
    fetchMock.mockImplementation(async (_url, init) => {
      posted.push(JSON.parse(init.body).eventType);
      return { ok: true };
    });

    enqueuePayloadForSync({
      eventType: 'daily_workout',
      userId: 'user-a',
      submittedAt: '2026-08-31T12:00:00.000Z',
      linkedRecordId: 'record-1',
    });
    enqueuePayloadForSync({
      eventType: 'workout_proof',
      userId: 'user-a',
      submittedAt: '2026-08-31T12:00:01.000Z',
      attachmentId: 'attach-1',
    });

    await flushSyncQueue();
    expect(posted).toEqual(['daily_workout', 'workout_proof']);
  });

  it('dispatches mile_test before workout_proof (oldest first)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const posted = [];
    fetchMock.mockImplementation(async (_url, init) => {
      posted.push(JSON.parse(init.body).eventType);
      return { ok: true };
    });

    enqueuePayloadForSync({
      eventType: 'mile_test',
      userId: 'user-a',
      submittedAt: '2026-08-31T12:00:00.000Z',
      linkedRecordId: 'mile-1',
    });
    enqueuePayloadForSync({
      eventType: 'workout_proof',
      userId: 'user-a',
      submittedAt: '2026-08-31T12:00:01.000Z',
      attachmentId: 'attach-2',
    });

    await flushSyncQueue();
    expect(posted).toEqual(['mile_test', 'workout_proof']);
  });
});
