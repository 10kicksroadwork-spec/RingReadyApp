import { REST_CAPTURE_SEC } from './constants.js';
import { buildAutoCaptureProvenance } from './sprint-capture.js';

export const REST_CAPTURE_TOLERANCE_SEC = 2;

export function restCaptureTimingOptions(actualElapsedSec, targetRestCaptureSec = REST_CAPTURE_SEC) {
  const actual = Number(actualElapsedSec);
  const target = Number(targetRestCaptureSec);
  return {
    captureAtRestSec: Number.isFinite(actual) ? Math.max(0, Math.trunc(actual)) : null,
    targetRestCaptureSec: Number.isFinite(target) ? Math.max(0, Math.trunc(target)) : REST_CAPTURE_SEC,
  };
}

export function isRestCaptureAtPrescribedCheckpoint(
  capture,
  targetSeconds,
  toleranceSec = REST_CAPTURE_TOLERANCE_SEC,
) {
  if (!capture || typeof capture !== 'object') return false;
  const actual = Number(capture.captureAtRestSec);
  const target = Number(capture.targetRestCaptureSec ?? targetSeconds);
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return false;
  const tolerance = Number.isFinite(toleranceSec) ? Math.max(0, toleranceSec) : REST_CAPTURE_TOLERANCE_SEC;
  return actual >= target && actual <= target + tolerance;
}

export function applyAutoRestCapture(
  pendingRep,
  freshRest,
  actualElapsedSec,
  targetRestCaptureSec = REST_CAPTURE_SEC,
) {
  if (!pendingRep || freshRest?.hr == null) return false;
  pendingRep.restHR = freshRest.hr;
  pendingRep.needsManualRest = false;
  pendingRep.restCapture = buildAutoCaptureProvenance(
    freshRest,
    restCaptureTimingOptions(actualElapsedSec, targetRestCaptureSec),
  );
  return true;
}

/**
 * Mirrors runAutoRestCountdown checkpoint + end-of-rest capture branches for tests.
 */
export function simulateRestTimerCaptureSequence({
  targetRestCaptureSec = REST_CAPTURE_SEC,
  totalRestSec = 90,
  captureFreshHRAt,
  isHRConnected = true,
}) {
  const pendingRep = {
    restHR: null,
    restCapture: null,
    needsManualRest: false,
  };
  let captureAttempted = false;

  captureAttempted = true;
  const checkpointSample = captureFreshHRAt(targetRestCaptureSec);
  if (checkpointSample?.hr != null) {
    applyAutoRestCapture(
      pendingRep,
      checkpointSample,
      targetRestCaptureSec,
      targetRestCaptureSec,
    );
  } else if (!isHRConnected) {
    pendingRep.needsManualRest = true;
  }

  if (pendingRep.restHR === null) {
    const endSample = captureFreshHRAt(totalRestSec);
    if (endSample?.hr != null) {
      applyAutoRestCapture(
        pendingRep,
        endSample,
        totalRestSec,
        targetRestCaptureSec,
      );
    }
  }

  return { pendingRep, captureAttempted };
}
