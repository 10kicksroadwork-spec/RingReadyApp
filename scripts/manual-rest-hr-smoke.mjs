/**
 * Smoke checks for manual recovery HR backup at the rest capture checkpoint.
 * Capture is at REST_CAPTURE_SEC into rest (60s), which is 30s left on a 90s rest.
 */
import assert from 'node:assert/strict';
import { getRestCaptureCopy, getRestDuration, validateRestHR } from '../src/workout.js';
import { REST_CAPTURE_SEC } from '../src/constants.js';

const totalRest = getRestDuration({ rest: 90 });
const restCaptureAt = Math.min(REST_CAPTURE_SEC, totalRest);
const secondsLeftAtCapture = totalRest - restCaptureAt;

assert.equal(totalRest, 90);
assert.equal(restCaptureAt, 60);
assert.equal(secondsLeftAtCapture, 30);
assert.equal(getRestCaptureCopy(totalRest, restCaptureAt, false), 'Rest HR captures at 30s left');
assert.equal(getRestCaptureCopy(totalRest, restCaptureAt, true), 'Rest HR captured -- recover');

assert.equal(validateRestHR('95').valid, true);
assert.equal(validateRestHR('95').value, 95);
assert.equal(validateRestHR('10').valid, false);
assert.equal(validateRestHR('').valid, false);

// When BLE is connected, missing capture should not require a modal (manual backup only).
function shouldOpenManualRestModal({ connected, restHR }) {
  if (restHR != null) return false;
  return !connected;
}

assert.equal(shouldOpenManualRestModal({ connected: false, restHR: null }), true);
assert.equal(shouldOpenManualRestModal({ connected: true, restHR: null }), false);
assert.equal(shouldOpenManualRestModal({ connected: false, restHR: 110 }), false);

console.log('manual-rest-hr-smoke: ok');
