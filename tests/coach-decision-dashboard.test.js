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
  formatCoachSourceWarnings,
  selectVisibleCards,
  sortMetricCards,
  statusBadgeLabel,
} from '../src/coach-metrics.js';
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
