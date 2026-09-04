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
  buildLensCard,
  buildLensCards,
  cardMatchesFilter,
  classifyHrAdherence,
  classifyPace,
  classifyPerformanceIndex,
  classifyRecovery,
  computeRunningTotals,
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
