import { hrState } from './hr-service.js';

export function buildManualCaptureProvenance() {
  return {
    mode: 'manual',
    source: 'manual',
    capturedAt: Date.now(),
    sampleSequence: null,
    windowStartSequence: null,
  };
}

export function buildAutoCaptureProvenance(freshSample, options = {}) {
  if (!freshSample || freshSample.hr == null) return null;
  const provenance = {
    mode: 'auto',
    source: freshSample.source || hrState.source || 'web-ble',
    capturedAt: freshSample.capturedAt || freshSample.at || Date.now(),
    sampleSequence: freshSample.sampleSequence ?? null,
    windowStartSequence: freshSample.windowStartSequence ?? null,
  };
  if (Number.isFinite(options.captureAtRestSec)) {
    provenance.captureAtRestSec = options.captureAtRestSec;
  }
  if (Number.isFinite(options.targetRestCaptureSec)) {
    provenance.targetRestCaptureSec = options.targetRestCaptureSec;
  }
  return provenance;
}

export function cloneCaptureProvenance(capture) {
  if (!capture || typeof capture !== 'object') return null;
  return {
    mode: capture.mode,
    source: capture.source,
    capturedAt: capture.capturedAt ?? null,
    sampleSequence: capture.sampleSequence ?? null,
    windowStartSequence: capture.windowStartSequence ?? null,
    captureAtRestSec: capture.captureAtRestSec ?? null,
    targetRestCaptureSec: capture.targetRestCaptureSec ?? null,
  };
}
