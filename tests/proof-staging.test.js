import { describe, expect, it } from 'vitest';
import {
  buildProvisionalMileTestCloudPayload,
  buildProvisionalWorkoutCloudPayload,
  buildWorkoutCloudPayload,
} from '../src/cloud-record-mapper.js';
import {
  canRollbackProvisionalStaging,
  isVisibleCompletionRow,
  planMileTestIdentityStaging,
  planWorkoutIdentityStaging,
} from '../src/proof-staging.js';

describe('proof staging plans', () => {
  const record = {
    id: 'client-workout-1',
    status: 'completed',
    workoutContext: { weekIndex: 1, workoutIndex: 2, workoutType: 'Threshold' },
    workoutLog: { totalMinutes: 45, avgBpm: 150, completedAt: '2026-08-31T12:00:00.000Z' },
  };

  it('inserts a provisional row for brand-new workouts', () => {
    expect(planWorkoutIdentityStaging(null, record)).toEqual({
      action: 'insert-provisional',
      created: true,
      clientRecordId: 'client-workout-1',
      completionKey: '1:2',
    });
  });

  it('does not treat an existing completion as provisional', () => {
    const existing = {
      client_record_id: 'client-workout-1',
      attachment_id: 'old-proof',
      proof_pending: false,
    };
    expect(planWorkoutIdentityStaging(existing, record)).toEqual({
      action: 'noop',
      created: false,
      clientRecordId: 'client-workout-1',
      completionKey: '1:2',
    });
  });

  it('only patches client_record_id for legacy rows without attachment', () => {
    const existing = {
      client_record_id: '',
      attachment_id: null,
      proof_pending: false,
    };
    expect(planWorkoutIdentityStaging(existing, record)).toEqual({
      action: 'patch-client-id',
      created: false,
      clientRecordId: 'client-workout-1',
      completionKey: '1:2',
    });
  });

  it('preserves existing rows with attachment during replacement attempts', () => {
    const existing = {
      client_record_id: 'client-workout-1',
      attachment_id: 'existing-proof',
      proof_pending: false,
    };
    const plan = planWorkoutIdentityStaging(existing, record);
    expect(plan.action).toBe('noop');
    expect(plan.created).toBe(false);
    expect(canRollbackProvisionalStaging(plan, existing)).toBe(false);
  });

  it('allows rollback only for explicitly provisional rows', () => {
    const staging = { created: true };
    expect(canRollbackProvisionalStaging(staging, { proof_pending: true })).toBe(true);
    expect(canRollbackProvisionalStaging(staging, { proof_pending: false })).toBe(false);
    expect(canRollbackProvisionalStaging({ created: false }, { proof_pending: true })).toBe(false);
  });

  it('hides pending rows from athlete and coach hydration', () => {
    expect(isVisibleCompletionRow({ proof_pending: true })).toBe(false);
    expect(isVisibleCompletionRow({ proof_pending: false })).toBe(true);
    expect(isVisibleCompletionRow({})).toBe(true);
  });
});

describe('mile proof staging plans', () => {
  const result = { id: 'client-mile-1', testKey: 'mile-test:week-2' };
  const testContext = { testKey: 'mile-test:week-2' };

  it('inserts provisional mile identity for new tests', () => {
    expect(planMileTestIdentityStaging(null, result, testContext)).toEqual({
      action: 'insert-provisional',
      created: true,
      clientRecordId: 'client-mile-1',
      testKey: 'mile-test:week-2',
    });
  });

  it('does not overwrite an existing mile result during replacement', () => {
    const existing = {
      client_record_id: 'client-mile-1',
      attachment_id: 'old-proof',
      proof_pending: false,
    };
    const plan = planMileTestIdentityStaging(existing, result, testContext);
    expect(plan.action).toBe('noop');
    expect(plan.created).toBe(false);
    expect(canRollbackProvisionalStaging(plan, existing)).toBe(false);
  });
});

describe('provisional cloud payloads', () => {
  it('stores minimal pending-proof workout identity without completion metrics', () => {
    const record = {
      id: 'client-workout-1',
      status: 'completed',
      workoutContext: { weekIndex: 0, workoutIndex: 1, workoutType: 'Threshold' },
      workoutLog: { totalMinutes: 40, avgBpm: 150, completedAt: '2026-08-31T12:00:00.000Z' },
    };
    const provisional = buildProvisionalWorkoutCloudPayload(record, 'user-a');
    const finalized = buildWorkoutCloudPayload(record, 'user-a');

    expect(provisional.proof_pending).toBe(true);
    expect(provisional.completed_at).toBeNull();
    expect(provisional.total_minutes).toBeNull();
    expect(provisional.attachment_id).toBeNull();
    expect(provisional.record_json.status).toBe('pending_proof');
    expect(finalized.proof_pending).toBe(false);
    expect(finalized.total_minutes).toBe(40);
  });

  it('stores minimal pending-proof mile identity without result metrics', () => {
    const result = {
      id: 'client-mile-1',
      testKey: 'mile-test:baseline',
      distance: 1,
      totalMinutes: 8,
      savedAt: '2026-08-31T12:00:00.000Z',
    };
    const provisional = buildProvisionalMileTestCloudPayload(result, { testKey: 'mile-test:baseline' }, 'user-a');

    expect(provisional.proof_pending).toBe(true);
    expect(provisional.saved_at).toBeNull();
    expect(provisional.distance).toBeNull();
    expect(provisional.attachment_id).toBeNull();
    expect(provisional.result_json.status).toBe('pending_proof');
  });
});
