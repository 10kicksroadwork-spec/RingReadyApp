import { describe, expect, it } from 'vitest';
import {
  getSessionZoneTarget,
  getZoneBand,
  isSessionAvgOnTarget,
  measureZoneMiss,
  scoreZoneAdherence,
  summarizeZoneMisses,
} from '../src/hr-analytics.js';
import {
  LENS_HR_ADHERENCE,
  buildCoachAthleteAnalytics,
  buildLensCard,
} from '../src/coach-metrics.js';

const BAND_137 = { target: 137, tolerance: 5, mode: 'flat' };

describe('zone miss magnitude from nearest band edge', () => {
  it('treats exact upper and lower boundaries as in-zone / 0 miss', () => {
    const band = getZoneBand(BAND_137);
    expect(band).toEqual({ target: 137, tolerance: 5, low: 132, high: 142 });

    const lower = measureZoneMiss(132, BAND_137);
    const upper = measureZoneMiss(142, BAND_137);
    expect(lower.onTarget).toBe(true);
    expect(upper.onTarget).toBe(true);
    expect(lower.missBpm).toBe(0);
    expect(upper.missBpm).toBe(0);
    expect(lower.headline).toBe('IN ZONE');
    expect(upper.headline).toBe('IN ZONE');
    expect(isSessionAvgOnTarget(132, BAND_137)).toBe(true);
    expect(isSessionAvgOnTarget(142, BAND_137)).toBe(true);
  });

  it('measures 1 bpm outside either boundary', () => {
    const high = measureZoneMiss(143, BAND_137);
    const low = measureZoneMiss(131, BAND_137);
    expect(high).toMatchObject({
      onTarget: false,
      missBpm: 1,
      direction: 'high',
      headline: '1 bpm HIGH',
      bandLabel: 'Target 132–142',
    });
    expect(low).toMatchObject({
      onTarget: false,
      missBpm: 1,
      direction: 'low',
      headline: '1 bpm LOW',
    });
    expect(isSessionAvgOnTarget(143, BAND_137)).toBe(false);
    expect(isSessionAvgOnTarget(131, BAND_137)).toBe(false);
  });

  it('measures high and low misses from nearest edge, not midpoint', () => {
    // Midpoint delta for 150 would be 13; nearest-edge miss is 8.
    expect(measureZoneMiss(150, BAND_137)).toMatchObject({
      missBpm: 8,
      direction: 'high',
      headline: '8 bpm HIGH',
    });
    expect(measureZoneMiss(145, BAND_137)).toMatchObject({
      missBpm: 3,
      direction: 'high',
      headline: '3 bpm HIGH',
    });
    expect(measureZoneMiss(130, BAND_137)).toMatchObject({
      missBpm: 2,
      direction: 'low',
      headline: '2 bpm LOW',
    });
    expect(measureZoneMiss(138, BAND_137)).toMatchObject({
      onTarget: true,
      missBpm: 0,
      headline: 'IN ZONE',
    });
  });

  it('summarizes mixed high/low misses without including in-zone sessions', () => {
    const measurements = [
      measureZoneMiss(138, BAND_137), // in zone
      measureZoneMiss(150, BAND_137), // 8 high
      measureZoneMiss(130, BAND_137), // 2 low
      measureZoneMiss(156, BAND_137), // 14 high
    ];
    const summary = summarizeZoneMisses(measurements);
    expect(summary.missCount).toBe(3);
    expect(summary.avgMissBpm).toBeCloseTo((8 + 2 + 14) / 3, 5);
    expect(summary.worstMissBpm).toBe(14);
    expect(summary.worstDirection).toBe('high');
    expect(summary.summaryLabel).toBe('Avg miss: 8 bpm · Worst miss: 14 bpm HIGH');
  });

  it('returns empty miss summary when all sessions are in zone', () => {
    const summary = summarizeZoneMisses([
      measureZoneMiss(137, BAND_137),
      measureZoneMiss(132, BAND_137),
      measureZoneMiss(142, BAND_137),
    ]);
    expect(summary.missCount).toBe(0);
    expect(summary.avgMissBpm).toBeNull();
    expect(summary.worstMissBpm).toBeNull();
    expect(summary.summaryLabel).toBeNull();
  });

  it('ignores missing / ineligible HR instead of inventing a miss', () => {
    expect(measureZoneMiss(null, BAND_137).eligible).toBe(false);
    expect(measureZoneMiss(0, BAND_137).eligible).toBe(false);
    expect(measureZoneMiss(150, null).eligible).toBe(false);
    const summary = summarizeZoneMisses([
      measureZoneMiss(null, BAND_137),
      measureZoneMiss(150, BAND_137),
    ]);
    expect(summary.missCount).toBe(1);
    expect(summary.avgMissBpm).toBe(8);
  });
});

describe('scoreZoneAdherence miss summary parity', () => {
  it('keeps on-target counts identical while adding miss magnitude', () => {
    const sessions = [
      { status: 'logged', type: 'Easy Run', weekIndex: 0, workoutIndex: 3, avgBpm: 138, targetBPM: 137 },
      { status: 'logged', type: 'Long Run', weekIndex: 0, workoutIndex: 4, avgBpm: 150, targetBPM: 137 },
      { status: 'logged', type: 'Threshold Run', weekIndex: 1, workoutIndex: 2, avgBpm: 130, targetBPM: 137 },
      { status: 'logged', type: 'Sprint Intervals', weekIndex: 1, workoutIndex: 0, avgBpm: 180, targetBPM: 172 },
    ];
    const result = scoreZoneAdherence(sessions, () => null, {});
    expect(result.scored).toBe(3);
    expect(result.onTarget).toBe(1);
    expect(result.missCount).toBe(2);
    expect(result.avgMissBpm).toBeCloseTo(5, 5); // (8 + 2) / 2
    expect(result.worstMissBpm).toBe(8);
    expect(result.worstDirection).toBe('high');
    expect(result.summaryLabel).toBe('Avg miss: 5 bpm · Worst miss: 8 bpm HIGH');
  });

  it('returns no scored sessions when no eligible HR targets exist', () => {
    const result = scoreZoneAdherence(
      [{ status: 'logged', type: 'Easy Run', weekIndex: 0, workoutIndex: 3, avgBpm: 140 }],
      () => null,
      {}
    );
    expect(result.scored).toBe(0);
    expect(result.onTarget).toBe(0);
    expect(result.summaryLabel).toBeNull();
  });
});

describe('coach zone heatmap + summary wiring', () => {
  const helpers = {
    getSessionZoneTarget: (session) => (
      Number.isFinite(Number(session.targetBPM))
        ? { target: Number(session.targetBPM), tolerance: 5, mode: 'flat' }
        : null
    ),
    isSessionAvgOnTarget,
  };

  it('exposes HIGH/LOW headlines and band labels on heatmap cells', () => {
    const athlete = {
      id: 'zone-heat',
      name: 'Zone Heat',
      maxHr: 190,
      restingHr: 60,
      scan: { recovery: {}, pace: {}, zone: {} },
      sessions: [
        { status: 'logged', type: 'Easy Run', day: 'Tuesday', weekIndex: 0, workoutIndex: 3, avgBpm: 150, targetBPM: 137 },
        { status: 'logged', type: 'Long Run', day: 'Thursday', weekIndex: 0, workoutIndex: 4, avgBpm: 130, targetBPM: 137 },
        { status: 'logged', type: 'Easy Run', day: 'Tuesday', weekIndex: 1, workoutIndex: 3, avgBpm: 138, targetBPM: 137 },
      ],
    };
    const analytics = buildCoachAthleteAnalytics(athlete, helpers);
    expect(analytics.zoneHeatmap).toHaveLength(3);
    expect(analytics.zoneHeatmap[0]).toMatchObject({
      label: 'W1 Tuesday',
      headline: '8 bpm HIGH',
      avgBpm: 150,
      bandLabel: 'Target 132–142',
      onTarget: false,
    });
    expect(analytics.zoneHeatmap[1]).toMatchObject({
      headline: '2 bpm LOW',
      onTarget: false,
    });
    expect(analytics.zoneHeatmap[2]).toMatchObject({
      headline: 'IN ZONE',
      onTarget: true,
      missBpm: 0,
    });
    expect(analytics.hrAdherence.detail).toContain('1/3 within target HR band');
    expect(analytics.hrAdherence.detail).toContain('Avg miss: 5 bpm · Worst miss: 8 bpm HIGH');
    expect(analytics.hrAdherence.avgMissBpm).toBeCloseTo(5, 5);
    expect(analytics.hrAdherence.worstMissBpm).toBe(8);

    const card = buildLensCard({ ...athlete, analytics }, LENS_HR_ADHERENCE);
    expect(card.deltaLabel).toContain('1 / 3 eligible sessions within target range');
    expect(card.deltaLabel).toContain('Avg miss: 5 bpm · Worst miss: 8 bpm HIGH');
  });

  it('keeps summary miss fields empty when every scored session is in zone', () => {
    const athlete = {
      id: 'all-in',
      name: 'All In',
      scan: { recovery: {}, pace: {}, zone: {} },
      sessions: [
        { status: 'logged', type: 'Easy Run', weekIndex: 0, workoutIndex: 3, avgBpm: 137, targetBPM: 137 },
        { status: 'logged', type: 'Long Run', weekIndex: 0, workoutIndex: 4, avgBpm: 140, targetBPM: 137 },
      ],
    };
    const analytics = buildCoachAthleteAnalytics(athlete, helpers);
    expect(analytics.hrAdherence.detail).toBe('2/2 within target HR band');
    expect(analytics.hrAdherence.missSummaryLabel).toBeNull();
    expect(analytics.zoneHeatmap.every((cell) => cell.headline === 'IN ZONE')).toBe(true);
  });

  it('does not invent miss summary when no eligible zone targets exist', () => {
    const athlete = {
      id: 'no-zone',
      name: 'No Zone',
      scan: { recovery: {}, pace: {}, zone: {} },
      sessions: [
        { status: 'logged', type: 'Easy Run', weekIndex: 0, workoutIndex: 3, avgBpm: 140 },
      ],
    };
    const analytics = buildCoachAthleteAnalytics(athlete, helpers);
    expect(analytics.zoneHeatmap).toHaveLength(0);
    expect(analytics.hrAdherence.hasData).toBe(false);
    expect(analytics.hrAdherence.missSummaryLabel).toBeNull();
  });

  it('agrees with getSessionZoneTarget band for flat targets', () => {
    const session = { type: 'Easy Run', avgBpm: 150, targetBPM: 137 };
    const zoneTarget = getSessionZoneTarget(session, { type: 'Easy Run', targetBPM: 137 }, {});
    expect(zoneTarget).toEqual({ target: 137, tolerance: 5, mode: 'flat' });
    expect(measureZoneMiss(150, zoneTarget).headline).toBe('8 bpm HIGH');
  });
});
