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

export function isSessionAvgOnTarget(avgBpm, zoneTarget) {
  if (!zoneTarget) return false;
  const avg = Number(avgBpm);
  if (!Number.isFinite(avg) || avg <= 0) return false;
  return Math.abs(avg - zoneTarget.target) <= zoneTarget.tolerance;
}

export function scoreZoneAdherence(sessions, workoutLookup, hrInfo = {}) {
  let scored = 0;
  let onTarget = 0;
  sessions.forEach((session) => {
    if (session.status !== 'logged') return;
    if (/sprint|mile/i.test(String(session.type || ''))) return;
    const workout = workoutLookup(session);
    const zoneTarget = getSessionZoneTarget(session, workout, hrInfo);
    if (!zoneTarget) return;
    scored += 1;
    if (isSessionAvgOnTarget(session.avgBpm, zoneTarget)) onTarget += 1;
  });
  return { scored, onTarget };
}
