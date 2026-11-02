import { describe, expect, it } from 'vitest';
import {
  isResolvableProofAttachment,
  isValidCoachDriveScreenshotUrl,
  proofLinkCueLabel,
  resolveSessionProofLink,
} from '../src/coach-proof.js';
import {
  buildAthleteRecord,
  liveAthleteConfig,
  proofScreenshotAriaLabel,
  renderSessionRows,
  renderZoneHeatmapCells,
} from '../src/coach-preview.js';
import {
  buildCoachAthleteAnalytics,
} from '../src/coach-metrics.js';
import { isSessionAvgOnTarget } from '../src/hr-analytics.js';

const ATHLETE = 'athlete-a';
const OTHER = 'athlete-b';
const DRIVE_A = 'https://drive.google.com/file/d/FileIdAaa111/view';
const DRIVE_B = 'https://drive.google.com/file/d/FileIdBbb222/view';
const DRIVE_C = 'https://drive.google.com/file/d/FileIdCcc333/view';
const SESSION = 'sprint-session-1';

function attachment(overrides = {}) {
  return {
    id: 'att-1',
    user_id: ATHLETE,
    linked_record_id: '',
    is_current: true,
    completion_cleared: false,
    transfer_status: 'complete',
    drive_url: DRIVE_A,
    ...overrides,
  };
}

describe('isValidCoachDriveScreenshotUrl', () => {
  it('accepts HTTPS Drive file-view URLs', () => {
    expect(isValidCoachDriveScreenshotUrl(DRIVE_A)).toBe(true);
    expect(isValidCoachDriveScreenshotUrl(`${DRIVE_A}?usp=drivesdk`)).toBe(true);
    expect(isValidCoachDriveScreenshotUrl('https://drive.google.com/file/d/FileIdAaa111')).toBe(true);
  });

  it('rejects unsafe or unexpected destinations', () => {
    expect(isValidCoachDriveScreenshotUrl('http://drive.google.com/file/d/FileIdAaa111/view')).toBe(false);
    expect(isValidCoachDriveScreenshotUrl('javascript:alert(1)')).toBe(false);
    expect(isValidCoachDriveScreenshotUrl('https://evil.example/file/d/FileIdAaa111/view')).toBe(false);
    expect(isValidCoachDriveScreenshotUrl('https://drive.google.com/open?id=FileIdAaa111')).toBe(false);
    expect(isValidCoachDriveScreenshotUrl('https://user:pass@drive.google.com/file/d/FileIdAaa111/view')).toBe(false);
    expect(isValidCoachDriveScreenshotUrl('')).toBe(false);
  });
});

describe('strict resolvable attachment checks', () => {
  it('requires explicit athlete ownership, is_current true, and completion_cleared false', () => {
    expect(isResolvableProofAttachment(attachment(), ATHLETE)).toBe(true);
    expect(isResolvableProofAttachment(attachment({ user_id: OTHER }), ATHLETE)).toBe(false);
    expect(isResolvableProofAttachment(attachment({ is_current: false }), ATHLETE)).toBe(false);
    expect(isResolvableProofAttachment(attachment({ is_current: undefined }), ATHLETE)).toBe(false);
    expect(isResolvableProofAttachment(attachment({ completion_cleared: true }), ATHLETE)).toBe(false);
    expect(isResolvableProofAttachment(attachment({ completion_cleared: undefined }), ATHLETE)).toBe(false);
  });
});

describe('resolveSessionProofLink', () => {
  it('opens the exact completion attachment URL', () => {
    const result = resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment()],
    });
    expect(result).toEqual({ attachmentId: 'att-1', url: DRIVE_A, state: 'ready' });
  });

  it('opens the exact sprint attachment URL', () => {
    const result = resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'sprint-att',
      sprintRow: { user_id: ATHLETE, session_id: SESSION, attachment_id: 'sprint-att' },
      attachments: [attachment({ id: 'sprint-att', linked_record_id: SESSION, drive_url: DRIVE_B })],
    });
    expect(result).toEqual({ attachmentId: 'sprint-att', url: DRIVE_B, state: 'ready' });
  });

  it('supports a unique legacy sprint session_id association', () => {
    const result = resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: null,
      sprintRow: { user_id: ATHLETE, session_id: SESSION, attachment_id: null },
      attachments: [attachment({ id: 'legacy-1', linked_record_id: SESSION })],
    });
    expect(result).toEqual({ attachmentId: 'legacy-1', url: DRIVE_A, state: 'ready' });
  });

  it('rejects ambiguous legacy sprint session_id matches', () => {
    const result = resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: null,
      sprintRow: { user_id: ATHLETE, session_id: SESSION, attachment_id: null },
      attachments: [
        attachment({ id: 'legacy-1', linked_record_id: SESSION, drive_url: DRIVE_A }),
        attachment({ id: 'legacy-2', linked_record_id: SESSION, drive_url: DRIVE_B }),
      ],
    });
    expect(result).toEqual({ attachmentId: null, url: null, state: 'unavailable' });
  });

  it('ignores stale embedded JSON and week/workout-only fallbacks', () => {
    const byWeekOnly = attachment({
      id: 'wrong-camp',
      linked_record_id: 'other-session',
      week_index: 1,
      workout_index: 0,
      drive_url: DRIVE_B,
    });
    const result = resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: null,
      sprintRow: {
        user_id: ATHLETE,
        session_id: SESSION,
        week_index: 1,
        workout_index: 0,
        attachment_id: null,
        session_json: {
          attachment: { driveUrl: DRIVE_B },
          workoutLog: { attachment: { driveUrl: DRIVE_B } },
        },
      },
      attachments: [byWeekOnly],
    });
    expect(result.state).toBe('missing');
    expect(result.url).toBeNull();
  });

  it('rejects another athlete, superseded, and cleared attachments for explicit IDs', () => {
    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment({ user_id: OTHER })],
    }).state).toBe('unavailable');

    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment({ is_current: false })],
    }).state).toBe('unavailable');

    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment({ completion_cleared: true })],
    }).state).toBe('unavailable');
  });

  it('does not fall back when an explicit ID is missing from the attachment table', () => {
    const result = resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'missing-id',
      sprintRow: { user_id: ATHLETE, session_id: SESSION },
      attachments: [attachment({ id: 'legacy-1', linked_record_id: SESSION })],
    });
    expect(result).toEqual({ attachmentId: 'missing-id', url: null, state: 'unavailable' });
  });

  it('maps pending, failed, missing, malformed URL, and source outage states', () => {
    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment({ transfer_status: 'processing', drive_url: '' })],
    })).toMatchObject({ state: 'processing', url: null });

    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment({ transfer_status: 'failed', drive_url: '' })],
    })).toMatchObject({ state: 'unavailable', url: null });

    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: null,
      attachments: [],
    })).toMatchObject({ state: 'missing', url: null });

    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment({ drive_url: 'https://evil.example/x' })],
    })).toMatchObject({ state: 'unavailable', url: null });

    expect(resolveSessionProofLink({
      athleteUserId: ATHLETE,
      attachmentId: 'att-1',
      attachments: [attachment()],
      attachmentsAvailable: false,
    })).toMatchObject({ state: 'unavailable', url: null });
  });
});

describe('proofLinkCueLabel', () => {
  it('labels resolved states and stays blank without proofLink', () => {
    expect(proofLinkCueLabel(undefined)).toBe('');
    expect(proofLinkCueLabel(null)).toBe('');
    expect(proofLinkCueLabel({ state: 'ready', url: DRIVE_A })).toBe('View screenshot ↗');
    expect(proofLinkCueLabel({ state: 'processing' })).toBe('Screenshot processing');
    expect(proofLinkCueLabel({ state: 'unavailable' })).toBe('Screenshot unavailable');
    expect(proofLinkCueLabel({ state: 'missing' })).toBe('No screenshot attached');
  });
});

describe('liveAthleteConfig proofLink wiring', () => {
  const profile = {
    user_id: ATHLETE,
    athlete_name: 'Daniel',
    camp_length: 7,
    fight_date: '2026-12-01',
  };
  const campStart = '2026-09-01';
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('attaches ready proof links for runs and sprints from the attachment table', () => {
    const completions = [{
      user_id: ATHLETE,
      completion_key: '0:3',
      week_index: 0,
      workout_index: 3,
      workout_type: 'Easy Run',
      avg_bpm: 140,
      target_bpm: 137,
      attachment_id: 'run-att',
      completed_at: '2026-09-08T12:00:00.000Z',
      record_json: {
        attachment: { driveUrl: '' },
        workoutLog: { attachment: { driveUrl: '' } },
      },
    }];
    const sprints = [{
      user_id: ATHLETE,
      session_id: SESSION,
      week_index: 0,
      workout_index: 0,
      workout_type: 'Sprint Intervals',
      attachment_id: 'sprint-att',
      session_at: '2026-09-05T12:00:00.000Z',
      session_json: {},
    }];
    const attachments = [
      attachment({ id: 'run-att', drive_url: DRIVE_A }),
      attachment({ id: 'sprint-att', linked_record_id: SESSION, drive_url: DRIVE_B }),
    ];
    const config = liveAthleteConfig(
      profile, null, completions, sprints, [], '', 'daniel@example.com',
      campStart, attachments, { attachments: true, completions: true }, null, null, now
    );
    expect(config.proofLinks['0:3']).toEqual({ attachmentId: 'run-att', url: DRIVE_A, state: 'ready' });
    expect(config.proofLinks['0:0']).toEqual({ attachmentId: 'sprint-att', url: DRIVE_B, state: 'ready' });

    const athlete = buildAthleteRecord(config);
    expect(athlete.sessions.find((row) => row.key === '0:3')?.proofLink?.url).toBe(DRIVE_A);
    expect(athlete.sessions.find((row) => row.key === '0:0')?.proofLink?.url).toBe(DRIVE_B);
  });

  it('leaves mock/preview sessions without proofLinks neutral', () => {
    const athlete = buildAthleteRecord({
      id: 'mock-1',
      name: 'Mock',
      campLength: 7,
      currentWeekIndex: 0,
      fightDate: '--',
      missing: [],
      skipped: [],
      avgs: { '0:3': 140 },
      targets: { '0:3': 137 },
    });
    const session = athlete.sessions.find((row) => row.key === '0:3');
    expect(session).toBeTruthy();
    expect(session.proofLink).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(session, 'proofLink')).toBe(false);

    const html = renderSessionRows([session]);
    expect(html).not.toContain('View screenshot');
    expect(html).not.toContain('No screenshot attached');
    expect(html).not.toContain('Screenshot unavailable');
    expect(html).not.toContain('<a ');
  });
});

describe('proofScreenshotAriaLabel', () => {
  it('includes week, day, and workout type for distinct accessible names', () => {
    expect(proofScreenshotAriaLabel({
      weekLabel: 'Week 2',
      day: 'Thursday',
      type: 'Easy Run',
    })).toBe('Week 2 Thursday, Easy Run screenshot — opens in a new tab');

    expect(proofScreenshotAriaLabel({
      weekIndex: 0,
      day: 'Tuesday',
      type: 'Easy Run',
    })).toBe('Week 1 Tuesday, Easy Run screenshot — opens in a new tab');

    expect(proofScreenshotAriaLabel({
      weekLabel: 'Week 1',
      day: 'Monday',
      type: 'Sprint Intervals',
    })).toBe('Week 1 Monday, Sprint Intervals screenshot — opens in a new tab');
  });
});

describe('heatmap proof identity + rendering', () => {
  const helpers = {
    getSessionZoneTarget: (session) => (
      Number.isFinite(Number(session.targetBPM))
        ? { target: Number(session.targetBPM), tolerance: 5, mode: 'flat' }
        : null
    ),
    isSessionAvgOnTarget,
  };

  it('preserves proofLink identity through heatmap construction and sort/filter', () => {
    // Session order puts the in-zone cell first so missBpm sort must reverse it.
    const athlete = {
      id: ATHLETE,
      name: 'Heat',
      scan: { recovery: {}, pace: {}, zone: {} },
      sessions: [
        {
          key: '1:3',
          status: 'logged',
          type: 'Easy Run',
          day: 'Tuesday',
          weekIndex: 1,
          workoutIndex: 3,
          avgBpm: 138,
          targetBPM: 137,
          proofLink: { attachmentId: 'run-att-c', url: DRIVE_C, state: 'ready' },
        },
        {
          key: '0:3',
          status: 'logged',
          type: 'Easy Run',
          day: 'Tuesday',
          weekIndex: 0,
          workoutIndex: 3,
          avgBpm: 150,
          targetBPM: 137,
          proofLink: { attachmentId: 'run-att', url: DRIVE_A, state: 'ready' },
        },
        {
          key: '0:4',
          status: 'logged',
          type: 'Long Run',
          day: 'Thursday',
          weekIndex: 0,
          workoutIndex: 4,
          avgBpm: 130,
          targetBPM: 137,
          proofLink: { attachmentId: 'run-att-2', url: DRIVE_B, state: 'ready' },
        },
      ],
    };
    const analytics = buildCoachAthleteAnalytics(athlete, helpers);
    expect(analytics.zoneHeatmap.map((cell) => cell.proofLink.url)).toEqual([
      DRIVE_C, DRIVE_A, DRIVE_B,
    ]);
    expect(analytics.zoneHeatmap.map((cell) => cell.missBpm)).toEqual([0, 8, 2]);

    // Sort by miss magnitude DESC must reverse natural order of the off-target pair.
    const resorted = [...analytics.zoneHeatmap].sort((a, b) => Number(b.missBpm) - Number(a.missBpm));
    expect(resorted.map((cell) => cell.key)).toEqual(['0:3', '0:4', '1:3']);
    expect(resorted.map((cell) => cell.proofLink.url)).toEqual([DRIVE_A, DRIVE_B, DRIVE_C]);
    expect(resorted.map((cell) => cell.key)).not.toEqual(
      analytics.zoneHeatmap.map((cell) => cell.key)
    );

    // Filtering removes the in-zone cell; remaining workouts keep original URLs.
    const filtered = analytics.zoneHeatmap.filter((cell) => cell.onTarget === false);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((cell) => cell.key)).toEqual(['0:3', '0:4']);
    expect(filtered.find((cell) => cell.key === '0:3').proofLink.url).toBe(DRIVE_A);
    expect(filtered.find((cell) => cell.key === '0:4').proofLink.url).toBe(DRIVE_B);
    expect(filtered.some((cell) => cell.key === '1:3')).toBe(false);
  });

  it('renders clickable run cards and nonclickable unavailable states', () => {
    const readyHtml = renderZoneHeatmapCells([{
      status: 'needs-attention',
      label: 'W1 Tuesday',
      weekIndex: 0,
      day: 'Tuesday',
      type: 'Easy Run',
      headline: '8 bpm HIGH',
      avgBpm: 150,
      bandLabel: 'Target 132–142',
      proofLink: { attachmentId: 'run-att', url: DRIVE_A, state: 'ready' },
    }]);
    expect(readyHtml).toContain(`href="${DRIVE_A}"`);
    expect(readyHtml).toContain('target="_blank"');
    expect(readyHtml).toContain('rel="noopener noreferrer"');
    expect(readyHtml).toContain('View screenshot ↗');
    expect(readyHtml).toContain('class="coach-zone-heat-item" role="listitem"');
    expect(readyHtml).toMatch(/<a class="coach-zone-heat-cell[^"]*" href=/);
    expect(readyHtml).not.toMatch(/<a[^>]*role="listitem"/);
    expect(readyHtml).toContain('Week 1 Tuesday, Easy Run screenshot — opens in a new tab');

    const sessionHtml = renderSessionRows([{
      status: 'logged',
      weekLabel: 'Week 2',
      day: 'Thursday',
      type: 'Easy Run',
      proof: 'on-file',
      proofLink: { attachmentId: 'run-att', url: DRIVE_A, state: 'ready' },
    }]);
    expect(sessionHtml).toContain('Week 2 Thursday, Easy Run screenshot — opens in a new tab');

    const pendingHtml = renderZoneHeatmapCells([{
      status: 'on-target',
      label: 'W1 Thursday',
      type: 'Long Run',
      headline: 'IN ZONE',
      avgBpm: 137,
      proofLink: { attachmentId: 'run-att', url: null, state: 'processing' },
    }]);
    expect(pendingHtml).toContain('Screenshot processing');
    expect(pendingHtml).not.toContain('<a ');
    expect(pendingHtml).not.toContain('href=');

    const missingHtml = renderSessionRows([{
      status: 'logged',
      weekLabel: 'Week 1',
      day: 'Tuesday',
      type: 'Easy Run',
      proof: 'on-file',
      proofLink: { attachmentId: null, url: null, state: 'missing' },
    }]);
    expect(missingHtml).toContain('No screenshot attached');
    expect(missingHtml).not.toContain('<a ');

    const dueHtml = renderSessionRows([{
      status: 'due-today',
      weekLabel: 'Week 1',
      day: 'Friday',
      type: 'Easy Run',
      proof: 'none',
      proofLink: { state: 'missing' },
    }]);
    expect(dueHtml).not.toContain('No screenshot attached');
    expect(dueHtml).not.toContain('View screenshot');
  });

  it('replaces rendered proof links after roster refresh through the live pipeline', () => {
    const profile = {
      user_id: ATHLETE,
      athlete_name: 'Daniel',
      camp_length: 7,
      fight_date: '2026-12-01',
    };
    const campStart = '2026-09-01';
    const now = new Date('2026-09-20T12:00:00.000Z');
    const sources = { attachments: true, completions: true };

    const beforeCompletions = [{
      user_id: ATHLETE,
      completion_key: '0:3',
      week_index: 0,
      workout_index: 3,
      workout_type: 'Easy Run',
      avg_bpm: 150,
      target_bpm: 137,
      attachment_id: 'old-att',
      completed_at: '2026-09-08T12:00:00.000Z',
      record_json: {},
    }];
    const beforeAttachments = [
      attachment({ id: 'old-att', drive_url: DRIVE_A }),
    ];
    const beforeAthlete = buildAthleteRecord(liveAthleteConfig(
      profile, null, beforeCompletions, [], [], '', 'daniel@example.com',
      campStart, beforeAttachments, sources, null, null, now
    ));
    const beforeSession = beforeAthlete.sessions.find((row) => row.key === '0:3');
    expect(beforeSession.proofLink).toEqual({
      attachmentId: 'old-att', url: DRIVE_A, state: 'ready',
    });
    const beforeHeat = buildCoachAthleteAnalytics(beforeAthlete, helpers).zoneHeatmap;
    const beforeHeatHtml = renderZoneHeatmapCells(beforeHeat);
    const beforeSessionHtml = renderSessionRows([beforeSession]);
    expect(beforeHeatHtml).toContain(DRIVE_A);
    expect(beforeHeatHtml).not.toContain(DRIVE_B);
    expect(beforeSessionHtml).toContain(DRIVE_A);
    expect(beforeSessionHtml).not.toContain(DRIVE_B);

    // Roster refresh: completion now points at the replacement attachment.
    const afterCompletions = [{
      ...beforeCompletions[0],
      attachment_id: 'new-att',
    }];
    const afterAttachments = [
      attachment({ id: 'old-att', is_current: false, drive_url: DRIVE_A }),
      attachment({ id: 'new-att', drive_url: DRIVE_B }),
    ];
    const afterAthlete = buildAthleteRecord(liveAthleteConfig(
      profile, null, afterCompletions, [], [], '', 'daniel@example.com',
      campStart, afterAttachments, sources, null, null, now
    ));
    const afterSession = afterAthlete.sessions.find((row) => row.key === '0:3');
    expect(afterSession.proofLink).toEqual({
      attachmentId: 'new-att', url: DRIVE_B, state: 'ready',
    });
    const afterHeat = buildCoachAthleteAnalytics(afterAthlete, helpers).zoneHeatmap;
    const afterHeatHtml = renderZoneHeatmapCells(afterHeat);
    const afterSessionHtml = renderSessionRows([afterSession]);
    expect(afterHeat.find((cell) => cell.key === '0:3')?.proofLink.url).toBe(DRIVE_B);
    expect(afterHeatHtml).toContain(DRIVE_B);
    expect(afterHeatHtml).not.toContain(DRIVE_A);
    expect(afterSessionHtml).toContain(DRIVE_B);
    expect(afterSessionHtml).not.toContain(DRIVE_A);
  });
});
