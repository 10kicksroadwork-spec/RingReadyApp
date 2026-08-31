import { describe, expect, it } from 'vitest';
import {
  buildMileTestCloudPayload,
  buildWorkoutCloudPayload,
  getCompletionKeyFromRecord,
} from '../src/cloud-record-mapper.js';

describe('cloud record mapper', () => {
  it('maps workout client_record_id from local record id', () => {
    const record = {
      id: 'client-workout-123',
      workoutContext: { weekIndex: 0, workoutIndex: 2, workoutType: 'Threshold' },
      workoutLog: { totalMinutes: 45, completedAt: '2026-08-31T12:00:00.000Z' },
    };
    const payload = buildWorkoutCloudPayload(record, 'user-a');
    expect(payload.client_record_id).toBe('client-workout-123');
    expect(payload.week_index).toBe(0);
    expect(payload.workout_index).toBe(2);
    expect(getCompletionKeyFromRecord(record)).toBe('0:2');
  });

  it('maps mile test client_record_id and test_key', () => {
    const result = {
      id: 'client-mile-456',
      testKey: 'mile-test:baseline',
      distance: 1,
      totalMinutes: 8,
      savedAt: '2026-08-31T12:00:00.000Z',
    };
    const payload = buildMileTestCloudPayload(result, {}, { testKey: 'mile-test:baseline' }, 'user-a');
    expect(payload.client_record_id).toBe('client-mile-456');
    expect(payload.test_key).toBe('mile-test:baseline');
  });
});
