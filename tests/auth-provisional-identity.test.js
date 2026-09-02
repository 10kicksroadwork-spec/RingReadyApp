import { describe, expect, it } from 'vitest';
import { buildProvisionalMileTestCloudPayload, buildProvisionalWorkoutCloudPayload } from '../src/cloud-record-mapper.js';
import { planMileTestIdentityStaging, planWorkoutIdentityStaging } from '../src/proof-staging.js';

describe('auth provisional refresh payload seam', () => {
  it('workout refresh update payload keeps client_record_id A and record_json.id A', () => {
    const existing = {
      client_record_id: 'record-A',
      attachment_id: null,
      proof_pending: true,
    };
    const record = {
      id: 'record-B',
      status: 'completed',
      workoutContext: { weekIndex: 1, workoutIndex: 2, workoutType: 'Threshold' },
      workoutLog: { totalMinutes: 45, avgBpm: 150, completedAt: '2026-08-31T12:00:00.000Z' },
    };

    const staging = planWorkoutIdentityStaging(existing, record);
    const payload = buildProvisionalWorkoutCloudPayload({ ...record, id: staging.clientRecordId }, 'user-a');

    expect(staging).toMatchObject({ action: 'refresh-provisional', clientRecordId: 'record-A' });
    expect(payload.client_record_id).toBe('record-A');
    expect(payload.record_json.id).toBe('record-A');
  });

  it('mile refresh update payload keeps client_record_id A and result_json.id A', () => {
    const existing = {
      client_record_id: 'mile-record-A',
      attachment_id: null,
      proof_pending: true,
    };
    const result = { id: 'mile-record-B', testKey: 'mile-test:week-2' };
    const testContext = { testKey: 'mile-test:week-2' };

    const staging = planMileTestIdentityStaging(existing, result, testContext);
    const payload = buildProvisionalMileTestCloudPayload(
      { ...result, id: staging.clientRecordId },
      testContext,
      'user-a',
    );

    expect(staging).toMatchObject({ action: 'refresh-provisional', clientRecordId: 'mile-record-A' });
    expect(payload.client_record_id).toBe('mile-record-A');
    expect(payload.result_json.id).toBe('mile-record-A');
  });
});
