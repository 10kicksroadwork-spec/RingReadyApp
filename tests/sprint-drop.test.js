import { describe, expect, it } from 'vitest';
import { buildSessionPayload } from '../src/sync.js';
import { calculateAvgDrop, isLoggedDrop } from '../src/workout.js';

describe('sprint drop accounting', () => {
  const sessionData = [
    { sprintHR: 146, restHR: 147, drop: -1, suspicious: true },
    { sprintHR: 156, restHR: 147, drop: 9, suspicious: false },
    { sprintHR: 161, restHR: 147, drop: 14, suspicious: false },
    { sprintHR: 162, restHR: 152, drop: 10, suspicious: false },
    { sprintHR: 161, restHR: 146, drop: 15, suspicious: false },
  ];

  it('includes negative suspicious drops in average', () => {
    expect(calculateAvgDrop(sessionData)).toBe(9);
  });

  it('treats negative drops as logged values', () => {
    expect(isLoggedDrop(-1)).toBe(true);
    expect(isLoggedDrop(0)).toBe(true);
    expect(isLoggedDrop(null)).toBe(false);
  });

  it('sync payload includes negative drops in csv and avg', () => {
    const payload = buildSessionPayload(
      { reps: 5, rest: 90, maxHR: 183, targetPct: 90, workoutContext: { workoutType: 'Sprint Intervals' } },
      sessionData,
      { id: 'session-1' },
    );

    expect(payload.summary.avgDrop).toBe(9);
    expect(payload.summary.bpmDropCsv).toBe('-1, 9, 14, 10, 15');
    expect(payload.summary.validDropCount).toBe(5);
    expect(payload.reps[0]).toMatchObject({ drop: -1, suspicious: true });
  });
});
