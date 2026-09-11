/**
 * Coach-only HR target resolution.
 * Athlete-facing helpers in hr-analytics.js / shell.js are intentionally untouched.
 *
 * Target authority:
 *   1. Persisted completion target BPM (workout_completions.target_bpm)
 *   2. Personalized HRR calculation from athlete max/rest + prescribed % midpoint
 *   3. Legacy program workout.targetBPM (compatibility fallback only)
 */

import {
  calculateZoneBPM,
  getIntervalPlan,
  HR_TARGET_TOLERANCE_BPM,
  measureZoneMiss,
  SESSION_AVG_RANGE_BPM,
  summarizeZoneMisses,
} from './hr-analytics.js';

const ZONE2_PCT = 65;
const LEGACY_ZONE2_BPM = 137;

/**
 * Midpoint of the prescribed target percentage range.
 * Priority: explicit numeric targetPct → parse targetZone → null.
 */
export function parseCoachTargetPct(workout, session) {
  const explicit = Number(workout?.targetPct ?? session?.targetPct);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const zone = String(workout?.targetZone || session?.targetZone || '');
  const matches = zone.match(/\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const values = matches.map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function hasUsableCoachHrProfile(hrInfo = {}) {
  const maxHr = Number(hrInfo.maxHr);
  const restingHr = Number(hrInfo.restingHr);
  return Number.isFinite(maxHr)
    && Number.isFinite(restingHr)
    && maxHr > 0
    && restingHr > 0
    && maxHr > restingHr;
}

/**
 * Resolve the coach work/prescription HR target (not the Threshold session-average band).
 */
export function getCoachPersonalizedTargetBpm(workout, session = {}, hrInfo = {}) {
  // 1. Persisted completion target — never confuse with a program-constant copy.
  const persisted = Number(
    session?.persistedTargetBPM
    ?? session?.persistedTargetBpm
    ?? session?.completionTargetBpm
  );
  if (Number.isFinite(persisted) && persisted > 0) {
    return Math.round(persisted);
  }

  // 2. Personalized from athlete HR profile + prescribed % midpoint.
  const pct = parseCoachTargetPct(workout, session);
  if (Number.isFinite(pct) && pct > 0 && hasUsableCoachHrProfile(hrInfo)) {
    return calculateZoneBPM({ pct }, hrInfo);
  }

  // 3. Legacy program / session fallback.
  const legacy = Number(workout?.targetBPM ?? session?.targetBPM ?? session?.targetBpm);
  if (Number.isFinite(legacy) && legacy > 0) {
    return Math.round(legacy);
  }
  return null;
}

function resolveCoachEasyRecoveryBpm(hrInfo = {}) {
  if (hasUsableCoachHrProfile(hrInfo)) {
    const easy = calculateZoneBPM({ pct: ZONE2_PCT }, hrInfo);
    if (Number.isFinite(easy) && easy > 0) return easy;
  }
  return LEGACY_ZONE2_BPM;
}

function expectedThresholdSessionAvg(workTarget, easyTarget, plan) {
  if (!plan || plan.totalMinutes <= 0) return null;
  if (!Number.isFinite(workTarget) || workTarget <= 0) return null;
  if (!Number.isFinite(easyTarget) || easyTarget <= 0) return null;
  return Math.round(
    ((plan.workTotal * workTarget) + (plan.restTotal * easyTarget)) / plan.totalMinutes
  );
}

/**
 * Canonical coach-side zone target for adherence scoring / heatmap / trends.
 * Threshold keeps weighted session-average methodology; only the work target is corrected.
 */
export function getCoachSessionZoneTarget(session, workout, hrInfo = {}) {
  const type = String(session?.type || workout?.type || '');
  const workTarget = getCoachPersonalizedTargetBpm(workout, session, hrInfo);

  if (/threshold/i.test(type)) {
    const plan = getIntervalPlan(workout);
    if (plan && Number.isFinite(workTarget)) {
      const easyTarget = resolveCoachEasyRecoveryBpm(hrInfo);
      const expected = expectedThresholdSessionAvg(workTarget, easyTarget, plan);
      if (Number.isFinite(expected)) {
        return {
          target: expected,
          tolerance: SESSION_AVG_RANGE_BPM,
          mode: 'session-avg',
        };
      }
    }
  }

  if (!Number.isFinite(workTarget) || workTarget <= 0) return null;
  return {
    target: workTarget,
    tolerance: HR_TARGET_TOLERANCE_BPM,
    mode: 'flat',
  };
}

/**
 * Coach-only scorer — same eligibility rules as scoreZoneAdherence, but uses
 * getCoachSessionZoneTarget so legacy program BPMs are not treated as personalized truth.
 */
export function scoreCoachZoneAdherence(sessions, workoutLookup, hrInfo = {}) {
  let scored = 0;
  let onTarget = 0;
  const measurements = [];
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    if (session.status !== 'logged') return;
    if (/sprint|mile/i.test(String(session.type || ''))) return;
    const workout = typeof workoutLookup === 'function' ? workoutLookup(session) : null;
    const zoneTarget = getCoachSessionZoneTarget(session, workout, hrInfo);
    if (!zoneTarget) return;
    const measurement = measureZoneMiss(session.avgBpm, zoneTarget);
    if (!measurement.eligible) return;
    scored += 1;
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
