import { describe, expect, it } from 'vitest';
import { PROGRAM } from '../src/program.js';
import {
  getCoachPersonalizedTargetBpm,
  getCoachSessionZoneTarget,
  hasUsableCoachHrProfile,
  parseCoachTargetPct,
  scoreCoachZoneAdherence,
} from '../src/coach-hr-targets.js';
import { measureZoneMiss } from '../src/hr-analytics.js';
import {
  buildAthleteRecord,
  liveAthleteConfig,
} from '../src/coach-preview.js';
import {
  LENS_HR_ADHERENCE,
  buildCoachAthleteAnalytics,
  buildLensCard,
} from '../src/coach-metrics.js';

const jordanHr = {
  maxHr: 197,
  restingHr: 64,
};

function programWorkout(weekIndex, workoutIndex) {
  return PROGRAM[weekIndex].workouts[workoutIndex];
}

describe('parseCoachTargetPct', () => {
  it('parses midpoints from common program zone strings', () => {
    expect(parseCoachTargetPct({ targetZone: '60-70%' })).toBe(65);
    expect(parseCoachTargetPct({ targetZone: '84%-88%' })).toBe(86);
    expect(parseCoachTargetPct({ targetZone: '75-80%' })).toBe(77.5);
    expect(parseCoachTargetPct({ targetZone: '95-100%' })).toBe(97.5);
  });

  it('prefers explicit numeric targetPct over targetZone text', () => {
    expect(parseCoachTargetPct({ targetPct: 70, targetZone: '60-70%' })).toBe(70);
  });

  it('returns null when no percentage can be resolved', () => {
    expect(parseCoachTargetPct({})).toBeNull();
    expect(parseCoachTargetPct({ targetZone: 'easy' })).toBeNull();
  });
});

describe('hasUsableCoachHrProfile', () => {
  it('requires positive max > resting', () => {
    expect(hasUsableCoachHrProfile(jordanHr)).toBe(true);
    expect(hasUsableCoachHrProfile({ maxHr: 197, restingHr: 0 })).toBe(false);
    expect(hasUsableCoachHrProfile({ maxHr: 0, restingHr: 64 })).toBe(false);
    expect(hasUsableCoachHrProfile({ maxHr: 64, restingHr: 197 })).toBe(false);
    expect(hasUsableCoachHrProfile({})).toBe(false);
  });
});

describe('getCoachPersonalizedTargetBpm', () => {
  it('computes Jordan personalized BPM from HRR midpoints', () => {
    const easy = programWorkout(0, 1); // Benchmark 60-70%
    const threshold = programWorkout(0, 2); // Threshold 84-88%
    expect(getCoachPersonalizedTargetBpm(easy, {}, jordanHr)).toBe(150);
    expect(getCoachPersonalizedTargetBpm(threshold, {}, jordanHr)).toBe(178);
  });

  it('lets persisted completion target win over program 137 and HR calc', () => {
    const easy = { ...programWorkout(0, 1), targetBPM: 137 };
    expect(getCoachPersonalizedTargetBpm(
      easy,
      { persistedTargetBPM: 150 },
      jordanHr
    )).toBe(150);
  });

  it('falls back to legacy program BPM when profile and persisted are missing', () => {
    const easy = { ...programWorkout(0, 1), targetBPM: 137 };
    expect(getCoachPersonalizedTargetBpm(easy, {}, {})).toBe(137);
    expect(getCoachPersonalizedTargetBpm(easy, {}, { maxHr: 197, restingHr: 0 })).toBe(137);
  });

  it('does not throw when inputs are empty', () => {
    expect(getCoachPersonalizedTargetBpm(null, null, null)).toBeNull();
  });
});

describe('getCoachSessionZoneTarget — Threshold weighted session average', () => {
  it('Jordan W1 Threshold → 171 / band 166–176', () => {
    const workout = programWorkout(0, 2);
    const zone = getCoachSessionZoneTarget(
      { type: workout.type, weekIndex: 0, workoutIndex: 2 },
      workout,
      jordanHr
    );
    expect(zone).toEqual({ target: 171, tolerance: 5, mode: 'session-avg' });
    expect(measureZoneMiss(165, zone).headline).toBe('1 bpm LOW');
    expect(measureZoneMiss(165, zone).bandLabel).toBe('Target 166–176');
  });

  it('Jordan W2 Threshold → 170 / band 165–175', () => {
    const workout = programWorkout(1, 2);
    const zone = getCoachSessionZoneTarget(
      { type: workout.type, weekIndex: 1, workoutIndex: 2 },
      workout,
      jordanHr
    );
    expect(zone).toEqual({ target: 170, tolerance: 5, mode: 'session-avg' });
    expect(measureZoneMiss(169, zone).headline).toBe('IN ZONE');
    expect(measureZoneMiss(169, zone).bandLabel).toBe('Target 165–175');
  });

  it('flat 60-70% sessions use personalized 150 (±5 → 145–155)', () => {
    const workout = programWorkout(0, 1);
    const zone = getCoachSessionZoneTarget(
      { type: workout.type, weekIndex: 0, workoutIndex: 1 },
      workout,
      jordanHr
    );
    expect(zone).toEqual({ target: 150, tolerance: 5, mode: 'flat' });
    expect(measureZoneMiss(154, zone).bandLabel).toBe('Target 145–155');
  });
});

describe('Jordan Tillman coach zone adherence regression', () => {
  const jordanSessions = [
    { status: 'logged', type: 'Benchmark Run + S&C', day: 'Tuesday', weekIndex: 0, workoutIndex: 1, avgBpm: 154 },
    { status: 'logged', type: 'Threshold Run', day: 'Wednesday', weekIndex: 0, workoutIndex: 2, avgBpm: 165 },
    { status: 'logged', type: 'Easy Run', day: 'Thursday', weekIndex: 0, workoutIndex: 3, avgBpm: 142 },
    { status: 'logged', type: 'Long Run + S&C', day: 'Saturday/Sunday', weekIndex: 0, workoutIndex: 4, avgBpm: 146 },
    { status: 'logged', type: 'Benchmark Run + S&C', day: 'Tuesday', weekIndex: 1, workoutIndex: 1, avgBpm: 153 },
    { status: 'logged', type: 'Threshold Run', day: 'Wednesday', weekIndex: 1, workoutIndex: 2, avgBpm: 169 },
    { status: 'logged', type: 'Easy Run', day: 'Thursday', weekIndex: 1, workoutIndex: 3, avgBpm: 144 },
  ];

  const expected = [
    { label: 'W1 Tuesday', avgBpm: 154, bandLabel: 'Target 145–155', headline: 'IN ZONE', onTarget: true },
    { label: 'W1 Wednesday', avgBpm: 165, bandLabel: 'Target 166–176', headline: '1 bpm LOW', onTarget: false },
    { label: 'W1 Thursday', avgBpm: 142, bandLabel: 'Target 145–155', headline: '3 bpm LOW', onTarget: false },
    { label: 'W1 Saturday/Sunday', avgBpm: 146, bandLabel: 'Target 145–155', headline: 'IN ZONE', onTarget: true },
    { label: 'W2 Tuesday', avgBpm: 153, bandLabel: 'Target 145–155', headline: 'IN ZONE', onTarget: true },
    { label: 'W2 Wednesday', avgBpm: 169, bandLabel: 'Target 165–175', headline: 'IN ZONE', onTarget: true },
    { label: 'W2 Thursday', avgBpm: 144, bandLabel: 'Target 145–155', headline: '1 bpm LOW', onTarget: false },
  ];

  it('scores each Jordan session with personalized bands (not 132–142 / 155–165)', () => {
    const workoutLookup = (session) => programWorkout(session.weekIndex, session.workoutIndex);
    jordanSessions.forEach((session, index) => {
      const zone = getCoachSessionZoneTarget(session, workoutLookup(session), jordanHr);
      const miss = measureZoneMiss(session.avgBpm, zone);
      expect(miss.bandLabel).toBe(expected[index].bandLabel);
      expect(miss.headline).toBe(expected[index].headline);
      expect(miss.onTarget).toBe(expected[index].onTarget);
      expect(miss.bandLabel).not.toMatch(/132–142|155–165|154–164/);
    });

    const scored = scoreCoachZoneAdherence(jordanSessions, workoutLookup, jordanHr);
    expect(scored.scored).toBe(7);
    expect(scored.onTarget).toBe(4);
  });

  it('wires real coach resolver through heatmap / HR adherence / PI path', () => {
    const athlete = buildAthleteRecord({
      id: 'jordan-regression',
      name: 'Jordan Tillman',
      campLength: 7,
      currentWeekIndex: 1,
      maxHr: 197,
      restingHr: 64,
      missing: ['0:0', '1:0', '1:4'],
      missingProofs: [],
      avgs: {
        '0:1': 154,
        '0:2': 165,
        '0:3': 142,
        '0:4': 146,
        '1:1': 153,
        '1:2': 169,
        '1:3': 144,
      },
    });

    const heat = athlete.analytics.zoneHeatmap;
    expect(heat).toHaveLength(7);
    expected.forEach((row, index) => {
      expect(heat[index]).toMatchObject({
        label: row.label,
        avgBpm: row.avgBpm,
        bandLabel: row.bandLabel,
        headline: row.headline,
        onTarget: row.onTarget,
      });
    });
    expect(heat.some((cell) => /132–142|155–165|154–164/.test(cell.bandLabel || ''))).toBe(false);

    expect(athlete.analytics.hrAdherence.scored).toBe(7);
    expect(athlete.analytics.hrAdherence.onTarget).toBe(4);
    expect(athlete.scan.zone.scored).toBe(7);
    expect(athlete.scan.zone.onTarget).toBe(4);

    const card = buildLensCard(athlete, LENS_HR_ADHERENCE);
    expect(card.deltaLabel).toContain('4 / 7 eligible sessions within target range');
  });

  it('boundary edges for Target 145–155', () => {
    const zone = { target: 150, tolerance: 5, mode: 'flat' };
    expect(measureZoneMiss(145, zone).headline).toBe('IN ZONE');
    expect(measureZoneMiss(155, zone).headline).toBe('IN ZONE');
    expect(measureZoneMiss(144, zone).headline).toBe('1 bpm LOW');
    expect(measureZoneMiss(156, zone).headline).toBe('1 bpm HIGH');
  });
});

describe('persisted target_bpm preservation in live coach config', () => {
  it('keeps completion target_bpm on the coach session instead of PROGRAM 137', () => {
    const profile = {
      user_id: 'jordan-persist',
      athlete_name: 'Jordan Persist',
      camp_length: 7,
      fight_date: '2026-10-25',
    };
    const hrRow = { user_id: 'jordan-persist', max_hr: 197, resting_hr: 64 };
    const completions = [{
      user_id: 'jordan-persist',
      completion_key: '0:1',
      week_index: 0,
      workout_index: 1,
      workout_type: 'Benchmark Run + S&C',
      avg_bpm: 154,
      target_bpm: 150,
      completed_at: '2026-08-01T12:00:00.000Z',
      record_json: { workoutLog: { modality: 'running', distance: 3.0 } },
    }];
    const config = liveAthleteConfig(profile, hrRow, completions, [], [], '', 'jordan@example.com');
    expect(config.targets['0:1']).toBe(150);

    const athlete = buildAthleteRecord(config);
    const tuesday = athlete.sessions.find((row) => row.key === '0:1');
    expect(tuesday.targetBPM).toBe(150);
    expect(tuesday.persistedTargetBPM).toBe(150);
    expect(tuesday.targetBPM).not.toBe(137);
  });

  it('does not raise an HR flag against legacy 137 when personalized target is higher', () => {
    const profile = {
      user_id: 'jordan-flag',
      athlete_name: 'Jordan Flag',
      camp_length: 7,
      fight_date: '2026-10-25',
    };
    const hrRow = { user_id: 'jordan-flag', max_hr: 197, resting_hr: 64 };
    // 154 is > 137+10 but within personalized 150±5 — must not flag.
    const completions = [{
      user_id: 'jordan-flag',
      completion_key: '0:1',
      week_index: 0,
      workout_index: 1,
      workout_type: 'Benchmark Run + S&C',
      avg_bpm: 154,
      // No persisted target — must derive personalized 150, not program 137.
      completed_at: '2026-08-01T12:00:00.000Z',
      record_json: { workoutLog: { modality: 'running', distance: 3.0 } },
    }];
    const config = liveAthleteConfig(profile, hrRow, completions, [], [], '', 'jordan@example.com');
    expect(config.flags['0:1']).toBeUndefined();
  });
});

describe('missing HR non-regression with coach resolver', () => {
  it('excludes missing/invalid avg HR from coach scoring', () => {
    const sessions = [
      { status: 'logged', type: 'Easy Run', weekIndex: 0, workoutIndex: 3, avgBpm: 150 },
      { status: 'logged', type: 'Long Run', weekIndex: 0, workoutIndex: 4, avgBpm: null },
      { status: 'logged', type: 'Easy Run', weekIndex: 1, workoutIndex: 3, avgBpm: 0 },
      { status: 'logged', type: 'Long Run', weekIndex: 1, workoutIndex: 4, avgBpm: Number.NaN },
    ];
    const workoutLookup = (session) => programWorkout(session.weekIndex, session.workoutIndex);
    const scored = scoreCoachZoneAdherence(sessions, workoutLookup, jordanHr);
    expect(scored.scored).toBe(1);
    expect(scored.onTarget).toBe(1);

    const analytics = buildCoachAthleteAnalytics({
      id: 'missing-hr-coach',
      name: 'Missing HR Coach',
      maxHr: 197,
      restingHr: 64,
      scan: { recovery: {}, pace: {}, zone: {} },
      sessions,
    }, {
      getSessionZoneTarget: getCoachSessionZoneTarget,
      scoreZoneAdherence: scoreCoachZoneAdherence,
      workoutLookup,
    });
    expect(analytics.zoneHeatmap).toHaveLength(1);
    expect(analytics.hrAdherence.scored).toBe(1);
  });
});
