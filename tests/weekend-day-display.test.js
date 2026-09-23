import { describe, expect, it } from 'vitest';
import {
  PROGRAM,
  formatWorkoutDayLabel,
} from '../src/program.js';

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
});
