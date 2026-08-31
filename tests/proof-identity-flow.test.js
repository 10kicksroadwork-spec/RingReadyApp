import { describe, expect, it, vi, beforeEach } from 'vitest';

const authMocks = vi.hoisted(() => ({
  ensureCloudWorkoutIdentity: vi.fn(async () => 'client-id'),
  rollbackCloudWorkoutIdentity: vi.fn(async () => true),
  ensureCloudMileTestIdentity: vi.fn(async () => 'client-mile-id'),
  rollbackCloudMileTestIdentity: vi.fn(async () => true),
  getCurrentUser: vi.fn(() => ({ id: 'user-a' })),
}));

vi.mock('../src/auth.js', () => ({
  ...authMocks,
  saveCloudWorkoutCompletion: vi.fn(async (record) => record),
  saveCloudMileTest: vi.fn(async (result) => result),
  saveCloudSprintSession: vi.fn(async (record) => record),
}));

vi.mock('../src/supabase-client.js', () => ({
  isSupabaseConfigured: true,
}));

vi.mock('../src/proof.js', () => ({
  ensureWorkoutProofUploaded: vi.fn(async (_surface, linkedRecordId) => ({
    id: 'attachment-1',
    linkedRecordId,
  })),
  PROOF_POLICY_VERSION: 2,
}));

import {
  buildMileTestCloudPayload,
  buildWorkoutCloudPayload,
} from '../src/cloud-record-mapper.js';
import {
  ensureCloudMileTestIdentity,
  ensureCloudWorkoutIdentity,
  rollbackCloudMileTestIdentity,
  rollbackCloudWorkoutIdentity,
} from '../src/auth.js';
import { ensureWorkoutProofUploaded } from '../src/proof.js';

describe('proof identity workflow contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('establishes daily cloud identity before proof RPC uses client id', async () => {
    const record = {
      id: 'daily-client-id',
      workoutContext: { weekIndex: 1, workoutIndex: 3, workoutType: 'Threshold' },
      workoutLog: { totalMinutes: 40, completedAt: '2026-08-31T12:00:00.000Z' },
    };

    await ensureCloudWorkoutIdentity(record);
    const attachment = await ensureWorkoutProofUploaded('detail', record.id);

    expect(ensureCloudWorkoutIdentity.mock.invocationCallOrder[0])
      .toBeLessThan(ensureWorkoutProofUploaded.mock.invocationCallOrder[0]);
    expect(ensureWorkoutProofUploaded).toHaveBeenCalledWith('detail', 'daily-client-id');
    expect(buildWorkoutCloudPayload(record, 'user-a').client_record_id).toBe('daily-client-id');
    expect(attachment.linkedRecordId).toBe('daily-client-id');
  });

  it('rolls back provisional daily identity when proof fails', async () => {
    const record = { id: 'daily-client-id', workoutContext: { weekIndex: 0, workoutIndex: 1 } };
    await ensureCloudWorkoutIdentity(record);
    await rollbackCloudWorkoutIdentity(record);
    expect(rollbackCloudWorkoutIdentity).toHaveBeenCalledWith(record);
  });

  it('establishes mile cloud identity before proof RPC uses client id', async () => {
    const result = { id: 'mile-client-id', testKey: 'mile-test:week-2', savedAt: '2026-08-31T12:00:00.000Z' };
    const testContext = { testKey: 'mile-test:week-2' };

    await ensureCloudMileTestIdentity(result, {}, testContext);
    const attachment = await ensureWorkoutProofUploaded('mile', result.id);

    expect(ensureCloudMileTestIdentity.mock.invocationCallOrder[0])
      .toBeLessThan(ensureWorkoutProofUploaded.mock.invocationCallOrder[0]);
    expect(ensureWorkoutProofUploaded).toHaveBeenCalledWith('mile', 'mile-client-id');
    expect(buildMileTestCloudPayload(result, {}, testContext, 'user-a').client_record_id).toBe('mile-client-id');
    expect(attachment.linkedRecordId).toBe('mile-client-id');
  });

  it('rolls back provisional mile identity when proof fails', async () => {
    const result = { id: 'mile-client-id', testKey: 'mile-test:week-2' };
    const testContext = { testKey: 'mile-test:week-2' };
    await ensureCloudMileTestIdentity(result, {}, testContext);
    await rollbackCloudMileTestIdentity(result, testContext);
    expect(rollbackCloudMileTestIdentity).toHaveBeenCalledWith(result, testContext);
  });
});
