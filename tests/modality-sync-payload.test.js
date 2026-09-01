import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => ({ id: 'user-a' })),
}));

vi.mock('../src/hr-service.js', () => ({
  hrState: { source: 'manual' },
}));

import { buildDailyWorkoutPayload } from '../src/sync.js';

describe('daily workout sheets payload', () => {
  it('includes modality and average watts for machine workouts', () => {
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
});
