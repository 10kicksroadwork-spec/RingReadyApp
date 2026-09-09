import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_COMPONENT_WEIGHTS,
  STATUS_BASELINE,
  STATUS_DECLINING,
  STATUS_IMPROVING,
  STATUS_NO_DATA,
  STATUS_STABLE,
  STATUS_UNAVAILABLE,
  buildBenchmarkMetricFromPoints,
  buildCoachAthleteAnalytics,
  buildCompositePerformanceIndex,
  classifyCompositeTrajectory,
  clampPerformanceComponentChange,
} from '../src/coach-metrics.js';
import { buildPerformanceContinuity, MODALITY_ASSAULT_BIKE } from '../src/modality.js';

function benchSession(weekIndex, distance, avgBpm = 137, extras = {}) {
  return {
    status: 'logged',
    type: 'Benchmark Run',
    modality: 'running',
    weekIndex,
    workoutIndex: 1,
    minutes: 30,
    distance,
    avgBpm,
    targetBPM: 137,
    ...extras,
  };
}

function bikeSession(weekIndex, watts, avgBpm = 137, extras = {}) {
  return {
    status: 'logged',
    type: 'Easy Run',
    modality: MODALITY_ASSAULT_BIKE,
    weekIndex,
    workoutIndex: 2,
    minutes: 20,
    avgWatts: watts,
    outputValue: watts,
    avgBpm,
    targetBPM: 137,
    ...extras,
  };
}

describe('composite Performance Index weights', () => {
  it('keeps tunable weights summing to 1.0', () => {
    const sum = Object.values(PERFORMANCE_COMPONENT_WEIGHTS)
      .reduce((total, weight) => total + weight, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('buildCompositePerformanceIndex', () => {
  it('sets PI to 100 on first valid observations', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 2.9)],
      recoveryPoints: [{ weekIndex: 0, value: 30 }],
      pacePoints: [{ weekIndex: 0, value: 0 }],
      hrPoints: [{ weekIndex: 0, pct: 70, value: 70 }],
      mileHistory: [{ weekIndex: 0, seconds: 420, isBaseline: true }],
      currentWeekIndex: 0,
    });
    expect(result.hasData).toBe(true);
    expect(result.index).toBe(100);
    expect(result.deltaFromBaseline).toBe(0);
    expect(result.status).toBe(STATUS_BASELINE);
    expect(result.trajectoryLabel).toBe('BASELINE');
    expect(result.confidence).toBe('establishing');
    expect(result.confidenceLabel).toMatch(/Establishing baseline/i);
    expect(result.detail).not.toMatch(/High confidence/i);
  });

  it('lets the second week move immediately (no two-session wait)', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [
        benchSession(0, 2.9),
        benchSession(1, 3.045),
      ],
      currentWeekIndex: 1,
    });
    expect(result.trendPoints).toHaveLength(2);
    expect(result.trendPoints[0].value).toBe(100);
    expect(result.trendPoints[1].value).toBeGreaterThan(100);
    expect(result.index).toBeGreaterThan(100);
  });

  it('moves above 100 on broad positive improvement', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 2.9), benchSession(1, 3.1)],
      recoveryPoints: [
        { weekIndex: 0, value: 28 },
        { weekIndex: 1, value: 34 },
      ],
      pacePoints: [
        { weekIndex: 0, value: 0 },
        { weekIndex: 1, value: 4.2 },
      ],
      currentWeekIndex: 1,
    });
    expect(result.index).toBeGreaterThan(100);
    expect(result.status).toBe(STATUS_IMPROVING);
  });

  it('marks DECLINING when several metrics worsen vs prior week', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [
        benchSession(0, 3.0),
        benchSession(1, 3.2),
        benchSession(2, 2.8),
      ],
      recoveryPoints: [
        { weekIndex: 0, value: 32 },
        { weekIndex: 1, value: 36 },
        { weekIndex: 2, value: 28 },
      ],
      pacePoints: [
        { weekIndex: 0, value: 0 },
        { weekIndex: 1, value: 5 },
        { weekIndex: 2, value: -2 },
      ],
      currentWeekIndex: 2,
    });
    expect(result.trendPoints.length).toBeGreaterThanOrEqual(3);
    const prior = result.trendPoints[result.trendPoints.length - 2].value;
    expect(result.index).toBeLessThan(prior);
    expect(result.status).toBe(STATUS_DECLINING);
  });

  it('reports DECLINING for 100 → 108 → 104 even while above baseline', () => {
    // Construct component series that yield approximately those PI levels.
    const result = buildCompositePerformanceIndex({
      sessions: [
        benchSession(0, 3.0),
        benchSession(1, 3.24),
        benchSession(2, 3.12),
      ],
      currentWeekIndex: 2,
    });
    expect(result.trendPoints[0].value).toBe(100);
    expect(result.trendPoints[1].value).toBeGreaterThan(result.trendPoints[2].value);
    expect(result.index).toBeGreaterThan(100);
    expect(result.deltaFromBaseline).toBeGreaterThan(0);
    expect(result.status).toBe(STATUS_DECLINING);
  });

  it('does not penalize missing Sprint', () => {
    const withSprint = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 3.0), benchSession(1, 3.1)],
      recoveryPoints: [
        { weekIndex: 0, value: 30 },
        { weekIndex: 1, value: 30 },
      ],
      currentWeekIndex: 1,
    });
    const withoutSprint = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 3.0), benchSession(1, 3.1)],
      recoveryPoints: [],
      currentWeekIndex: 1,
    });
    // Missing sprint must not invent a negative recovery contribution.
    expect(withoutSprint.components.sprintRecovery.available).toBe(false);
    expect(withoutSprint.index).toBeGreaterThan(100);
    expect(Math.abs(withoutSprint.index - withSprint.index)).toBeLessThan(5);
  });

  it('keeps Mile at baseline until a retest exists', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 3.0)],
      mileHistory: [{ weekIndex: 0, seconds: 420, isBaseline: true }],
      currentWeekIndex: 3,
    });
    expect(result.components.mileTest.available).toBe(true);
    expect(result.components.mileTest.rawChange).toBe(0);
    expect(result.components.mileTest.label).toBe('baseline');
    expect(result.index).toBe(100);
  });

  it('does not jump PI when a new component first appears', () => {
    const before = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 3.0), benchSession(1, 3.15)],
      currentWeekIndex: 1,
    });
    const after = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 3.0), benchSession(1, 3.15)],
      recoveryPoints: [{ weekIndex: 1, value: 33 }],
      currentWeekIndex: 1,
    });
    // First recovery observation is baseline/change 0 — PI should stay flat.
    expect(after.index).toBeCloseTo(before.index, 1);
  });

  it('moves Cardio Output from machine watts without fake distance conversion', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [
        bikeSession(0, 180),
        bikeSession(1, 198),
      ],
      currentWeekIndex: 1,
    });
    expect(result.cardioContinuity.latestModality).toBe(MODALITY_ASSAULT_BIKE);
    expect(result.cardioContinuity.points.every((row) => row.modality === MODALITY_ASSAULT_BIKE)).toBe(true);
    expect(result.index).toBeGreaterThan(100);
  });

  it('inherits Cardio continuity on RUN → Assault Bike switch without resetting PI', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [
        benchSession(0, 2.85),
        benchSession(1, 2.98),
        benchSession(2, 3.10),
        bikeSession(3, 179),
        bikeSession(3, 185, 138, { workoutIndex: 3 }),
        bikeSession(4, 191, 136, { type: 'Benchmark Run', workoutIndex: 1 }),
      ],
      currentWeekIndex: 4,
    });
    const continuity = result.cardioContinuity;
    const firstBike = continuity.points.find((row) => row.modality === MODALITY_ASSAULT_BIKE);
    expect(firstBike.index).toBeGreaterThan(105);
    expect(result.trendPoints.some((row) => row.weekIndex === 3 && row.value > 105)).toBe(true);
    expect(result.index).toBeGreaterThan(108);
  });

  it('resumes an established modality baseline when returning to it', () => {
    const continuity = buildPerformanceContinuity([
      benchSession(0, 3.0),
      benchSession(1, 3.2),
      bikeSession(2, 180),
      bikeSession(3, 190),
      benchSession(4, 3.1),
    ]);
    const runBaseline = continuity.baselines.find((row) => row.modality === 'running');
    const lastRun = [...continuity.points].reverse().find((row) => row.modality === 'running');
    expect(runBaseline.baselineOutput).toBeCloseTo(3.0, 5);
    // Returning to running resumes the original running baseline (3.0), not the bike watts.
    expect(lastRun.index).toBeCloseTo(runBaseline.baselinePerformanceIndex * (3.1 / 3.0), 1);
  });

  it('caps outlier component contributions at ±25', () => {
    expect(clampPerformanceComponentChange(100)).toBe(25);
    expect(clampPerformanceComponentChange(-80)).toBe(-25);
    const result = buildCompositePerformanceIndex({
      recoveryPoints: [
        { weekIndex: 0, value: 20 },
        { weekIndex: 1, value: 60 }, // +200% raw
      ],
      currentWeekIndex: 1,
    });
    expect(result.components.sprintRecovery.rawChange).toBeGreaterThan(25);
    expect(result.components.sprintRecovery.boundedChange).toBe(25);
    // Only recovery contributes (weight 0.25 of available 0.25) → +25 to PI.
    expect(result.index).toBe(125);
  });

  it('uses HR adherence percentage-point change, not relative percent', () => {
    const result = buildCompositePerformanceIndex({
      hrPoints: [
        { weekIndex: 0, pct: 68, value: 68 },
        { weekIndex: 1, pct: 82, value: 82 },
      ],
      currentWeekIndex: 1,
    });
    expect(result.components.hrAdherence.rawChange).toBe(14);
    expect(result.components.hrAdherence.label).toContain('pts');
  });

  it('treats source outage as DATA LIMITED and caps confidence', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [benchSession(0, 3.0), benchSession(1, 3.2)],
      recoveryPoints: [
        { weekIndex: 0, value: 30 },
        { weekIndex: 1, value: 34 },
      ],
      sprintsAvailable: false,
      currentWeekIndex: 1,
    });
    expect(result.dataLimited).toBe(true);
    expect(result.detail).toMatch(/DATA LIMITED/i);
    expect(result.confidence).not.toBe('high');
    expect(result.hasData).toBe(true);
    expect(result.components.sprintRecovery.outage).toBe(true);
  });

  it('returns -- (not 0 or 100) when no usable metrics exist', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [],
      recoveryPoints: [],
      pacePoints: [],
      hrPoints: [],
      mileHistory: [],
      currentWeekIndex: 0,
    });
    expect(result.hasData).toBe(false);
    expect(result.displayValue).toBe('--');
    expect(result.index).toBeNull();
    expect(result.status).toBe(STATUS_NO_DATA);
  });

  it('agrees with canonical Benchmark / Recovery / Pace series', () => {
    const benchmarks = [
      { weekIndex: 0, distance: 3.0, avgBpm: 137 },
      { weekIndex: 2, distance: 3.15, avgBpm: 137 },
    ];
    const bench = buildBenchmarkMetricFromPoints(benchmarks);
    const recoveryPoints = [
      { weekIndex: 0, value: 29 },
      { weekIndex: 2, value: 36 },
    ];
    const pacePoints = [
      { weekIndex: 0, value: 0 },
      { weekIndex: 2, value: 6.8 },
    ];
    const result = buildCompositePerformanceIndex({
      benchmarkTrendPoints: bench.trendPoints,
      recoveryPoints,
      pacePoints,
      currentWeekIndex: 2,
    });
    expect(result.components.cardioOutput.rawChange).toBeCloseTo(bench.index - 100, 1);
    expect(result.components.sprintRecovery.rawChange).toBeCloseTo(((36 / 29) - 1) * 100, 1);
    expect(result.components.pace.rawChange).toBeCloseTo(6.8, 5);
  });

  it('uses canonical Benchmark for RUN even when avg HR is outside ±5 of target', () => {
    const sessions = [
      benchSession(0, 3.0, 143), // 6 BPM over target 137 — continuity would exclude
      benchSession(1, 3.15, 144),
    ];
    const continuity = buildPerformanceContinuity(sessions);
    expect(continuity.points).toHaveLength(0);

    const bench = buildBenchmarkMetricFromPoints([
      { weekIndex: 0, distance: 3.0, avgBpm: 143, targetBPM: 137 },
      { weekIndex: 1, distance: 3.15, avgBpm: 144, targetBPM: 137 },
    ]);
    expect(bench.hasData).toBe(true);
    expect(bench.index).toBeGreaterThan(100);

    const result = buildCompositePerformanceIndex({
      sessions,
      benchmarkTrendPoints: bench.trendPoints,
      currentWeekIndex: 1,
    });
    expect(result.cardioSource).toBe('benchmark');
    expect(result.components.cardioOutput.available).toBe(true);
    expect(result.components.cardioOutput.rawChange).toBeCloseTo(bench.index - 100, 1);
    expect(result.index).toBeCloseTo(bench.index, 1);
  });

  it('keeps Declining after a no-evidence carry-forward week', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [
        benchSession(0, 3.0),
        benchSession(1, 2.85),
      ],
      currentWeekIndex: 2, // Week 3 plotted with carry-forward only
    });
    expect(result.trendPoints.map((row) => row.value)).toEqual([
      result.trendPoints[0].value,
      result.trendPoints[1].value,
      result.trendPoints[2].value,
    ]);
    expect(result.trendPoints).toHaveLength(3);
    expect(result.trendPoints[0].value).toBe(100);
    expect(result.trendPoints[1].value).toBeLessThan(100);
    expect(result.trendPoints[2].value).toBe(result.trendPoints[1].value);
    expect(result.trendPoints[2].hasNewEvidence).toBe(false);
    expect(result.status).toBe(STATUS_DECLINING);
    expect(result.noNewSignalThisWeek).toBe(true);
    expect(result.detail).toMatch(/No new performance signal/i);
    expect(result.trajectoryLabel).toBe('DECLINING');
  });

  it('counts only weighted components in N/5 contributing', () => {
    const result = buildCompositePerformanceIndex({
      sessions: [
        benchSession(0, 3.0),
        benchSession(1, 3.2),
      ],
      recoveryPoints: [
        { weekIndex: 0, value: 30 },
        { weekIndex: 1, value: 33 },
      ],
      // First recovery is mature; pace is establishing-only at week 1 if only one point —
      // add a brand-new mile baseline observation that must not count as weighted.
      mileHistory: [{ weekIndex: 1, seconds: 420, isBaseline: true }],
      currentWeekIndex: 1,
    });
    expect(result.weightedComponents).toBe(2);
    expect(result.establishingComponents).toBe(1);
    expect(result.availableComponents).toBe(3);
    expect(result.contributingComponents).toBe(2);
    expect(result.detail).toMatch(/2\/5 trend signals/);
    expect(result.detail).not.toMatch(/3\/5/);
  });
});

describe('classifyCompositeTrajectory', () => {
  it('uses trajectory deadband, not level vs 100', () => {
    expect(classifyCompositeTrajectory(-1.2, 2).status).toBe(STATUS_DECLINING);
    expect(classifyCompositeTrajectory(1.2, 2).status).toBe(STATUS_IMPROVING);
    expect(classifyCompositeTrajectory(0.2, 2).label).toBe('STABLE');
    expect(classifyCompositeTrajectory(0.2, 2).status).toBe(STATUS_STABLE);
    expect(classifyCompositeTrajectory(null, 1).status).toBe(STATUS_BASELINE);
  });
});

describe('analytics wiring uses composite PI', () => {
  it('builds composite PI instead of modality-only continuity as final score', () => {
    const athlete = {
      id: 'wired',
      name: 'Wired',
      currentWeekIndex: 1,
      campLength: 7,
      benchmarks: [
        { weekIndex: 0, distance: 2.9, avgBpm: 137 },
        { weekIndex: 1, distance: 3.05, avgBpm: 137 },
      ],
      scan: {
        recovery: {
          first: 30,
          latest: 33,
          points: [
            { weekIndex: 0, first5Avg: 30 },
            { weekIndex: 1, first5Avg: 33 },
          ],
        },
        pace: {
          latestPct: 3.5,
          points: [
            { weekIndex: 0, pct: 0 },
            { weekIndex: 1, pct: 3.5 },
          ],
        },
        zone: { onTarget: 4, scored: 5 },
      },
      sessions: [],
      mileTests: [],
    };
    const analytics = buildCoachAthleteAnalytics(athlete);
    expect(analytics.performance.hasData).toBe(true);
    expect(analytics.performance.index).toBeGreaterThan(100);
    expect(analytics.performance.contributingComponents).toBeGreaterThanOrEqual(2);
    expect(analytics.performance).not.toEqual(analytics.benchmark);
    expect(analytics.performance.confidence).toMatch(/high|medium|low|establishing/);
  });

  it('marks full source absence as unavailable/no-data without inventing 100', () => {
    const analytics = buildCoachAthleteAnalytics({
      id: 'empty',
      scan: { recovery: {}, pace: {}, zone: {} },
      sessions: [],
      sources: {
        completions: false,
        sprints: false,
        mileTests: false,
      },
    });
    expect(analytics.performance.displayValue).toBe('--');
    expect([STATUS_NO_DATA, STATUS_UNAVAILABLE]).toContain(analytics.performance.status);
  });
});
