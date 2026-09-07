import { describe, expect, it } from 'vitest';
import {
  dueStatusLabel,
  getSessionScheduleState,
  isSessionDueYet,
  sessionDueDate,
  sessionOpenEndDate,
} from '../src/coach-camp-schedule.js';
import { buildAthleteRecord } from '../src/coach-preview.js';

/** Week 1 Monday = 2026-09-07. Tuesday workout is 2026-09-08. */
const CAMP_START = '2026-09-07';

function atLocalNoon(isoDate) {
  return new Date(`${isoDate}T12:00:00`);
}

function atLocalEvening(isoDate) {
  return new Date(`${isoDate}T23:59:00`);
}

function atLocalMorning(isoDate) {
  return new Date(`${isoDate}T08:00:00`);
}

describe('coach camp schedule grace window', () => {
  it('maps Tuesday workout due/open end to Tuesday', () => {
    expect(sessionDueDate(CAMP_START, 0, 'Tuesday').toISOString().slice(0, 10)).toBe('2026-09-08');
    expect(sessionOpenEndDate(CAMP_START, 0, 'Tuesday').toISOString().slice(0, 10)).toBe('2026-09-08');
  });

  it('keeps Saturday/Sunday open through Sunday', () => {
    expect(sessionDueDate(CAMP_START, 0, 'Saturday/Sunday').toISOString().slice(0, 10)).toBe('2026-09-12');
    expect(sessionOpenEndDate(CAMP_START, 0, 'Saturday/Sunday').toISOString().slice(0, 10)).toBe('2026-09-13');
  });

  it('classifies Tuesday workout across Monday → Wednesday', () => {
    expect(getSessionScheduleState(CAMP_START, 0, 'Tuesday', atLocalNoon('2026-09-07'))).toBe('upcoming');
    expect(getSessionScheduleState(CAMP_START, 0, 'Tuesday', atLocalMorning('2026-09-08'))).toBe('open');
    expect(getSessionScheduleState(CAMP_START, 0, 'Tuesday', atLocalNoon('2026-09-08'))).toBe('open');
    expect(getSessionScheduleState(CAMP_START, 0, 'Tuesday', atLocalEvening('2026-09-08'))).toBe('open');
    expect(getSessionScheduleState(CAMP_START, 0, 'Tuesday', atLocalMorning('2026-09-09'))).toBe('overdue');
  });

  it('classifies Saturday/Sunday across Fri → Mon', () => {
    expect(getSessionScheduleState(CAMP_START, 0, 'Saturday/Sunday', atLocalNoon('2026-09-11'))).toBe('upcoming');
    expect(getSessionScheduleState(CAMP_START, 0, 'Saturday/Sunday', atLocalNoon('2026-09-12'))).toBe('open');
    expect(getSessionScheduleState(CAMP_START, 0, 'Saturday/Sunday', atLocalNoon('2026-09-13'))).toBe('open');
    expect(getSessionScheduleState(CAMP_START, 0, 'Saturday/Sunday', atLocalMorning('2026-09-14'))).toBe('overdue');
  });

  it('keeps isSessionDueYet true on the scheduled day without meaning Missing', () => {
    expect(isSessionDueYet(CAMP_START, 0, 'Tuesday', atLocalMorning('2026-09-08'))).toBe(true);
    expect(getSessionScheduleState(CAMP_START, 0, 'Tuesday', atLocalMorning('2026-09-08'))).toBe('open');
  });

  it('labels weekend vs weekday due statuses', () => {
    expect(dueStatusLabel('Tuesday')).toBe('due-today');
    expect(dueStatusLabel('Saturday/Sunday')).toBe('due-weekend');
  });
});

describe('coach missing / adherence grace semantics', () => {
  it('shows Due Today on Tuesday AM/PM/late evening and does not count Missing', () => {
    for (const now of ['2026-09-08T08:00:00', '2026-09-08T15:00:00', '2026-09-08T23:59:00']) {
      const athlete = buildAthleteRecord({
        id: 'grace',
        name: 'Grace Tester',
        campLength: 7,
        currentWeekIndex: 0,
        campStartDate: CAMP_START,
        now: new Date(now),
        missing: ['0:1'],
        skipped: [],
        missingProofs: [],
      });
      const tue = athlete.sessions.find((session) => session.key === '0:1');
      expect(tue.day).toMatch(/Tuesday/i);
      expect(tue.status).toBe('due-today');
      expect(athlete.missingCount).toBe(0);
      expect(athlete.tone).not.toBe('behind');
    }
  });

  it('shows Upcoming on Monday before Tuesday', () => {
    const athlete = buildAthleteRecord({
      id: 'grace',
      name: 'Grace Tester',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: CAMP_START,
      now: atLocalNoon('2026-09-07'),
      missing: ['0:1'],
      skipped: [],
      missingProofs: [],
    });
    const tue = athlete.sessions.find((session) => session.key === '0:1');
    expect(tue.status).toBe('upcoming');
    expect(athlete.missingCount).toBe(0);
  });

  it('becomes Missing on Wednesday when still unlogged', () => {
    const athlete = buildAthleteRecord({
      id: 'grace',
      name: 'Grace Tester',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: CAMP_START,
      now: atLocalMorning('2026-09-09'),
      missing: ['0:1'],
      skipped: [],
      missingProofs: [],
    });
    const tue = athlete.sessions.find((session) => session.key === '0:1');
    expect(tue.status).toBe('missing');
    expect(athlete.missingCount).toBe(1);
    expect(athlete.tone).toBe('behind');
  });

  it('keeps Logged when completed during the open window and viewed later', () => {
    const athlete = buildAthleteRecord({
      id: 'grace',
      name: 'Grace Tester',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: CAMP_START,
      now: atLocalMorning('2026-09-09'),
      missing: [], // logged — not in missing set
      skipped: [],
      missingProofs: [],
      avgs: { '0:1': 141 },
    });
    const tue = athlete.sessions.find((session) => session.key === '0:1');
    expect(tue.status).toBe('logged');
    expect(athlete.missingCount).toBe(0);
  });

  it('excludes open Due Today from Schedule Adherence denominator', () => {
    // Monday logged, Tuesday still open → adherence 100%, missing 0
    const athlete = buildAthleteRecord({
      id: 'grace',
      name: 'Grace Tester',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: CAMP_START,
      now: atLocalNoon('2026-09-08'),
      missing: ['0:1', '0:2', '0:3', '0:4'], // only Monday (0:0) logged
      skipped: [],
      missingProofs: [],
      avgs: { '0:0': 150 },
    });
    const mon = athlete.sessions.find((session) => session.key === '0:0');
    const tue = athlete.sessions.find((session) => session.key === '0:1');
    expect(mon.status).toBe('logged');
    expect(tue.status).toBe('due-today');
    expect(athlete.missingCount).toBe(0);
    expect(athlete.completionPct).toBe(100);
    expect(athlete.tone).toBe('on-track');
  });

  it('counts overdue Missing against Schedule Adherence the next day', () => {
    const athlete = buildAthleteRecord({
      id: 'grace',
      name: 'Grace Tester',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: CAMP_START,
      now: atLocalMorning('2026-09-09'),
      missing: ['0:1', '0:2', '0:3', '0:4'],
      skipped: [],
      missingProofs: [],
      avgs: { '0:0': 150 },
    });
    expect(athlete.sessions.find((session) => session.key === '0:1').status).toBe('missing');
    expect(athlete.missingCount).toBe(1);
    expect(athlete.logged).toBe(1);
    expect(athlete.due).toBe(2); // Monday logged + Tuesday missing; Wed+ still upcoming/open?
    // Wednesday morning: Wed/Thu/Fri/weekend still upcoming relative to Sep 9
    expect(athlete.completionPct).toBe(50);
    expect(athlete.tone).toBe('behind');
  });

  it('shows Due This Weekend on Sat and Sun for Saturday/Sunday slots', () => {
    for (const day of ['2026-09-12', '2026-09-13']) {
      const athlete = buildAthleteRecord({
        id: 'grace',
        name: 'Grace Tester',
        campLength: 7,
        currentWeekIndex: 0,
        campStartDate: CAMP_START,
        now: atLocalNoon(day),
        missing: ['0:4'],
        skipped: [],
        missingProofs: [],
      });
      const weekend = athlete.sessions.find((session) => session.key === '0:4');
      expect(weekend.day).toMatch(/Saturday\/Sunday|Sat\/Sun/i);
      expect(weekend.status).toBe('due-weekend');
      expect(athlete.sessions.some((session) => session.key === '0:4' && session.status === 'missing')).toBe(false);
    }
  });

  it('marks Saturday/Sunday Missing on Monday if still unlogged', () => {
    const athlete = buildAthleteRecord({
      id: 'grace',
      name: 'Grace Tester',
      campLength: 7,
      currentWeekIndex: 1,
      campStartDate: CAMP_START,
      now: atLocalMorning('2026-09-14'),
      missing: ['0:4'],
      skipped: [],
      missingProofs: [],
    });
    const weekend = athlete.sessions.find((session) => session.key === '0:4');
    expect(weekend.status).toBe('missing');
  });
});
