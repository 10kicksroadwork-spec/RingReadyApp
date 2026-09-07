import { describe, expect, it } from 'vitest';
import {
  LENS_BENCHMARK,
  LENS_HR_ADHERENCE,
  LENS_PACE,
  LENS_RECOVERY,
  STATUS_BASELINE,
  STATUS_DECLINING,
  STATUS_IMPROVING,
  STATUS_NEEDS_ATTENTION,
  STATUS_NO_DATA,
  STATUS_ON_TARGET,
  STATUS_WATCH,
  buildCoachAthleteAnalytics,
  buildLensCard,
  buildLensCards,
  cardMatchesFilter,
  classifyHrAdherence,
  classifyPace,
  classifyPerformanceIndex,
  classifyRecovery,
  computeRunningTotals,
  STATUS_UNAVAILABLE,
  formatCoachSourceWarnings,
  normalizeMileTestCloudRows,
  selectVisibleCards,
  sortMetricCards,
  statusBadgeLabel,
} from '../src/coach-metrics.js';
import { buildLiveRoster } from '../src/coach-preview.js';
import { MODALITY_RUNNING, normalizeModality } from '../src/modality.js';

describe('classifyPerformanceIndex', () => {
  it('marks PI 108 as Improving', () => {
    const result = classifyPerformanceIndex(108);
    expect(result.status).toBe(STATUS_IMPROVING);
    expect(statusBadgeLabel(result.status)).toBe('IMPROVING');
    expect(result.delta).toBeCloseTo(8);
  });

  it('marks PI 92 as Declining', () => {
    expect(classifyPerformanceIndex(92).status).toBe(STATUS_DECLINING);
  });

  it('marks PI 100 as Baseline, not Improving', () => {
    const result = classifyPerformanceIndex(100);
    expect(result.status).toBe(STATUS_BASELINE);
    expect(statusBadgeLabel(result.status)).toBe('BASELINE');
    expect(cardMatchesFilter({ ...result, hasData: true }, 'improving')).toBe(false);
    expect(cardMatchesFilter({ ...result, hasData: true }, 'all')).toBe(true);
  });

  it('sorts descending 108 before 92', () => {
    const cards = sortMetricCards([
      { athleteName: 'B', hasData: true, sortValue: 92 },
      { athleteName: 'A', hasData: true, sortValue: 108 },
    ], 'desc');
    expect(cards.map((c) => c.sortValue)).toEqual([108, 92]);
  });
});

describe('classifyRecovery', () => {
  it('treats 29 → 36 as +7 Improving', () => {
    const result = classifyRecovery(36, 29, 2);
    expect(result.status).toBe(STATUS_IMPROVING);
    expect(result.delta).toBe(7);
  });

  it('treats 36 → 28 as Declining', () => {
    expect(classifyRecovery(28, 36, 2).status).toBe(STATUS_DECLINING);
  });
});

describe('classifyPace', () => {
  it('marks faster pace as Improving', () => {
    // 11:42 → 10:54 is roughly +6.8%
    expect(classifyPace(6.8, true).status).toBe(STATUS_IMPROVING);
  });

  it('returns No Data without comparable weeks', () => {
    expect(classifyPace(6.8, false).status).toBe(STATUS_NO_DATA);
  });
});

describe('classifyHrAdherence', () => {
  it('scores 9/10 as On Target', () => {
    const result = classifyHrAdherence(9, 10);
    expect(result.pct).toBe(90);
    expect(result.status).toBe(STATUS_ON_TARGET);
  });

  it('scores 6/10 as Watch', () => {
    expect(classifyHrAdherence(6, 10).status).toBe(STATUS_WATCH);
  });

  it('scores 5/10 as Needs Attention', () => {
    expect(classifyHrAdherence(5, 10).status).toBe(STATUS_NEEDS_ATTENTION);
  });

  it('returns No Data for zero eligible sessions', () => {
    const result = classifyHrAdherence(0, 0);
    expect(result.status).toBe(STATUS_NO_DATA);
    expect(result.pct).toBeNull();
  });
});

describe('canonical lens cards', () => {
  const athlete = {
    id: 'daniel',
    name: 'Daniel',
    currentWeekIndex: 3,
    scan: {
      performance: {
        index: 108.4,
        detail: 'Camp index',
        points: [
          { weekIndex: 0, pct: 100 },
          { weekIndex: 3, pct: 108.4 },
        ],
      },
      recovery: {
        latest: 36,
        first: 29,
        detail: '29 → 36',
        points: [
          { weekIndex: 0, first5Avg: 29 },
          { weekIndex: 3, first5Avg: 36 },
        ],
      },
      pace: {
        latestPct: 6.8,
        detail: 'Running pace',
        points: [
          { weekIndex: 0, pct: 0 },
          { weekIndex: 3, pct: 6.8 },
        ],
      },
      zone: {
        onTarget: 9,
        scored: 11,
        detail: '9/11',
      },
    },
    performance: { index: 108.4, points: [{ weekIndex: 0, index: 100 }, { weekIndex: 3, index: 108.4 }] },
  };

  it('produces identical PI on benchmark lens from the same athlete', () => {
    const card = buildLensCard(athlete, LENS_BENCHMARK);
    expect(card.value).toBe('108.4');
    expect(card.status).toBe(STATUS_IMPROVING);
    expect(card.userId).toBe('daniel');
  });

  it('keeps recovery / pace / adherence consistent for the same athlete', () => {
    expect(buildLensCard(athlete, LENS_RECOVERY).status).toBe(STATUS_IMPROVING);
    expect(buildLensCard(athlete, LENS_PACE).status).toBe(STATUS_IMPROVING);
    expect(buildLensCard(athlete, LENS_HR_ADHERENCE).value).toBe('82%');
    expect(buildLensCard(athlete, LENS_HR_ADHERENCE).status).toBe(STATUS_ON_TARGET);
  });

  it('dedupes by user_id and does not invent declining from no data', () => {
    const empty = {
      id: 'empty',
      name: 'Empty',
      currentWeekIndex: 0,
      scan: {
        performance: {},
        recovery: {},
        pace: {},
        zone: {},
      },
    };
    const cards = buildLensCards([athlete, athlete, empty], LENS_BENCHMARK);
    expect(cards).toHaveLength(2);
    const noData = cards.find((card) => card.userId === 'empty');
    expect(noData.status).toBe(STATUS_NO_DATA);
    expect(cardMatchesFilter(noData, 'declining')).toBe(false);
  });

  it('filters and searches without mutating source cards', () => {
    const source = buildLensCards([athlete, {
      id: 'maya',
      name: 'Maya Chen',
      currentWeekIndex: 2,
      scan: {
        performance: { index: 92, points: [{ weekIndex: 0, pct: 100 }, { weekIndex: 2, pct: 92 }] },
        recovery: {},
        pace: {},
        zone: { onTarget: 2, scored: 10 },
      },
    }], LENS_BENCHMARK);
    const before = source.map((card) => card.status);
    const visible = selectVisibleCards(source, { filter: 'improving', query: 'dan', sort: 'desc' });
    expect(visible).toHaveLength(1);
    expect(visible[0].athleteName).toBe('Daniel');
    expect(source.map((card) => card.status)).toEqual(before);
  });
});

describe('computeRunningTotals', () => {
  it('ignores machine modality watts sessions', () => {
    const totals = computeRunningTotals([
      { status: 'logged', modality: 'running', minutes: 30, distance: 3 },
      { status: 'logged', modality: 'assault_bike', minutes: 30, distance: 0, avgWatts: 180 },
      { status: 'logged', modality: 'running', minutes: 60, distance: 6.5 },
    ], normalizeModality, MODALITY_RUNNING);
    expect(totals.runningMinutes).toBe(90);
    expect(totals.runningMiles).toBeCloseTo(9.5);
    expect(totals.runningHours).toBeCloseTo(1.5);
  });
});

describe('canonical analytics consistency', () => {
  it('keeps PI 97 Declining and one-decimal display on detail + aggregate card', () => {
    const athlete = {
      id: 'pi97',
      name: 'Pat',
      currentWeekIndex: 1,
      performance: { index: 97 },
      scan: {
        performance: { index: 97, points: [{ weekIndex: 0, pct: 100 }, { weekIndex: 1, pct: 97 }] },
        recovery: {},
        pace: {},
        zone: {},
      },
      sessions: [],
    };
    athlete.analytics = buildCoachAthleteAnalytics(athlete);
    const card = buildLensCard(athlete, LENS_BENCHMARK);
    expect(athlete.analytics.performance.displayValue).toBe('97.0');
    expect(athlete.analytics.performance.status).toBe(STATUS_DECLINING);
    expect(card.value).toBe('97.0');
    expect(card.status).toBe(STATUS_DECLINING);
    expect(statusBadgeLabel(card.status)).toBe('DECLINING');
  });

  it('keeps PI 100 as Baseline on both surfaces', () => {
    const athlete = {
      id: 'pi100',
      name: 'Base',
      currentWeekIndex: 1,
      performance: { index: 100 },
      scan: {
        performance: { index: 100, points: [{ weekIndex: 0, pct: 100 }] },
        recovery: {},
        pace: {},
        zone: {},
      },
      sessions: [],
    };
    athlete.analytics = buildCoachAthleteAnalytics(athlete);
    const card = buildLensCard(athlete, LENS_BENCHMARK);
    expect(athlete.analytics.performance.status).toBe(STATUS_BASELINE);
    expect(card.status).toBe(STATUS_BASELINE);
    expect(statusBadgeLabel(card.status)).toBe('BASELINE');
  });

  it('uses latest First-5 recovery on detail and aggregate, not camp average', () => {
    const athlete = {
      id: 'rec',
      name: 'Ray',
      currentWeekIndex: 2,
      performance: { index: 108.4 },
      scan: {
        performance: { index: 108.4 },
        recovery: {
          latest: 36,
          first: 29,
          avg: 33,
          points: [
            { weekIndex: 0, first5Avg: 29 },
            { weekIndex: 1, first5Avg: 33 },
            { weekIndex: 2, first5Avg: 36 },
          ],
        },
        pace: {},
        zone: { onTarget: 8, scored: 10 },
      },
      sessions: [],
      mileTests: [
        { weekIndex: 0, timeSec: 400 },
        { weekIndex: 5, timeSec: 388 },
      ],
    };
    athlete.analytics = buildCoachAthleteAnalytics(athlete);
    const card = buildLensCard(athlete, LENS_RECOVERY);
    expect(athlete.analytics.recovery.displayValue).toBe('36');
    expect(athlete.analytics.recovery.campAverage).toBeCloseTo(33);
    expect(card.value).toBe('36');
    expect(card.status).toBe(STATUS_IMPROVING);
    expect(athlete.analytics.mileTest.hasData).toBe(true);
    expect(athlete.analytics.mileTest.deltaDisplay).toBe('-12s');
  });

  it('builds weekly HR trend points when zone helpers score sessions', () => {
    const athlete = {
      id: 'hr',
      name: 'Harper',
      currentWeekIndex: 1,
      maxHr: 180,
      restingHr: 50,
      performance: { index: 101 },
      scan: {
        performance: { index: 101 },
        recovery: {},
        pace: {},
        zone: { onTarget: 1, scored: 2 },
      },
      sessions: [
        { status: 'logged', weekIndex: 0, workoutIndex: 1, type: 'Zone 2', avgBpm: 130, minutes: 40, distance: 4, modality: 'running' },
        { status: 'logged', weekIndex: 1, workoutIndex: 1, type: 'Zone 2', avgBpm: 160, minutes: 40, distance: 4.2, modality: 'running' },
      ],
    };
    athlete.analytics = buildCoachAthleteAnalytics(athlete, {
      getSessionZoneTarget: () => ({ target: 135, tolerance: 5 }),
      isSessionAvgOnTarget: (avg, target) => Math.abs(Number(avg) - target.target) <= target.tolerance,
    });
    expect(athlete.analytics.hrAdherence.trendPoints.length).toBe(2);
    expect(athlete.analytics.hrAdherence.trendPoints[0].pct).toBe(100);
    expect(athlete.analytics.hrAdherence.trendPoints[1].pct).toBe(0);
    expect(athlete.analytics.zoneHeatmap.length).toBe(2);
    expect(athlete.analytics.hrPaceEfficiency.length).toBe(2);
    const card = buildLensCard(athlete, LENS_HR_ADHERENCE);
    expect(card.trendPoints.length).toBe(2);
  });

  it('surfaces source outage warnings instead of silent no-data copy', () => {
    const warnings = formatCoachSourceWarnings({
      sprints: 'timeout',
      mileTests: 'timeout',
      hrRows: 'timeout',
    });
    expect(warnings.join(' ')).toMatch(/Sprint data/i);
    expect(warnings.join(' ')).toMatch(/Mile test data/i);
    expect(warnings.join(' ')).toMatch(/HR data/i);
  });

  it('flips known benchmark order asc vs desc', () => {
    const cards = [
      { athleteName: 'Low', hasData: true, sortValue: 92, status: STATUS_DECLINING },
      { athleteName: 'High', hasData: true, sortValue: 108, status: STATUS_IMPROVING },
    ];
    expect(sortMetricCards(cards, 'desc').map((c) => c.athleteName)).toEqual(['High', 'Low']);
    expect(sortMetricCards(cards, 'asc').map((c) => c.athleteName)).toEqual(['Low', 'High']);
  });

  it('keeps only Declining cards when filter is declining', () => {
    const cards = [
      { athleteName: 'A', hasData: true, status: STATUS_DECLINING, sortValue: 90 },
      { athleteName: 'B', hasData: true, status: STATUS_IMPROVING, sortValue: 110 },
      { athleteName: 'C', hasData: true, status: STATUS_BASELINE, sortValue: 100 },
    ];
    const visible = selectVisibleCards(cards, { filter: 'declining', sort: 'desc' });
    expect(visible).toHaveLength(1);
    expect(visible.every((card) => card.status === STATUS_DECLINING)).toBe(true);
  });
});


describe('production-shaped mile test cloud rows', () => {
  it('keeps mile-test:baseline + program retest with time and HR deltas', () => {
    const cloudRows = [
      {
        test_key: 'mile-test:baseline',
        saved_at: '2026-08-01T12:00:00.000Z',
        total_minutes: 6.7,
        total_seconds: 402,
        avg_bpm: 176,
        max_bpm: 193,
        test_context_json: { isBaseline: true },
      },
      {
        test_key: 'program:7:5:2',
        saved_at: '2026-09-05T12:00:00.000Z',
        total_minutes: 6.4,
        total_seconds: 384,
        avg_bpm: 177,
        max_bpm: 196,
        test_context_json: { weekIndex: 5, workoutIndex: 2 },
      },
    ];
    const mileTests = normalizeMileTestCloudRows(cloudRows);
    const athlete = {
      id: 'cloud-mile',
      name: 'Cloud Mile',
      maxHr: 188, // profile max must NOT replace mile-test max
      mileTests,
      performance: { index: 104 },
      scan: { performance: { index: 104 }, recovery: {}, pace: {}, zone: {} },
      sessions: [],
    };
    const analytics = buildCoachAthleteAnalytics(athlete);
    expect(analytics.mileTest.hasData).toBe(true);
    expect(analytics.mileTest.baselineDisplay).toBe('6:42');
    expect(analytics.mileTest.latestDisplay).toBe('6:24');
    expect(analytics.mileTest.deltaDisplay).toBe('-18s');
    expect(analytics.mileTest.baselineMaxBpm).toBe(193);
    expect(analytics.mileTest.latestMaxBpm).toBe(196);
    expect(analytics.mileTest.maxHr).toBe(196);
    expect(analytics.mileTest.profileMaxHr).toBe(188);
    expect(analytics.mileTest.baselineAvgBpm).toBe(176);
    expect(analytics.mileTest.latestAvgBpm).toBe(177);
  });
});

describe('source outage fail-closed decisions', () => {
  it('does not invent Missing/Behind/Logged/On-track when completions source fails', () => {
    const payload = {
      profiles: [{ user_id: 'u1', athlete_name: 'Pat', camp_length: 7, fight_date: '2026-11-01' }],
      hrRows: [{ user_id: 'u1', max_hr: 190, resting_hr: 50 }],
      completions: [], // empty because query rejected
      sprints: [{
        user_id: 'u1',
        week_index: 0,
        workout_index: 0,
        session_at: '2026-09-01T12:00:00.000Z',
        avg_drop: 34,
        session_json: { data: [{ drop: 32 }, { drop: 34 }, { drop: 36 }, { drop: 33 }, { drop: 35 }] },
      }],
      mileTests: [{
        user_id: 'u1',
        test_key: 'mile-test:baseline',
        saved_at: '2026-08-01T12:00:00.000Z',
        total_seconds: 402,
        avg_bpm: 176,
        max_bpm: 193,
      }],
      notes: [],
      identities: [{ user_id: 'u1', email: 'pat@example.com' }],
      exclusions: [],
      meta: [],
      sourceErrors: { completions: 'timeout' },
      sources: {
        profiles: true,
        hrRows: true,
        completions: false,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: true,
        exclusions: true,
        meta: true,
        attachments: true,
      },
    };
    const roster = buildLiveRoster(payload);
    expect(roster).toHaveLength(1);
    const athlete = roster[0];
    expect(athlete.missingCount).toBe(0);
    expect(athlete.logged).toBeNull();
    expect(athlete.completionPct).toBeNull();
    expect(athlete.completionsAvailable).toBe(false);
    expect(athlete.tone).toBe('data-unavailable');
    expect(athlete.tone).not.toBe('on-track');
    expect(athlete.tone).not.toBe('behind');
    expect(athlete.headline).toMatch(/Completion data unavailable/i);
    expect(athlete.headline).not.toMatch(/On track/i);
    expect(athlete.attention.join(' ')).toMatch(/Completion data unavailable/i);
    const dueSessions = athlete.sessions.filter((session) => session.status !== 'upcoming');
    expect(dueSessions.length).toBeGreaterThan(0);
    expect(dueSessions.every((session) => session.status === 'unavailable' || session.status === 'skipped')).toBe(true);
    expect(dueSessions.some((session) => session.status === 'logged')).toBe(false);
    expect(athlete.analytics.performance.status).toBe(STATUS_UNAVAILABLE);
    expect(athlete.analytics.pace.status).toBe(STATUS_UNAVAILABLE);
    expect(athlete.analytics.hrAdherence.status).toBe(STATUS_UNAVAILABLE);
    expect(athlete.analytics.zoneHeatmap).toEqual([]);
    expect(athlete.analytics.hrPaceEfficiency).toEqual([]);
    // Independent sources remain usable when healthy.
    expect(athlete.analytics.recovery.unavailable).not.toBe(true);
    expect(athlete.analytics.mileTest.unavailable).not.toBe(true);
    expect(athlete.analytics.mileTest.hasData).toBe(true);
  });

  it('fails closed when roster exclusions source fails', () => {
    const payload = {
      profiles: [{ user_id: 'u1', athlete_name: 'Pat', camp_length: 7 }],
      hrRows: [],
      completions: [],
      sprints: [],
      mileTests: [],
      notes: [],
      identities: [{ user_id: 'u1', email: 'pat@example.com' }],
      exclusions: [],
      meta: [],
      sourceErrors: { exclusions: 'timeout' },
      sources: {
        profiles: true,
        hrRows: true,
        completions: true,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: true,
        exclusions: false,
        meta: true,
        attachments: true,
      },
    };
    expect(buildLiveRoster(payload)).toEqual([]);
  });

  it('marks HR profile as source-unavailable instead of athlete omission', () => {
    const payload = {
      profiles: [{ user_id: 'u1', athlete_name: 'Pat', camp_length: 7, fight_date: '2026-11-01' }],
      hrRows: [],
      completions: [],
      sprints: [],
      mileTests: [],
      notes: [],
      identities: [{ user_id: 'u1', email: 'pat@example.com' }],
      exclusions: [],
      meta: [],
      sourceErrors: { hrRows: 'timeout' },
      sources: {
        profiles: true,
        hrRows: false,
        completions: true,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: true,
        exclusions: true,
        meta: true,
        attachments: true,
      },
    };
    const roster = buildLiveRoster(payload);
    expect(roster).toHaveLength(1);
    expect(roster[0].hrRowsAvailable).toBe(false);
    expect(roster[0].maxHr).toBeNull();
  });

  it('does not invent proof gaps when attachments source fails', () => {
    const payload = {
      profiles: [{ user_id: 'u1', athlete_name: 'Pat', camp_length: 7, fight_date: '2026-11-01' }],
      hrRows: [{ user_id: 'u1', max_hr: 190, resting_hr: 50 }],
      completions: [{
        user_id: 'u1',
        completion_key: '0:1',
        week_index: 0,
        workout_index: 1,
        workout_type: 'Easy Run',
        avg_bpm: 140,
        completed_at: '2026-09-01T12:00:00.000Z',
        record_json: {},
      }],
      sprints: [],
      mileTests: [],
      notes: [],
      identities: [{ user_id: 'u1', email: 'pat@example.com' }],
      exclusions: [],
      meta: [],
      attachments: [],
      sourceErrors: { attachments: 'timeout' },
      sources: {
        profiles: true,
        hrRows: true,
        completions: true,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: true,
        exclusions: true,
        meta: true,
        attachments: false,
      },
    };
    const roster = buildLiveRoster(payload);
    expect(roster).toHaveLength(1);
    expect(roster[0].proofGaps).toBe(0);
    expect(roster[0].tone).not.toBe('proof');
    expect(roster[0].attachmentsAvailable).toBe(false);
  });

  it('marks recovery DATA UNAVAILABLE when sprints source fails', () => {
    const athlete = {
      id: 'r1',
      name: 'Ray',
      sources: { sprints: false, completions: true, mileTests: true },
      performance: { index: 101 },
      scan: {
        performance: { index: 101 },
        recovery: { latest: 36, first: 29, avg: 33, points: [{ weekIndex: 0, first5Avg: 29 }, { weekIndex: 1, first5Avg: 36 }] },
        pace: {},
        zone: {},
      },
      sessions: [],
    };
    const analytics = buildCoachAthleteAnalytics(athlete);
    expect(analytics.recovery.status).toBe(STATUS_UNAVAILABLE);
    expect(statusBadgeLabel(analytics.recovery.status)).toBe('DATA UNAVAILABLE');
    expect(analytics.recovery.unavailable).toBe(true);
    expect(analytics.recovery.hasData).toBe(false);
  });

  it('marks mile section unavailable when mileTests source fails', () => {
    const athlete = {
      id: 'm1',
      name: 'Miles',
      sources: { mileTests: false, completions: true, sprints: true },
      mileTests: [{ testKey: 'mile-test:baseline', seconds: 400, avgBpm: 170, maxBpm: 190, isBaseline: true }],
      performance: { index: 100 },
      scan: { performance: { index: 100 }, recovery: {}, pace: {}, zone: {} },
      sessions: [],
    };
    const analytics = buildCoachAthleteAnalytics(athlete);
    expect(analytics.mileTest.unavailable).toBe(true);
    expect(analytics.mileTest.hasData).toBe(false);
    expect(analytics.mileTest.status).toBe(STATUS_UNAVAILABLE);
  });

  it('returns an empty roster when identities source fails', () => {
    const payload = {
      profiles: [{ user_id: 'u1', athlete_name: 'Mystery', camp_length: 7 }],
      hrRows: [],
      completions: [],
      sprints: [],
      mileTests: [],
      notes: [],
      identities: [],
      exclusions: [],
      meta: [],
      sourceErrors: { identities: 'timeout' },
      sources: {
        profiles: true,
        hrRows: true,
        completions: true,
        sprints: true,
        mileTests: true,
        notes: true,
        identities: false,
        exclusions: true,
        meta: true,
        attachments: true,
      },
    };
    expect(buildLiveRoster(payload)).toEqual([]);
  });

  it('does not present paceSec/BPM as an efficiency score', () => {
    const athlete = {
      id: 'p1',
      name: 'Pace',
      performance: { index: 102 },
      scan: { performance: { index: 102 }, recovery: {}, pace: {}, zone: {} },
      sessions: [
        { status: 'logged', weekIndex: 0, workoutIndex: 1, type: 'Easy Run', avgBpm: 140, minutes: 40, distance: 4, modality: 'running' },
        { status: 'logged', weekIndex: 1, workoutIndex: 1, type: 'Easy Run', avgBpm: 141, minutes: 38, distance: 4, modality: 'running' },
      ],
    };
    const analytics = buildCoachAthleteAnalytics(athlete, {
      normalizeModality: (value) => value,
      runningModalityId: 'running',
    });
    expect(analytics.hrPaceEfficiency.length).toBe(2);
    expect(analytics.hrPaceEfficiency.every((row) => row.efficiency == null)).toBe(true);
    expect(analytics.hrPaceEfficiency[1].comparisonLabel).toMatch(/similar HR/i);
  });
});
