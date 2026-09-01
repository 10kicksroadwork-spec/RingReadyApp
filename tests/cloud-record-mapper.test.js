import { describe, expect, it } from 'vitest';
import {
  buildMileTestCloudPayload,
  buildProvisionalWorkoutCloudPayload,
  buildWorkoutCloudPayload,
  buildWorkoutLogFromCloudRow,
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

  it('maps running workout with null avg_watts', () => {
    const record = {
      id: 'client-workout-run',
      workoutContext: { weekIndex: 0, workoutIndex: 1, workoutType: 'Benchmark Run' },
      workoutLog: {
        modality: 'running',
        outputType: 'distance',
        outputValue: 3.35,
        distance: 3.35,
        avgWatts: null,
        totalMinutes: 30,
        avgBpm: 137,
        completedAt: '2026-08-31T12:00:00.000Z',
      },
    };
    const payload = buildWorkoutCloudPayload(record, 'user-a');
    expect(payload.modality).toBe('running');
    expect(payload.output_type).toBe('distance');
    expect(payload.output_value).toBe(3.35);
    expect(payload.distance).toBe(3.35);
    expect(payload.avg_watts).toBeNull();
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
        distance: null,
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

  it('maps rower and stationary bike modalities', () => {
    const rower = buildWorkoutCloudPayload({
      id: 'rower-1',
      workoutContext: { weekIndex: 1, workoutIndex: 1 },
      workoutLog: { modality: 'rower', outputType: 'watts', outputValue: 205, avgWatts: 205, totalMinutes: 30 },
    }, 'user-a');
    expect(rower.modality).toBe('rower');
    expect(rower.avg_watts).toBe(205);
    expect(rower.distance).toBeNull();

    const bike = buildWorkoutCloudPayload({
      id: 'bike-1',
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
      workoutLog: { modality: 'stationary_bike', outputType: 'watts', outputValue: 171, avgWatts: 171, totalMinutes: 30 },
    }, 'user-a');
    expect(bike.modality).toBe('stationary_bike');
    expect(bike.avg_watts).toBe(171);
    expect(bike.distance).toBeNull();
  });

  it('does not coerce null machine distance or running avg_watts to zero', () => {
    const machine = buildWorkoutCloudPayload({
      id: 'machine-null',
      workoutContext: { weekIndex: 0, workoutIndex: 0 },
      workoutLog: {
        modality: 'assault_bike',
        outputType: 'watts',
        outputValue: 184,
        avgWatts: null,
        distance: null,
        totalMinutes: 30,
      },
    }, 'user-a');
    expect(machine.distance).toBeNull();
    expect(machine.avg_watts).toBe(184);

    const running = buildWorkoutCloudPayload({
      id: 'running-null',
      workoutContext: { weekIndex: 0, workoutIndex: 0 },
      workoutLog: {
        modality: 'running',
        outputType: 'distance',
        outputValue: 3.35,
        distance: 3.35,
        avgWatts: null,
        totalMinutes: 30,
      },
    }, 'user-a');
    expect(running.avg_watts).toBeNull();
  });

  it('canonicalizes inconsistent assault_bike distance output to watts', () => {
    const payload = buildWorkoutCloudPayload({
      id: 'bike-inconsistent',
      workoutContext: { weekIndex: 0, workoutIndex: 0 },
      workoutLog: {
        modality: 'assault_bike',
        outputType: 'distance',
        outputValue: 184,
        avgWatts: 184,
        distance: 3.35,
        totalMinutes: 30,
      },
    }, 'user-a');
    expect(payload.output_type).toBe('watts');
    expect(payload.avg_watts).toBe(184);
    expect(payload.distance).toBeNull();
  });

  it('emits running modality when workoutLog is absent', () => {
    const payload = buildWorkoutCloudPayload({
      id: 'no-log',
      workoutContext: { weekIndex: 0, workoutIndex: 0 },
    }, 'user-a');
    expect(payload.modality).toBe('running');
    expect(payload.output_type).toBeNull();
    expect(payload.avg_watts).toBeNull();
    expect(payload.distance).toBeNull();
  });

  it('stages provisional rows with normalized modality and null outputs', () => {
    const legacy = buildProvisionalWorkoutCloudPayload({
      id: 'legacy',
      workoutContext: { weekIndex: 0, workoutIndex: 0 },
    }, 'user-a');
    expect(legacy.modality).toBe('running');
    expect(legacy.output_type).toBeNull();
    expect(legacy.avg_watts).toBeNull();
    expect(legacy.distance).toBeNull();

    const machine = buildProvisionalWorkoutCloudPayload({
      id: 'bike-stage',
      workoutContext: { weekIndex: 3, workoutIndex: 1 },
      workoutLog: { modality: 'assault_bike' },
    }, 'user-a');
    expect(machine.modality).toBe('assault_bike');
    expect(machine.avg_watts).toBeNull();
  });

  it('hydrates relational machine output when JSON avgWatts is null', () => {
    const log = buildWorkoutLogFromCloudRow({
      modality: 'rower',
      output_type: 'watts',
      output_value: 205,
      avg_watts: 205,
      distance: null,
      total_minutes: null,
    }, {
      workoutLog: {
        modality: null,
        avgWatts: null,
      },
    });
    expect(log.modality).toBe('rower');
    expect(log.avgWatts).toBe(205);
    expect(log.outputType).toBe('watts');
  });

  it('rejects invalid JSON modality in favor of relational rower', () => {
    const log = buildWorkoutLogFromCloudRow({
      modality: 'rower',
      output_type: 'watts',
      output_value: 205,
      avg_watts: 205,
    }, {
      workoutLog: {
        modality: 'garbage',
        avgWatts: null,
      },
    });
    expect(log.modality).toBe('rower');
    expect(log.avgWatts).toBe(205);
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
