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
  resolveCanonicalClientRecordId,
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

  it('preserves canonical client_record_id when refreshing a provisional workout row', () => {
    const existing = {
      client_record_id: 'client-workout-A',
      attachment_id: null,
      proof_pending: true,
    };
    const retryRecord = { ...record, id: 'client-workout-B' };
    expect(planWorkoutIdentityStaging(existing, retryRecord)).toEqual({
      action: 'refresh-provisional',
      created: true,
      clientRecordId: 'client-workout-A',
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

  it('preserves canonical client_record_id when refreshing a provisional mile row', () => {
    const existing = {
      client_record_id: 'client-mile-A',
      attachment_id: null,
      proof_pending: true,
    };
    const retryResult = { id: 'client-mile-B', testKey: 'mile-test:week-2' };
    expect(planMileTestIdentityStaging(existing, retryResult, testContext)).toEqual({
      action: 'refresh-provisional',
      created: true,
      clientRecordId: 'client-mile-A',
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

  it('uses the cloud canonical id when the form generates a new local id', () => {
    const existing = {
      client_record_id: 'mile-old',
      attachment_id: 'old-proof',
      proof_pending: false,
    };
    const replacementResult = { id: 'mile-new', testKey: 'mile-test:week-2' };
    const plan = planMileTestIdentityStaging(existing, replacementResult, testContext);
    const canonicalId = resolveCanonicalClientRecordId(
      { clientRecordId: plan.clientRecordId, created: plan.created },
      replacementResult.id,
    );

    expect(plan.clientRecordId).toBe('mile-old');
    expect(canonicalId).toBe('mile-old');
    expect(canonicalId).not.toBe('mile-new');
  });
});

describe('canonical client record id resolution', () => {
  it('prefers staging clientRecordId over a newly generated local id', () => {
    expect(resolveCanonicalClientRecordId({ clientRecordId: 'mile-old', created: false }, 'mile-new')).toBe('mile-old');
  });

  it('falls back to the local id for brand-new records', () => {
    expect(resolveCanonicalClientRecordId({ clientRecordId: 'mile-new', created: true }, 'mile-new')).toBe('mile-new');
    expect(resolveCanonicalClientRecordId(null, 'mile-new')).toBe('mile-new');
  });

  it('models mile replacement orchestration: staging noop + id rewrite before proof', () => {
    const testContext = { testKey: 'mile-test:baseline' };
    const existingCloud = {
      client_record_id: 'mile-old',
      attachment_id: 'proof-1',
      proof_pending: false,
    };
    const formResult = { id: 'mile-new', testKey: 'mile-test:baseline' };
    const staging = planMileTestIdentityStaging(existingCloud, formResult, testContext);
    const proofLinkedId = resolveCanonicalClientRecordId(staging, formResult.id);
    formResult.id = proofLinkedId;

    expect(staging.action).toBe('noop');
    expect(staging.created).toBe(false);
    expect(proofLinkedId).toBe('mile-old');
    expect(formResult.id).toBe('mile-old');
    expect(canRollbackProvisionalStaging(staging, existingCloud)).toBe(false);
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
