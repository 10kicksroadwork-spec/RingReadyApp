import { describe, expect, it } from 'vitest';
import {
  getLatestSprintSessionForWorkout,
  getSprintSessionsForWorkout,
  hasSavedSprintResults,
  pickAssignedSprintResultRecord,
  resolveSprintProgramCardState,
  sprintSessionMatchesWorkout,
} from '../src/sprint-session-access.js';

function buildSession({
  id = 'sprint-1',
  weekIndex = 0,
  workoutIndex = 0,
  date = '2026-09-07T12:00:00.000Z',
  contextStyle = 'cfg',
  data = [{ sprintHR: 172, restHR: 118, drop: 54, suspicious: false }],
} = {}) {
  const context = { weekIndex, workoutIndex, workoutType: 'Sprint Intervals' };
  const record = { id, date, data, avgDrop: 54, peakHR: 172 };
  if (contextStyle === 'cfg') record.cfg = { workoutContext: context };
  else if (contextStyle === 'top') record.workoutContext = context;
  else if (contextStyle === 'columns') {
    record.weekIndex = weekIndex;
    record.workoutIndex = workoutIndex;
  }
  return record;
}

describe('sprint session access', () => {
  it('rejects empty or missing interval data', () => {
    expect(hasSavedSprintResults(null)).toBe(false);
    expect(hasSavedSprintResults({ data: [] })).toBe(false);
    expect(hasSavedSprintResults(buildSession())).toBe(true);
  });

  it('matches assigned week/workout from cfg, top-level context, or column fallbacks', () => {
    expect(sprintSessionMatchesWorkout(buildSession({ contextStyle: 'cfg' }), 0, 0)).toBe(true);
    expect(sprintSessionMatchesWorkout(buildSession({ contextStyle: 'top' }), 0, 0)).toBe(true);
    expect(sprintSessionMatchesWorkout(buildSession({ contextStyle: 'columns' }), 0, 0)).toBe(true);
    expect(sprintSessionMatchesWorkout(buildSession({ weekIndex: 1 }), 0, 0)).toBe(false);
    expect(sprintSessionMatchesWorkout(buildSession({ workoutIndex: 1 }), 0, 0)).toBe(false);
  });

  it('returns the newest matching session for an assigned workout', () => {
    const older = buildSession({ id: 'older', date: '2026-09-01T00:00:00.000Z' });
    const newer = buildSession({ id: 'newer', date: '2026-09-07T00:00:00.000Z' });
    const otherWeek = buildSession({ id: 'w2', weekIndex: 1, date: '2026-09-08T00:00:00.000Z' });

    expect(getSprintSessionsForWorkout([older, otherWeek, newer], 0, 0).map((row) => row.id))
      .toEqual(['newer', 'older']);
    expect(getLatestSprintSessionForWorkout([older, otherWeek, newer], 0, 0)?.id).toBe('newer');
    expect(getLatestSprintSessionForWorkout([], 0, 0)).toBeNull();
  });

  it('prefers a finalized completion with results over a later saved session', () => {
    const completion = buildSession({ id: 'completed', date: '2026-09-01T00:00:00.000Z' });
    const laterSession = buildSession({ id: 'later-session', date: '2026-09-07T00:00:00.000Z' });
    expect(pickAssignedSprintResultRecord(completion, laterSession).id).toBe('completed');
    expect(pickAssignedSprintResultRecord(null, laterSession).id).toBe('later-session');
    expect(pickAssignedSprintResultRecord({ data: [] }, laterSession).id).toBe('later-session');
  });

  it('resolves Home card states without marking pending-proof Sprints done', () => {
    expect(resolveSprintProgramCardState({})).toMatchObject({
      tag: 'Timer Ready',
      action: 'OPEN TIMER',
      actionType: 'sprint',
      cardState: '',
      isFinalized: false,
    });

    const session = buildSession();
    expect(resolveSprintProgramCardState({ sprintSession: session })).toMatchObject({
      tag: 'Proof Needed',
      action: 'RESULTS',
      actionType: 'view-results',
      cardState: 'proof-needed',
      resultRecord: session,
      isFinalized: false,
    });

    const completion = { ...session, id: 'done', completedAt: '2026-09-07T13:00:00.000Z' };
    expect(resolveSprintProgramCardState({ completion, sprintSession: session })).toMatchObject({
      tag: 'Done',
      action: 'RESULTS',
      actionType: 'view-results',
      cardState: 'completed',
      isFinalized: true,
    });
  });
});
