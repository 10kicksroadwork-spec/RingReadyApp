import { describe, expect, it } from 'vitest';
import {
  mergeHRByTimestamp,
  mergeProfileByTimestamp,
} from '../src/shell-cloud-merge.js';
import {
  getExpectedSessionAvgTarget,
  isSessionAvgOnTarget,
  getSessionZoneTarget,
} from '../src/hr-analytics.js';

describe('mergeProfileByTimestamp', () => {
  it('prefers newer local profile', () => {
    const local = { athleteName: 'Local', updatedAt: '2026-08-02T00:00:00.000Z' };
    const cloud = { athleteName: 'Cloud', updatedAt: '2026-08-01T00:00:00.000Z' };
    expect(mergeProfileByTimestamp(local, cloud).athleteName).toBe('Local');
  });

  it('prefers newer cloud profile', () => {
    const local = { athleteName: 'Local', updatedAt: '2026-08-01T00:00:00.000Z' };
    const cloud = { athleteName: 'Cloud', updatedAt: '2026-08-02T00:00:00.000Z' };
    expect(mergeProfileByTimestamp(local, cloud).athleteName).toBe('Cloud');
  });
});

describe('mergeHRByTimestamp', () => {
  it('prefers newer local HR', () => {
    const local = { maxHr: 190, updatedAt: '2026-08-02T00:00:00.000Z' };
    const cloud = { maxHr: 180, updatedAt: '2026-08-01T00:00:00.000Z' };
    expect(mergeHRByTimestamp(local, cloud, {}).maxHr).toBe(190);
  });
});

describe('threshold HR analytics', () => {
  const workout = {
    type: 'Threshold',
    targetBPM: 163,
    targetPct: 85,
    intervalPlan: { reps: 3, workMinutes: 4, restMinutes: 2 },
  };
  const hrInfo = { maxHr: 190, restingHr: 60 };

  it('computes interval-weighted expected average', () => {
    const expected = getExpectedSessionAvgTarget(workout, hrInfo);
    expect(expected).toBeGreaterThan(100);
    expect(expected).toBeLessThan(190);
  });

  it('scores threshold session against expected average', () => {
    const expected = getExpectedSessionAvgTarget(workout, hrInfo);
    const session = { type: 'Threshold', avgBpm: expected, targetBPM: 163, weekIndex: 0, workoutIndex: 2 };
    const zoneTarget = getSessionZoneTarget(session, workout, hrInfo);
    expect(isSessionAvgOnTarget(expected, zoneTarget)).toBe(true);
  });
});
