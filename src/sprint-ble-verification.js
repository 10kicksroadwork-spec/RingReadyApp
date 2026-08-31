import { getCanonicalSprintPrescription } from './program-sprint-prescriptions.js';
import {
  isRestCaptureAtPrescribedCheckpoint,
  REST_CAPTURE_TOLERANCE_SEC,
} from './sprint-rest-capture.js';

const BLE_SOURCES = new Set(['web-ble', 'native-ble']);

export function isBleTransportSource(source) {
  return BLE_SOURCES.has(String(source || '').trim());
}

export function normalizeCaptureProvenance(capture) {
  if (!capture || typeof capture !== 'object') return null;
  const mode = String(capture.mode || '').trim();
  if (mode !== 'auto' && mode !== 'manual') return null;
  const source = String(capture.source || (mode === 'manual' ? 'manual' : '')).trim();
  const capturedAt = Number(capture.capturedAt);
  const sampleSequence = capture.sampleSequence == null ? null : Number(capture.sampleSequence);
  const windowStartSequence = capture.windowStartSequence == null
    ? null
    : Number(capture.windowStartSequence);
  const captureAtRestSec = capture.captureAtRestSec == null
    ? null
    : Number(capture.captureAtRestSec);
  const targetRestCaptureSec = capture.targetRestCaptureSec == null
    ? null
    : Number(capture.targetRestCaptureSec);
  return {
    mode,
    source,
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : null,
    sampleSequence: Number.isFinite(sampleSequence) ? sampleSequence : null,
    windowStartSequence: Number.isFinite(windowStartSequence) ? windowStartSequence : null,
    captureAtRestSec: Number.isFinite(captureAtRestSec) ? captureAtRestSec : null,
    targetRestCaptureSec: Number.isFinite(targetRestCaptureSec) ? targetRestCaptureSec : null,
  };
}

export function isFreshAutoBleCapture(capture) {
  const normalized = normalizeCaptureProvenance(capture);
  if (!normalized || normalized.mode !== 'auto') return false;
  if (!isBleTransportSource(normalized.source)) return false;
  if (!Number.isFinite(normalized.capturedAt) || normalized.capturedAt <= 0) return false;
  if (!Number.isFinite(normalized.sampleSequence) || normalized.sampleSequence <= 0) return false;
  if (!Number.isFinite(normalized.windowStartSequence)) return false;
  return normalized.sampleSequence > normalized.windowStartSequence;
}

export function deriveSessionHrSource(reps = []) {
  const autoBleSources = new Set();
  let hasManual = false;

  (Array.isArray(reps) ? reps : []).forEach((rep) => {
    [rep?.sprintCapture, rep?.restCapture].forEach((capture) => {
      const normalized = normalizeCaptureProvenance(capture);
      if (!normalized) return;
      if (normalized.mode === 'manual') {
        hasManual = true;
        return;
      }
      if (normalized.mode === 'auto' && isBleTransportSource(normalized.source)) {
        autoBleSources.add(normalized.source);
      }
    });
  });

  if (hasManual) {
    return autoBleSources.size > 0 ? 'mixed' : 'manual';
  }
  if (autoBleSources.size === 1) return [...autoBleSources][0];
  if (autoBleSources.size > 1) return 'mixed-ble';
  return 'manual';
}

export function isBleVerifiedSprintRow(sprintRow) {
  return sprintRow?.ble_verified === true;
}

export function evaluateSprintBleVerification(record, workoutContext = null) {
  const context = workoutContext
    || record?.cfg?.workoutContext
    || record?.workoutContext
    || null;

  if (!context) {
    return { bleVerified: false, reason: 'invalid_prescription' };
  }

  const canonical = getCanonicalSprintPrescription(context.weekIndex, context.workoutIndex);
  if (!canonical) {
    return { bleVerified: false, reason: 'invalid_prescription' };
  }

  const prescribedReps = canonical.reps;
  const restCaptureSeconds = canonical.restCaptureSeconds;
  const data = Array.isArray(record?.data) ? record.data : [];

  if (data.length !== prescribedReps) {
    return { bleVerified: false, reason: 'incomplete_session' };
  }

  const cfgRest = Number(record?.cfg?.rest);
  if (Number.isFinite(cfgRest) && cfgRest !== canonical.restSeconds) {
    return { bleVerified: false, reason: 'rest_mismatch' };
  }

  for (let i = 0; i < data.length; i += 1) {
    const rep = data[i];
    const sprintHR = Number(rep?.sprintHR);
    const restHR = Number(rep?.restHR);

    if (!Number.isFinite(sprintHR) || sprintHR < 60 || sprintHR > 230) {
      return { bleVerified: false, reason: `missing_sprint_hr_rep_${i + 1}` };
    }
    if (!Number.isFinite(restHR) || restHR < 40 || restHR > 229) {
      return { bleVerified: false, reason: `missing_rest_hr_rep_${i + 1}` };
    }

    if (!isFreshAutoBleCapture(rep?.sprintCapture)) {
      return { bleVerified: false, reason: `sprint_capture_not_verified_rep_${i + 1}` };
    }

    const restCapture = normalizeCaptureProvenance(rep?.restCapture);
    if (!isFreshAutoBleCapture(restCapture)) {
      return { bleVerified: false, reason: `rest_capture_not_verified_rep_${i + 1}` };
    }
    if (!isRestCaptureAtPrescribedCheckpoint(
      restCapture,
      restCaptureSeconds,
      REST_CAPTURE_TOLERANCE_SEC,
    )) {
      return { bleVerified: false, reason: `rest_checkpoint_mismatch_rep_${i + 1}` };
    }
  }

  return { bleVerified: true, reason: 'ble_verified' };
}

export function resolveVerificationMethod({
  row,
  sprintRow,
  attachments = [],
  isSprint = false,
  weekIndex,
  workoutIndex,
  findAttachment = null,
} = {}) {
  const hasAttachment = row?.attachment_id || sprintRow?.attachment_id;
  if (hasAttachment) return 'attachment';

  if (isSprint && sprintRow) {
    if (isBleVerifiedSprintRow(sprintRow)) return 'ble';

    if (findAttachment) {
      const attachment = findAttachment(attachments, sprintRow, weekIndex, workoutIndex);
      if (attachment) return 'attachment';
    }
  }

  const record = row?.record_json && typeof row.record_json === 'object' ? row.record_json : {};
  if (!row?.proof_policy_version && record?.completedAt && !record?.proofPolicyVersion) {
    return 'legacy';
  }

  if (!isSprint) {
    if (hasAttachment) return 'attachment';
    if (!row?.proof_policy_version && record?.completedAt) return 'legacy';
  }

  return 'missing';
}

export function sessionIsVerified(options = {}) {
  return resolveVerificationMethod(options) !== 'missing';
}
