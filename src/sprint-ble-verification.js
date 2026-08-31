import { isValidSprintPrescription, resolveSprintPrescription } from './sprint-prescription.js';

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
  return {
    mode,
    source,
    capturedAt: Number.isFinite(capturedAt) ? capturedAt : null,
    sampleSequence: Number.isFinite(sampleSequence) ? sampleSequence : null,
    windowStartSequence: Number.isFinite(windowStartSequence) ? windowStartSequence : null,
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
  const sources = new Set();
  (Array.isArray(reps) ? reps : []).forEach((rep) => {
    [rep?.sprintCapture, rep?.restCapture].forEach((capture) => {
      const normalized = normalizeCaptureProvenance(capture);
      if (normalized?.mode === 'auto' && isBleTransportSource(normalized.source)) {
        sources.add(normalized.source);
      }
    });
  });
  if (sources.size === 1) return [...sources][0];
  if (sources.size > 1) return 'mixed-ble';
  return 'manual';
}

export function isBleVerifiedSprintRow(sprintRow, recordJson = null) {
  if (!sprintRow) return false;
  if (sprintRow.ble_verified === true) return true;
  const record = recordJson
    || (sprintRow.session_json && typeof sprintRow.session_json === 'object' ? sprintRow.session_json : null);
  return record?.bleVerified === true;
}

export function evaluateSprintBleVerification(record, workoutContext = null) {
  const context = workoutContext
    || record?.cfg?.workoutContext
    || record?.workoutContext
    || null;

  if (!isValidSprintPrescription(context)) {
    return { bleVerified: false, reason: 'invalid_prescription' };
  }

  const prescription = resolveSprintPrescription(context);
  const prescribedReps = Number(prescription?.reps);
  const data = Array.isArray(record?.data) ? record.data : [];

  if (!Number.isFinite(prescribedReps) || prescribedReps <= 0) {
    return { bleVerified: false, reason: 'invalid_prescription' };
  }

  if (data.length !== prescribedReps) {
    return { bleVerified: false, reason: 'incomplete_session' };
  }

  for (let i = 0; i < data.length; i += 1) {
    const rep = data[i];
    const sprintHR = Number(rep?.sprintHR);
    const restHR = Number(rep?.restHR);

    if (!Number.isFinite(sprintHR) || sprintHR <= 0) {
      return { bleVerified: false, reason: `missing_sprint_hr_rep_${i + 1}` };
    }
    if (!Number.isFinite(restHR) || restHR <= 0) {
      return { bleVerified: false, reason: `missing_rest_hr_rep_${i + 1}` };
    }

    if (!isFreshAutoBleCapture(rep?.sprintCapture)) {
      return { bleVerified: false, reason: `sprint_capture_not_verified_rep_${i + 1}` };
    }
    if (!isFreshAutoBleCapture(rep?.restCapture)) {
      return { bleVerified: false, reason: `rest_capture_not_verified_rep_${i + 1}` };
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
    const record = row?.record_json && typeof row.record_json === 'object'
      ? row.record_json
      : (sprintRow.session_json && typeof sprintRow.session_json === 'object' ? sprintRow.session_json : null);

    if (isBleVerifiedSprintRow(sprintRow, record)) return 'ble';

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
