import { describe, expect, it } from 'vitest';
import { PROGRAM, getSprintConfig, getWeek } from '../src/program.js';
import {
  applySprintPrescriptionToCfg,
  formatSprintPrescriptionMain,
  hasLoadedSprintPrescription,
  isValidSprintPrescription,
  resolveSprintPrescription,
  sessionCompletesAtRep,
} from '../src/sprint-prescription.js';
import { buildActiveSessionCheckpoint } from '../src/session-checkpoint.js';

function findSprintWorkout(weekIndex) {
  const week = getWeek(weekIndex);
  return week.workouts.find((workout) => workout.action === 'sprint') || null;
}

function buildContextForWeek(weekIndex) {
  const week = getWeek(weekIndex);
  const workoutIndex = week.workouts.findIndex((workout) => workout.action === 'sprint');
  const workout = week.workouts[workoutIndex];
  const sprintConfig = getSprintConfig(workout);
  return {
    weekIndex,
    workoutIndex,
    weekLabel: week.label,
    weekTitle: week.title,
    workoutType: workout.type,
    sprintConfig: sprintConfig ? { ...sprintConfig } : null,
  };
}

describe('sprint prescription lock', () => {
  it.each([
    [0, 5],
    [1, 6],
    [2, 8],
    [3, 5],
    [4, 10],
    [5, 5],
  ])('A-F: week %i sprint loads %i reps / 90 sec rest', (weekIndex, expectedReps) => {
    const workout = findSprintWorkout(weekIndex);
    const config = getSprintConfig(workout);
    expect(config).toEqual({
      reps: expectedReps,
      distanceMeters: 150,
      restSeconds: 90,
      restCaptureSeconds: 60,
    });

    const context = buildContextForWeek(weekIndex);
    const prescription = resolveSprintPrescription(context);
    expect(prescription?.reps).toBe(expectedReps);
    expect(prescription?.restSeconds).toBe(90);
    expect(formatSprintPrescriptionMain(prescription)).toBe(`${expectedReps} × 150m`);
  });

  it('G: athlete cannot mutate reps via prescription helper', () => {
    const context = buildContextForWeek(2);
    const cfg = { reps: null, rest: null };
    applySprintPrescriptionToCfg(cfg, context);
    expect(cfg.reps).toBe(8);

    context.sprintConfig.reps = 3;
    expect(cfg.reps).toBe(8);
  });

  it('H: athlete cannot mutate rest via prescription helper', () => {
    const context = buildContextForWeek(2);
    const cfg = { reps: null, rest: null };
    applySprintPrescriptionToCfg(cfg, context);
    expect(cfg.rest).toBe(90);

    context.sprintConfig.restSeconds = 45;
    expect(cfg.rest).toBe(90);
  });

  it('I: direct sprint launch without valid context is rejected', () => {
    expect(isValidSprintPrescription(null)).toBe(false);
    expect(isValidSprintPrescription({ weekIndex: 0, workoutIndex: 0 })).toBe(false);
    expect(isValidSprintPrescription({
      weekIndex: 0,
      workoutIndex: 0,
      sprintConfig: { reps: 0, restSeconds: 90 },
    })).toBe(false);

    const cfg = { reps: null, rest: null };
    expect(applySprintPrescriptionToCfg(cfg, null)).toBe(false);
    expect(hasLoadedSprintPrescription(cfg)).toBe(false);
  });

  it('J: W3 checkpoint after 4 reps resumes as rep 5 of 8', () => {
    const context = buildContextForWeek(2);
    const cfg = { reps: null, rest: null, maxHR: 183, targetPct: 90, workoutContext: context };
    applySprintPrescriptionToCfg(cfg, context);

    const checkpoint = buildActiveSessionCheckpoint(cfg, {
      phase: 'resting',
      currentRep: 4,
      seconds: 45,
      data: [
        { sprintHR: 180, restHR: 150, drop: 30, suspicious: false },
        { sprintHR: 182, restHR: 151, drop: 31, suspicious: false },
        { sprintHR: 181, restHR: 152, drop: 29, suspicious: false },
        { sprintHR: 183, restHR: 153, drop: 30, suspicious: false },
      ],
      pendingRep: null,
      awaitingModal: false,
      capturedSprintHR: null,
      capturedRestHR: null,
    }, null, 'user-test');

    expect(checkpoint.cfg.reps).toBe(8);
    expect(checkpoint.cfg.rest).toBe(90);
    expect(checkpoint.state.currentRep).toBe(4);
    expect(checkpoint.state.currentRep + 1).toBe(5);
    expect(checkpoint.state.data).toHaveLength(4);
  });

  it('K: W5 cannot complete after only 8 reps', () => {
    const context = buildContextForWeek(4);
    const cfg = { reps: null, rest: null };
    applySprintPrescriptionToCfg(cfg, context);
    expect(cfg.reps).toBe(10);
    expect(sessionCompletesAtRep(8, cfg)).toBe(false);
    expect(sessionCompletesAtRep(9, cfg)).toBe(false);
    expect(sessionCompletesAtRep(10, cfg)).toBe(true);
  });

  it('L: W1 followed by fresh W5 loads 10 reps, not stale 5', () => {
    const cfg = { reps: null, rest: null };
    applySprintPrescriptionToCfg(cfg, buildContextForWeek(0));
    expect(cfg.reps).toBe(5);

    applySprintPrescriptionToCfg(cfg, buildContextForWeek(4));
    expect(cfg.reps).toBe(10);
    expect(cfg.rest).toBe(90);
  });

  it('fight week has no sprint prescription', () => {
    const fightWeek = PROGRAM.find((week) => week.id === 'fight-week');
    const sprintWorkout = fightWeek?.workouts.find((workout) => workout.action === 'sprint');
    expect(sprintWorkout).toBeUndefined();
  });
});
