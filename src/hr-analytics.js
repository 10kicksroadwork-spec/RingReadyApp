/** Shared HR analytics for athlete app and coach dashboard. */

export const SESSION_AVG_RANGE_BPM = 5;
export const HR_TARGET_TOLERANCE_BPM = 5;

export function calculateZoneBPM(zone, hrInfo = {}) {
  const maxHr = Number(hrInfo.maxHr) || 0;
  const restingHr = Number(hrInfo.restingHr) || 0;
  const reserve = Math.max(0, maxHr - restingHr);
  return Math.round((reserve * Number(zone.pct)) / 100 + restingHr);
}

export function getIntervalPlan(workout) {
  const plan = workout?.intervalPlan;
  if (!plan) return null;
  const reps = Number(plan.reps);
  const workMinutes = Number(plan.workMinutes);
  const restMinutes = Number(plan.restMinutes);
  if (![reps, workMinutes, restMinutes].every((value) => Number.isFinite(value) && value > 0)) return null;
  const workTotal = reps * workMinutes;
  const restTotal = Math.max(0, reps - 1) * restMinutes;
  return { reps, workMinutes, restMinutes, workTotal, restTotal, totalMinutes: workTotal + restTotal };
}

export function getWorkoutTargetBPM(workout, hrInfo = {}) {
  const pct = Number(workout?.targetPct);
  if (Number.isFinite(pct) && pct > 0) return calculateZoneBPM({ pct }, hrInfo);
  return Number(workout?.targetBPM) || null;
}

export function getZone2BPM(hrInfo = {}) {
  return calculateZoneBPM({ pct: 65 }, hrInfo);
}

export function getExpectedSessionAvgTarget(workout, hrInfo = {}) {
  const plan = getIntervalPlan(workout);
  const targetBPM = getWorkoutTargetBPM(workout, hrInfo);
  const easyBPM = getZone2BPM(hrInfo);
  if (!plan || !Number.isFinite(targetBPM) || plan.totalMinutes <= 0) return null;
  return Math.round(((plan.workTotal * targetBPM) + (plan.restTotal * easyBPM)) / plan.totalMinutes);
}

export function getSessionZoneTarget(session, workout, hrInfo = {}) {
  const type = String(session?.type || workout?.type || '');
  if (/threshold/i.test(type)) {
    const expectedAvg = getExpectedSessionAvgTarget(workout, hrInfo);
    if (Number.isFinite(expectedAvg)) {
      return { target: expectedAvg, tolerance: SESSION_AVG_RANGE_BPM, mode: 'session-avg' };
    }
  }
  const target = Number(session?.targetBPM ?? workout?.targetBPM);
  if (!Number.isFinite(target) || target <= 0) return null;
  return { target, tolerance: HR_TARGET_TOLERANCE_BPM, mode: 'flat' };
}

export function getZoneBand(zoneTarget) {
  if (!zoneTarget) return null;
  const target = Number(zoneTarget.target);
  const tolerance = Number(zoneTarget.tolerance);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(tolerance) || tolerance < 0) {
    return null;
  }
  return {
    target,
    tolerance,
    low: target - tolerance,
    high: target + tolerance,
  };
}

/**
 * Miss magnitude from the nearest acceptable HR band edge (not the midpoint).
 * Shares the same in-zone definition as isSessionAvgOnTarget / scoreZoneAdherence.
 */
export function measureZoneMiss(avgBpm, zoneTarget) {
  const band = getZoneBand(zoneTarget);
  const avg = Number(avgBpm);
  if (!band || !Number.isFinite(avg) || avg <= 0) {
    return {
      eligible: false,
      onTarget: false,
      missBpm: null,
      direction: null,
      headline: null,
      bandLow: band?.low ?? null,
      bandHigh: band?.high ?? null,
      avgBpm: Number.isFinite(avg) && avg > 0 ? avg : null,
      bandLabel: null,
    };
  }

  const bandLabel = `Target ${band.low}–${band.high}`;
  // Inclusive edges: exact boundary is in-zone / 0 miss.
  if (avg >= band.low && avg <= band.high) {
    return {
      eligible: true,
      onTarget: true,
      missBpm: 0,
      direction: null,
      headline: 'IN ZONE',
      bandLow: band.low,
      bandHigh: band.high,
      avgBpm: avg,
      bandLabel,
    };
  }

  if (avg > band.high) {
    const missBpm = Number((avg - band.high).toFixed(1));
    return {
      eligible: true,
      onTarget: false,
      missBpm,
      direction: 'high',
      headline: `${Math.round(missBpm)} bpm HIGH`,
      bandLow: band.low,
      bandHigh: band.high,
      avgBpm: avg,
      bandLabel,
    };
  }

  const missBpm = Number((band.low - avg).toFixed(1));
  return {
    eligible: true,
    onTarget: false,
    missBpm,
    direction: 'low',
    headline: `${Math.round(missBpm)} bpm LOW`,
    bandLow: band.low,
    bandHigh: band.high,
    avgBpm: avg,
    bandLabel,
  };
}

export function isSessionAvgOnTarget(avgBpm, zoneTarget) {
  return measureZoneMiss(avgBpm, zoneTarget).onTarget === true;
}

export function summarizeZoneMisses(measurements = []) {
  const misses = (Array.isArray(measurements) ? measurements : [])
    .filter((row) => row?.eligible && row.onTarget === false)
    .filter((row) => Number.isFinite(Number(row.missBpm)) && Number(row.missBpm) > 0);
  if (!misses.length) {
    return {
      missCount: 0,
      avgMissBpm: null,
      worstMissBpm: null,
      worstDirection: null,
      summaryLabel: null,
    };
  }

  const avgMissBpm = misses.reduce((sum, row) => sum + Number(row.missBpm), 0) / misses.length;
  let worst = misses[0];
  misses.forEach((row) => {
    if (Number(row.missBpm) > Number(worst.missBpm)) worst = row;
  });
  const worstDirection = worst.direction === 'low' ? 'low' : 'high';
  const worstLabel = worstDirection === 'low' ? 'LOW' : 'HIGH';
  return {
    missCount: misses.length,
    avgMissBpm: Number(avgMissBpm.toFixed(1)),
    worstMissBpm: Number(Number(worst.missBpm).toFixed(1)),
    worstDirection,
    summaryLabel: `Avg miss: ${Math.round(avgMissBpm)} bpm · Worst miss: ${Math.round(Number(worst.missBpm))} bpm ${worstLabel}`,
  };
}

export function scoreZoneAdherence(sessions, workoutLookup, hrInfo = {}) {
  let scored = 0;
  let onTarget = 0;
  const measurements = [];
  sessions.forEach((session) => {
    if (session.status !== 'logged') return;
    if (/sprint|mile/i.test(String(session.type || ''))) return;
    const workout = workoutLookup(session);
    const zoneTarget = getSessionZoneTarget(session, workout, hrInfo);
    if (!zoneTarget) return;
    scored += 1;
    const measurement = measureZoneMiss(session.avgBpm, zoneTarget);
    measurements.push(measurement);
    if (measurement.onTarget) onTarget += 1;
  });
  return {
    scored,
    onTarget,
    measurements,
    ...summarizeZoneMisses(measurements),
  };
}
