import { describe, expect, it } from 'vitest';
import {
  PROGRAM,
  formatWorkoutDayLabel,
} from '../src/program.js';
import { buildWorkoutCloudPayload } from '../src/cloud-record-mapper.js';

describe('formatWorkoutDayLabel', () => {
  it('maps Saturday/Sunday to athlete display copy', () => {
    expect(formatWorkoutDayLabel('Saturday/Sunday')).toBe('Saturday or Sunday');
  });

  it('leaves weekday labels unchanged', () => {
    expect(formatWorkoutDayLabel('Monday')).toBe('Monday');
    expect(formatWorkoutDayLabel('Tuesday')).toBe('Tuesday');
  });

  it('returns empty string for empty input', () => {
    expect(formatWorkoutDayLabel('')).toBe('');
  });
});

describe('PROGRAM weekend day canonical value', () => {
  it('keeps Saturday/Sunday as the persisted program day', () => {
    const weekendWorkouts = PROGRAM.flatMap((week) =>
      week.workouts.filter((workout) => /saturday/i.test(workout.day)),
    );

    expect(weekendWorkouts.length).toBeGreaterThan(0);
    for (const workout of weekendWorkouts) {
      expect(workout.day).toBe('Saturday/Sunday');
    }
  });

  it('maps weekend completions to canonical day_of_week for Supabase', () => {
    const weekend = PROGRAM[0].workouts.find((workout) => workout.day === 'Saturday/Sunday');
    expect(weekend).toBeTruthy();

    const payload = buildWorkoutCloudPayload({
      id: 'weekend-completion',
      workoutContext: {
        weekIndex: 0,
        workoutIndex: 4,
        dayOfWeek: weekend.day,
        workoutType: weekend.type,
      },
      workoutLog: {
        totalMinutes: 45,
        completedAt: '2026-09-12T12:00:00.000Z',
      },
    }, 'user-a');

    expect(payload.day_of_week).toBe('Saturday/Sunday');
    expect(payload.day_of_week).not.toBe('Saturday or Sunday');
  });
});
