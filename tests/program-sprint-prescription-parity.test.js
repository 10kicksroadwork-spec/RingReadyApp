import { describe, expect, it } from 'vitest';
import { PROGRAM, getSprintConfig } from '../src/program.js';
import { PROGRAM_SPRINT_PRESCRIPTIONS } from '../src/program-sprint-prescriptions.js';

describe('canonical sprint prescription parity', () => {
  it('matches PROGRAM sprint workouts to server-owned prescriptions', () => {
    const sprintRows = [];

    PROGRAM.forEach((week, weekIndex) => {
      week.workouts.forEach((workout, workoutIndex) => {
        if (workout.action !== 'sprint') return;

        const client = getSprintConfig(workout);
        const server = PROGRAM_SPRINT_PRESCRIPTIONS.find(
          (row) => row.weekIndex === weekIndex && row.workoutIndex === workoutIndex,
        );

        expect(server, `missing server prescription for week ${weekIndex} workout ${workoutIndex}`).toBeTruthy();
        expect(client.reps).toBe(server.reps);
        expect(client.restSeconds).toBe(server.restSeconds);
        expect(client.restCaptureSeconds).toBe(server.restCaptureSeconds);
        expect(client.distanceMeters).toBe(server.distanceMeters);

        sprintRows.push({
          week: weekIndex + 1,
          reps: server.reps,
          restSeconds: server.restSeconds,
          restCaptureSeconds: server.restCaptureSeconds,
          distanceMeters: server.distanceMeters,
        });
      });
    });

    expect(sprintRows).toEqual([
      { week: 1, reps: 5, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
      { week: 2, reps: 6, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
      { week: 3, reps: 8, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
      { week: 4, reps: 5, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
      { week: 5, reps: 10, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
      { week: 6, reps: 5, restSeconds: 90, restCaptureSeconds: 60, distanceMeters: 150 },
    ]);
  });
});
