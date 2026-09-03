import { describe, expect, it } from 'vitest';
import {
  buildMileTestCloudPayload,
  buildSprintCloudPayload,
  buildWorkoutCloudPayload,
  getCompletionKeyFromRecord,
  mapCloudSprintSessionRow,
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

  it('derives completion identity from week/workout over a stale completionKey', () => {
    const record = {
      id: 'client-workout-legacy',
      completionKey: 'legacy-stale-key',
      workoutContext: { weekIndex: 2, workoutIndex: 1, workoutType: 'Threshold Run' },
    };
    expect(getCompletionKeyFromRecord(record)).toBe('2:1');
    expect(buildWorkoutCloudPayload(record, 'user-a').completion_key).toBe('2:1');
  });

  it('does not invent a rounded week/workout position from decimal identity', () => {
    const payload = buildWorkoutCloudPayload({
      id: 'client-decimal',
      completionKey: 'should-not-round',
      workoutContext: { weekIndex: 1.5, workoutIndex: 2 },
      workoutLog: { totalMinutes: 30, completedAt: '2026-08-31T12:00:00.000Z' },
    }, 'user-a');
    expect(payload.week_index).toBeNull();
    expect(payload.workout_index).toBeNull();
    // Invalid position must not invent 2 via Math.round; legacy key may remain only as fallback.
    expect(payload.week_index).not.toBe(2);
    expect(payload.workout_index).not.toBe(2);
  });

  it('falls back to existing completionKey only when week/workout context is missing', () => {
    expect(getCompletionKeyFromRecord({ completionKey: 'orphan-key' })).toBe('orphan-key');
    expect(getCompletionKeyFromRecord({})).toBe('');
  });

  it('maps machine workout watts to first-class cloud columns', () => {
    const record = {
      id: 'client-workout-bike',
      workoutContext: { weekIndex: 3, workoutIndex: 1, workoutType: 'Benchmark Run' },
      workoutLog: {
        modality: 'assault_bike',
        outputType: 'watts',
        outputValue: 184,
        avgWatts: 184,
        totalMinutes: 30,
        completedAt: '2026-08-31T12:00:00.000Z',
      },
    };
    const payload = buildWorkoutCloudPayload(record, 'user-a');
    expect(payload.modality).toBe('assault_bike');
    expect(payload.output_type).toBe('watts');
    expect(payload.output_value).toBe(184);
    expect(payload.avg_watts).toBe(184);
    expect(payload.distance).toBeNull();
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

  it('strips cloudPending from sprint cloud upload payloads', () => {
    const record = {
      id: 'session-a',
      date: '2026-01-01T00:00:00.000Z',
      cloudPending: true,
      cfg: { reps: 4, rest: 60, workoutContext: { weekIndex: 1, workoutIndex: 0 } },
      data: [{ sprintHR: 170, restHR: 120, drop: 50, suspicious: false }],
    };
    const payload = buildSprintCloudPayload(record, 'user-a');
    expect(payload.session_id).toBe('session-a');
    expect(payload.session_json.cloudPending).toBeUndefined();
  });

  it('strips legacy cloudPending when mapping cloud sprint rows', () => {
    const mapped = mapCloudSprintSessionRow({
      session_id: 'session-a',
      session_at: '2026-01-01T00:00:00.000Z',
      session_json: {
        id: 'session-a',
        cloudPending: true,
        date: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(mapped.id).toBe('session-a');
    expect(mapped.cloudPending).toBeUndefined();
  });
});
