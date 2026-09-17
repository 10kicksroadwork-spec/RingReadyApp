import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hasClearableCoachAlerts,
  isCoachAlertActive,
} from '../src/coach-notifications.js';
import { buildAthleteRecord, buildLiveRoster, completionOccurrenceAt, skipAlertEventAt } from '../src/coach-preview.js';

const AUTH_SRC = readFileSync('src/auth.js', 'utf8');
const MIGRATION_024 = readFileSync('scripts/migrations/024_coach_notification_acknowledgement.sql', 'utf8');

function functionBody(source, name) {
  const match = source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n(?=export |$)`));
  expect(match, name).toBeTruthy();
  return match[0];
}

const ALL_SOURCES = {
  profiles: true,
  hrRows: true,
  completions: true,
  sprints: true,
  mileTests: true,
  notes: true,
  identities: true,
  exclusions: true,
  meta: true,
  attachments: true,
};

function livePayload({
  userId = 'u-elizabeth',
  name = 'Elizabeth',
  completions = [],
  attachments = [],
  meta = [],
  sourceErrors = {},
  sources = ALL_SOURCES,
  extraProfiles = [],
  now = '2026-09-16T18:00:00.000Z',
} = {}) {
  return {
    now,
    profiles: [{
      user_id: userId,
      athlete_name: name,
      camp_length: 7,
      fight_date: '2026-11-01',
    }, ...extraProfiles],
    hrRows: [{ user_id: userId, max_hr: 190, resting_hr: 50 }],
    completions,
    sprints: [],
    mileTests: [],
    notes: [],
    identities: [{ user_id: userId, email: 'elizabeth@example.com' }],
    exclusions: [],
    meta,
    attachments,
    sourceErrors,
    sources,
  };
}

function loggedCompletion({
  userId = 'u-elizabeth',
  weekIndex = 0,
  workoutIndex = 1,
  avgBpm = 155,
  targetBpm = 137,
  completedAt = '2026-09-10T12:00:00.000Z',
  updatedAt = completedAt,
  attachmentId = 'att-1',
  workoutType = 'Easy Run',
} = {}) {
  return {
    user_id: userId,
    completion_key: `${weekIndex}:${workoutIndex}`,
    week_index: weekIndex,
    workout_index: workoutIndex,
    workout_type: workoutType,
    avg_bpm: avgBpm,
    target_bpm: targetBpm,
    completed_at: completedAt,
    updated_at: updatedAt,
    attachment_id: attachmentId,
    record_json: {},
  };
}

function withNoteOnlyEdit(completions, updatedAt = '2026-09-16T18:00:00.000Z') {
  return completions.map((row) => ({
    ...row,
    updated_at: updatedAt,
    record_json: {
      ...(row.record_json || {}),
      workoutLog: {
        ...((row.record_json && row.record_json.workoutLog) || {}),
        note: 'Updated note after coach reviewed alerts',
      },
    },
  }));
}

function currentWeekLogged() {
  return [
    loggedCompletion({
      workoutIndex: 0,
      avgBpm: 160,
      targetBpm: 172,
      workoutType: 'Sprint Intervals',
      attachmentId: 'att-0',
    }),
    loggedCompletion({
      workoutIndex: 1,
      avgBpm: 160,
      targetBpm: 137,
      workoutType: 'Benchmark Run + S&C',
      attachmentId: 'att-1',
    }),
  ];
}

describe('coach alert watermark helpers', () => {
  it('keeps alerts active when no clear timestamp exists', () => {
    expect(isCoachAlertActive('2026-09-10T12:00:00.000Z', null)).toBe(true);
  });

  it('suppresses alerts older than the watermark and keeps newer ones', () => {
    expect(isCoachAlertActive('2026-09-10T12:00:00.000Z', '2026-09-15T11:50:00.000Z')).toBe(false);
    expect(isCoachAlertActive('2026-09-16T08:00:00.000Z', '2026-09-15T11:50:00.000Z')).toBe(true);
  });

  it('ignores generic updated_at when dating an HR/proof occurrence', () => {
    expect(completionOccurrenceAt({
      completed_at: '2026-09-10T12:00:00.000Z',
      updated_at: '2026-09-16T18:00:00.000Z',
      record_json: { workoutLog: { note: 'only a note', updatedAt: '2026-09-16T18:00:00.000Z' } },
    }, null, {
      updatedAt: '2026-09-16T18:00:00.000Z',
      completedAt: '2026-09-10T12:00:00.000Z',
    })).toBe('2026-09-10T12:00:00.000Z');
  });

  it('prefers skippedAt over generic completion updated_at', () => {
    expect(skipAlertEventAt({
      completed_at: '2026-09-10T12:00:00.000Z',
      updated_at: '2026-09-16T18:00:00.000Z',
    }, {
      completedAt: '2026-09-10T12:00:00.000Z',
      workoutLog: {
        skippedAt: '2026-09-10T12:05:00.000Z',
        note: 'updated later',
      },
    })).toBe('2026-09-10T12:05:00.000Z');
  });
});

describe('coach alert acknowledgement', () => {
  it('A) existing HR flag + no clear timestamp => Watch HR active', () => {
    const athlete = buildAthleteRecord({
      id: 'a',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      skipped: [],
      missingProofs: [],
      flags: { '0:1': 'Easy Run avg 155 · target 137' },
      flagEventAt: { '0:1': '2026-09-10T12:00:00.000Z' },
    });
    expect(athlete.watchCount).toBe(1);
    expect(athlete.tone).toBe('watch');
    expect(athlete.attention.join(' ')).toMatch(/HR flag/i);
    expect(hasClearableCoachAlerts(athlete)).toBe(true);
  });

  it('B) existing HR flag older than clear timestamp => no active Watch HR', () => {
    const athlete = buildAthleteRecord({
      id: 'b',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      skipped: [],
      missingProofs: [],
      flags: { '0:1': 'Easy Run avg 155 · target 137' },
      flagEventAt: { '0:1': '2026-09-10T12:00:00.000Z' },
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
    });
    expect(athlete.watchCount).toBe(0);
    expect(athlete.tone).toBe('on-track');
    expect(athlete.attention).toEqual([]);
    expect(athlete.sessions.find((session) => session.key === '0:1')?.flag).toContain('avg 155');
    expect(athlete.sessions.find((session) => session.key === '0:1')?.flagAlertActive).toBe(false);
  });

  it('C) new HR flag after clear timestamp => Watch HR returns', () => {
    const athlete = buildAthleteRecord({
      id: 'c',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      skipped: [],
      missingProofs: [],
      flags: { '0:3': 'Easy Run avg 152 · target 137' },
      flagEventAt: { '0:3': '2026-09-16T08:00:00.000Z' },
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
    });
    expect(athlete.watchCount).toBe(1);
    expect(athlete.tone).toBe('watch');
  });

  it('D) old proof gap older than clear timestamp => no active Proof Gap status', () => {
    const athlete = buildAthleteRecord({
      id: 'd',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      skipped: [],
      missingProofs: ['0:1'],
      proofEventAt: { '0:1': '2026-09-12T12:00:00.000Z' },
      flags: {},
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
      sources: { attachments: true, completions: true },
    });
    expect(athlete.proofGaps).toBe(0);
    expect(athlete.tone).toBe('on-track');
    expect(athlete.sessions.find((session) => session.key === '0:1')?.proof).toBe('missing');
    expect(athlete.sessions.find((session) => session.key === '0:1')?.proofAlertActive).toBe(false);
  });

  it('E) new proof gap after clear timestamp => Proof Gap returns', () => {
    const athlete = buildAthleteRecord({
      id: 'e',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      skipped: [],
      missingProofs: ['0:3'],
      proofEventAt: { '0:3': '2026-09-16T09:00:00.000Z' },
      flags: {},
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
      sources: { attachments: true, completions: true },
    });
    expect(athlete.proofGaps).toBe(1);
    expect(athlete.tone).toBe('proof');
    expect(athlete.attention.join(' ')).toMatch(/proof gap/i);
  });

  it('F) old completion updated_at after clear does not resurrect Watch HR', () => {
    const roster = buildLiveRoster(livePayload({
      completions: withNoteOnlyEdit(currentWeekLogged()),
      attachments: [],
      meta: [{
        athlete_user_id: 'u-elizabeth',
        camp_start_date: '2026-09-14',
        notifications_cleared_at: '2026-09-15T11:50:00.000Z',
      }],
    }));
    expect(roster).toHaveLength(1);
    expect(roster[0].watchCount).toBe(0);
    expect(roster[0].tone).toBe('on-track');
  });

  it('G/H/I) clearing writes only coach_athlete_meta watermark fields', () => {
    const clearBody = functionBody(AUTH_SRC, 'saveCoachNotificationClear');
    const restoreBody = functionBody(AUTH_SRC, 'restoreCoachNotificationClear');
    for (const body of [clearBody, restoreBody]) {
      expect(body).toMatch(/isCoachUser\(/);
      expect(body).toMatch(/coach_athlete_meta/);
      expect(body).toMatch(/notifications_cleared_at/);
      expect(body).toMatch(/notifications_cleared_by/);
      expect(body).not.toMatch(/workout_completions/);
      expect(body).not.toMatch(/workout_attachments/);
      expect(body).not.toMatch(/hr_info/);
    }
  });

  it('J) source/data-unavailable warning remains visible after acknowledgement', () => {
    const athlete = buildAthleteRecord({
      id: 'j',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      flags: { '0:1': 'Easy Run avg 155 · target 137' },
      flagEventAt: { '0:1': '2026-09-10T12:00:00.000Z' },
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
      completionsAvailable: false,
      sources: { completions: false, attachments: true },
    });
    expect(athlete.tone).toBe('data-unavailable');
    expect(athlete.attention.join(' ')).toMatch(/unavailable/i);
    expect(hasClearableCoachAlerts(athlete)).toBe(false);

    const roster = buildLiveRoster(livePayload({
      completions: [loggedCompletion({ attachmentId: null })],
      attachments: [],
      meta: [{
        athlete_user_id: 'u-elizabeth',
        camp_start_date: '2026-09-01',
        notifications_cleared_at: '2026-09-15T11:50:00.000Z',
      }],
      sourceErrors: { attachments: 'timeout' },
      sources: { ...ALL_SOURCES, attachments: false },
    }));
    expect(roster[0].proofGaps).toBe(0);
    expect(roster[0].attachmentsAvailable).toBe(false);
    expect(roster[0].attention.join(' ')).toMatch(/unavailable/i);
  });

  it('K) roster attention count immediately decreases after clear', () => {
    const completions = currentWeekLogged();
    const before = buildLiveRoster(livePayload({
      completions,
      attachments: [],
      meta: [{ athlete_user_id: 'u-elizabeth', camp_start_date: '2026-09-14' }],
    }));
    const after = buildLiveRoster(livePayload({
      completions,
      attachments: [],
      meta: [{
        athlete_user_id: 'u-elizabeth',
        camp_start_date: '2026-09-14',
        notifications_cleared_at: '2026-09-15T11:50:00.000Z',
      }],
    }));
    const attentionOf = (roster) => roster.filter((row) => row.tone !== 'on-track' && row.tone !== 'data-unavailable').length;
    expect(before[0].watchCount).toBeGreaterThan(0);
    expect(before[0].tone).toBe('watch');
    expect(attentionOf(before)).toBe(1);
    expect(after[0].watchCount).toBe(0);
    expect(after[0].tone).toBe('on-track');
    expect(attentionOf(after)).toBe(0);
  });

  it('L) restore acknowledgement causes unresolved historical alerts to appear again', () => {
    const config = {
      id: 'l',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      missing: [],
      skipped: [],
      missingProofs: ['0:1'],
      proofEventAt: { '0:1': '2026-09-12T12:00:00.000Z' },
      flags: { '0:3': 'Easy Run avg 155 · target 137' },
      flagEventAt: { '0:3': '2026-09-10T12:00:00.000Z' },
      sources: { attachments: true, completions: true },
    };
    const cleared = buildAthleteRecord({
      ...config,
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
    });
    const restored = buildAthleteRecord({
      ...config,
      notificationsClearedAt: null,
    });
    expect(cleared.tone).toBe('on-track');
    expect(cleared.proofGaps).toBe(0);
    expect(cleared.watchCount).toBe(0);
    expect(restored.watchCount).toBe(1);
    expect(restored.proofGaps).toBe(1);
    expect(restored.tone).not.toBe('on-track');
  });

  it('does not suppress a newly missed workout after the watermark', () => {
    const athlete = buildAthleteRecord({
      id: 'miss-new',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: '2026-09-07',
      now: new Date('2026-09-09T08:00:00'),
      missing: ['0:1'],
      skipped: [],
      missingProofs: [],
      flags: {},
      notificationsClearedAt: '2026-09-08T12:00:00.000Z',
    });
    expect(athlete.missingCount).toBe(1);
    expect(athlete.tone).toBe('behind');
  });

  it('keeps factual missing sessions after acknowledgement without Behind tone', () => {
    const athlete = buildAthleteRecord({
      id: 'miss-old',
      name: 'Elizabeth',
      campLength: 7,
      currentWeekIndex: 0,
      campStartDate: '2026-09-07',
      now: new Date('2026-09-15T12:00:00'),
      missing: ['0:1'],
      skipped: [],
      missingProofs: [],
      flags: {},
      notificationsClearedAt: '2026-09-15T11:50:00.000Z',
    });
    expect(athlete.factualMissingCount).toBe(1);
    expect(athlete.missingCount).toBe(0);
    expect(athlete.tone).toBe('on-track');
  });

  it('M) HR flag cleared then note-only updated_at edit keeps Watch HR reviewed', () => {
    const original = currentWeekLogged();
    const edited = withNoteOnlyEdit(original);
    expect(edited[1].avg_bpm).toBe(original[1].avg_bpm);
    expect(edited[1].completed_at).toBe(original[1].completed_at);
    expect(edited[1].updated_at > original[1].updated_at).toBe(true);

    const roster = buildLiveRoster(livePayload({
      completions: edited,
      attachments: [],
      meta: [{
        athlete_user_id: 'u-elizabeth',
        camp_start_date: '2026-09-14',
        notifications_cleared_at: '2026-09-15T11:50:00.000Z',
      }],
    }));
    expect(roster[0].watchCount).toBe(0);
    expect(roster[0].tone).toBe('on-track');
    expect(roster[0].sessions.find((session) => session.key === '0:1')?.flag).toBeTruthy();
    expect(roster[0].sessions.find((session) => session.key === '0:1')?.flagAlertActive).toBe(false);
  });

  it('N) proof gap cleared then note-only updated_at edit keeps Proof Gap reviewed', () => {
    const completions = withNoteOnlyEdit([
      loggedCompletion({
        workoutIndex: 0,
        avgBpm: 160,
        targetBpm: 172,
        workoutType: 'Sprint Intervals',
        attachmentId: 'att-0',
        completedAt: '2026-09-14T18:00:00.000Z',
      }),
      loggedCompletion({
        workoutIndex: 1,
        avgBpm: 140,
        targetBpm: 137,
        workoutType: 'Benchmark Run + S&C',
        attachmentId: null,
        completedAt: '2026-09-15T12:00:00.000Z',
      }),
    ]);
    const roster = buildLiveRoster(livePayload({
      completions,
      attachments: [],
      meta: [{
        athlete_user_id: 'u-elizabeth',
        camp_start_date: '2026-09-14',
        notifications_cleared_at: '2026-09-15T18:00:00.000Z',
      }],
    }));
    expect(roster[0].proofGaps).toBe(0);
    expect(roster[0].watchCount).toBe(0);
    expect(roster[0].tone).toBe('on-track');
    expect(roster[0].sessions.find((session) => session.key === '0:1')?.proof).toBe('missing');
    expect(roster[0].sessions.find((session) => session.key === '0:1')?.proofAlertActive).toBe(false);
  });

  it('a genuinely newer session after clear still returns Watch HR', () => {
    const roster = buildLiveRoster(livePayload({
      completions: [
        loggedCompletion({
          workoutIndex: 0,
          avgBpm: 160,
          targetBpm: 172,
          workoutType: 'Sprint Intervals',
          attachmentId: 'att-0',
          completedAt: '2026-09-14T18:00:00.000Z',
        }),
        loggedCompletion({
          workoutIndex: 1,
          avgBpm: 160,
          targetBpm: 137,
          workoutType: 'Benchmark Run + S&C',
          attachmentId: 'att-1',
          completedAt: '2026-09-16T12:00:00.000Z',
        }),
      ],
      attachments: [],
      meta: [{
        athlete_user_id: 'u-elizabeth',
        camp_start_date: '2026-09-14',
        notifications_cleared_at: '2026-09-15T11:50:00.000Z',
      }],
    }));
    expect(roster[0].watchCount).toBeGreaterThan(0);
    expect(roster[0].tone).toBe('watch');
  });
});

describe('migration 024 acknowledgement contract', () => {
  it('adds nullable watermark columns without rewriting workout tables', () => {
    expect(MIGRATION_024).toMatch(/notifications_cleared_at timestamptz/);
    expect(MIGRATION_024).toMatch(/notifications_cleared_by uuid references auth\.users\(id\)/);
    expect(MIGRATION_024).toMatch(/add column if not exists/);
    expect(MIGRATION_024).not.toMatch(/drop table/i);
    expect(MIGRATION_024).not.toMatch(/workout_completions/);
    expect(MIGRATION_024).not.toMatch(/workout_attachments/);
    expect(MIGRATION_024).not.toMatch(/hr_info/);
  });

  it('selects acknowledgement columns in the coach roster payload', () => {
    expect(AUTH_SRC).toMatch(/notifications_cleared_at,notifications_cleared_by/);
  });
});
