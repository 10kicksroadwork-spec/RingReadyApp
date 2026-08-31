/** Structured Sprint prescription helpers — program is the source of truth. */

export function isValidSprintPrescription(context) {
  if (!context || typeof context !== 'object') return false;

  const weekIndex = Number(context.weekIndex);
  const workoutIndex = Number(context.workoutIndex);
  if (!Number.isFinite(weekIndex) || weekIndex < 0) return false;
  if (!Number.isFinite(workoutIndex) || workoutIndex < 0) return false;

  const config = context.sprintConfig;
  if (!config || typeof config !== 'object') return false;

  const reps = Number(config.reps);
  const restSeconds = Number(config.restSeconds);
  if (!Number.isFinite(reps) || reps <= 0) return false;
  if (!Number.isFinite(restSeconds) || restSeconds <= 0) return false;

  return true;
}

export function resolveSprintPrescription(context) {
  if (!isValidSprintPrescription(context)) return null;

  const config = context.sprintConfig;
  const distanceMeters = Number(config.distanceMeters);
  const restCaptureSeconds = Number(config.restCaptureSeconds);

  return {
    reps: Number(config.reps),
    restSeconds: Number(config.restSeconds),
    distanceMeters: Number.isFinite(distanceMeters) && distanceMeters > 0 ? distanceMeters : 150,
    restCaptureSeconds: Number.isFinite(restCaptureSeconds) && restCaptureSeconds > 0
      ? restCaptureSeconds
      : 60,
    weekIndex: Number(context.weekIndex),
    workoutIndex: Number(context.workoutIndex),
    weekLabel: String(context.weekLabel || '').trim(),
    weekTitle: String(context.weekTitle || '').trim(),
  };
}

export function applySprintPrescriptionToCfg(cfg, context) {
  const prescription = resolveSprintPrescription(context);
  if (!prescription) {
    cfg.reps = null;
    cfg.rest = null;
    return false;
  }

  cfg.reps = prescription.reps;
  cfg.rest = prescription.restSeconds;
  return true;
}

export function hasLoadedSprintPrescription(cfg) {
  const reps = Number(cfg?.reps);
  const rest = Number(cfg?.rest);
  return Number.isFinite(reps) && reps > 0 && Number.isFinite(rest) && rest > 0;
}

export function formatSprintPrescriptionMain(prescription) {
  if (!prescription) return '—';
  return `${prescription.reps} × ${prescription.distanceMeters}m`;
}

export function formatSprintPrescriptionRest(prescription) {
  if (!prescription) return '—';
  return `${prescription.restSeconds} sec recovery`;
}

export function formatSprintPrescriptionHrCapture(prescription) {
  if (!prescription) return '—';
  return `HR recorded after ${prescription.restCaptureSeconds} sec recovery`;
}

export function formatSprintPrescriptionWeek(prescription) {
  if (!prescription) return '—';
  if (prescription.weekLabel && prescription.weekTitle) {
    return `${prescription.weekLabel} · ${prescription.weekTitle}`;
  }
  return prescription.weekLabel || prescription.weekTitle || '—';
}

export function sessionCompletesAtRep(currentRep, cfg) {
  const reps = Number(cfg?.reps);
  if (!Number.isFinite(reps) || reps <= 0) return false;
  return Number(currentRep) >= reps;
}
