import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => ({ id: 'user-a' })),
}));

vi.mock('../src/hr-service.js', () => ({
  hrState: { source: 'manual' },
}));

import { buildDailyWorkoutPayload } from '../src/sync.js';
import { buildWorkoutLogFromCloudRow } from '../src/cloud-record-mapper.js';

describe('modality persistence', () => {
  it('includes modality and average watts for machine workouts in sheets payload', () => {
    const payload = buildDailyWorkoutPayload(
      {
        modality: 'assault_bike',
        outputType: 'watts',
        outputValue: 184,
        avgWatts: 184,
        totalMinutes: 30,
        avgBpm: 137,
        maxBpm: 165,
        completedAt: '2026-09-01T12:00:00.000Z',
      },
      { weekIndex: 3, workoutIndex: 1, workoutType: 'Benchmark Run' },
      'workout-record-1',
    );

    expect(payload.modality).toBe('assault_bike');
    expect(payload.workoutLog.outputType).toBe('watts');
    expect(payload.workoutLog.avgWatts).toBe(184);
    expect(payload.workoutLog.distance).toBe('');
  });

  it('hydrates output from relational columns without total_minutes', () => {
    const log = buildWorkoutLogFromCloudRow({
      modality: 'assault_bike',
      output_type: 'watts',
      output_value: 184,
      avg_watts: 184,
      distance: null,
      total_minutes: null,
    }, {});

    expect(log).not.toBeNull();
    expect(log.modality).toBe('assault_bike');
    expect(log.avgWatts).toBe(184);
    expect(log.distance).toBeNull();
  });

  it('reconstructs relational-only machine workout without JSON modality', () => {
    const log = buildWorkoutLogFromCloudRow({
      modality: 'rower',
      output_type: 'watts',
      output_value: 205,
      avg_watts: 205,
      total_minutes: 30,
      avg_bpm: 140,
    }, {});

    expect(log.modality).toBe('rower');
    expect(log.outputValue).toBe(205);
    expect(log.totalMinutes).toBe(30);
  });
});
