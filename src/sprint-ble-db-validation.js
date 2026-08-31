/**
 * JS mirror of public.validate_sprint_ble_verification_row for unit tests.
 * Keep in sync with scripts/migrations/010_sprint_ble_verification.sql.
 */

import { getCanonicalSprintPrescription } from './program-sprint-prescriptions.js';
import { isRestCaptureAtPrescribedCheckpoint, REST_CAPTURE_TOLERANCE_SEC } from './sprint-rest-capture.js';

const BLE_SOURCES = new Set(['web-ble', 'native-ble']);

function parseIntSafe(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function isValidAutoBleCapture(capture) {
  if (!capture || typeof capture !== 'object') return false;
  if (capture.mode !== 'auto' || !BLE_SOURCES.has(capture.source)) return false;
  const seq = parseIntSafe(capture.sampleSequence);
  const windowSeq = parseIntSafe(capture.windowStartSequence);
  if (seq === null || windowSeq === null || seq <= windowSeq) return false;
  return true;
}

export function validateSprintBleVerificationRow({
  weekIndex,
  workoutIndex,
  intervalsCompleted,
  repsPlanned,
  restSeconds,
  sessionJson,
}) {
  try {
    const canonical = getCanonicalSprintPrescription(weekIndex, workoutIndex);
    if (!canonical) return false;

    if (
      intervalsCompleted !== canonical.reps
      || repsPlanned !== canonical.reps
      || restSeconds !== canonical.restSeconds
    ) {
      return false;
    }

    const data = sessionJson?.data;
    if (!Array.isArray(data) || data.length !== canonical.reps) return false;

    for (let i = 0; i < data.length; i += 1) {
      const rep = data[i];
      if (!rep || typeof rep !== 'object') return false;

      const sprintHR = parseIntSafe(rep.sprintHR);
      const restHR = parseIntSafe(rep.restHR);
      if (sprintHR === null || sprintHR < 60 || sprintHR > 230) return false;
      if (restHR === null || restHR < 40 || restHR > 229) return false;

      if (!isValidAutoBleCapture(rep.sprintCapture)) return false;

      const restCapture = rep.restCapture;
      if (!isValidAutoBleCapture(restCapture)) return false;

      if (!isRestCaptureAtPrescribedCheckpoint(
        restCapture,
        canonical.restCaptureSeconds,
        REST_CAPTURE_TOLERANCE_SEC,
      )) return false;
    }

    return true;
  } catch {
    return false;
  }
}
