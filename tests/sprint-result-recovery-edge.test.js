import { describe, expect, it } from 'vitest';
import {
  getLatestSprintSessionForWorkout,
  resolveSprintProgramCardState,
  sprintSessionMatchesWorkout,
} from '../src/sprint-session-access.js';
import {
  mapCloudSprintSessionRow,
} from '../src/cloud-record-mapper.js';

function makeSprint(overrides = {}) {
  return {
    id: 'sprint-session-1',
    date: '2026-09-07T12:00:00.000Z',
    cfg: {
      workoutContext: {
        weekIndex: 3,
        workoutIndex: 0,
        workoutType: 'Sprint Intervals',
      },
    },
    data: [
      {
        sprintHR: 174,
        restHR: 138,
        drop: 36,
        suspicious: false,
      },
    ],
    avgDrop: 36,
    peakHR: 174,
    ...overrides,
  };
}

describe('Sprint recovery edge states', () => {
  it('distinguishes proof-saved/finalization-pending from proof-needed', () => {
    const sprintSession = makeSprint({
      attachment: {
        id: 'attachment-1',
        storagePath: 'user/week4/proof.webp',
      },
      proofPolicyVersion: 1,
    });
    const state = resolveSprintProgramCardState({
      completion: null,
      sprintSession,
      skipped: false,
    });
    expect(state.actionCopy).toBe('RESULTS');
    // Proof already exists. The athlete must not be told to upload it again.
    expect(state.tag).toBe('Finish Save');
    expect(state.resultRecord).toBe(sprintSession);
  });

  it('keeps a saved Sprint without proof in Proof Needed state', () => {
    const sprintSession = makeSprint();
    const state = resolveSprintProgramCardState({
      completion: null,
      sprintSession,
      skipped: false,
    });
    expect(state.tag).toBe('Proof Needed');
    expect(state.actionCopy).toBe('RESULTS');
    expect(state.resultRecord).toBe(sprintSession);
  });

  it('preserves relational week/workout identity through cloud mapping', () => {
    const mapped = mapCloudSprintSessionRow({
      session_id: 'legacy-session',
      session_at: '2026-09-07T12:00:00.000Z',
      week_index: 3,
      workout_index: 0,
      avg_drop: 32,
      peak_hr: 176,
      // Deliberately lacks cfg.workoutContext.
      session_json: {
        id: 'legacy-session',
        data: [
          {
            sprintHR: 176,
            restHR: 144,
            drop: 32,
            suspicious: false,
          },
        ],
      },
    });
    expect(mapped.weekIndex ?? mapped.week_index).toBe(3);
    expect(mapped.workoutIndex ?? mapped.workout_index).toBe(0);
    expect(sprintSessionMatchesWorkout(mapped, 3, 0)).toBe(true);
  });

  it('never assigns a Week 4 Sprint to Week 1', () => {
    const week4Sprint = makeSprint();
    expect(
      sprintSessionMatchesWorkout(week4Sprint, 0, 0),
    ).toBe(false);
    expect(
      getLatestSprintSessionForWorkout(
        [week4Sprint],
        0,
        0,
      ),
    ).toBeNull();
  });

  it('preserves week_index 0 through cloud mapping', () => {
    const mapped = mapCloudSprintSessionRow({
      session_id: 'week1-session',
      session_at: '2026-09-07T12:00:00.000Z',
      week_index: 0,
      workout_index: 0,
      session_json: {
        id: 'week1-session',
        data: [{ sprintHR: 170, restHR: 120, drop: 50, suspicious: false }],
      },
    });
    expect(mapped.weekIndex).toBe(0);
    expect(mapped.workoutIndex).toBe(0);
    expect(sprintSessionMatchesWorkout(mapped, 0, 0)).toBe(true);
    expect(sprintSessionMatchesWorkout(mapped, 3, 0)).toBe(false);
  });
});
