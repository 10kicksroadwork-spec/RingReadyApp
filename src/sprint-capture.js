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

export function buildAutoCaptureProvenance(freshSample) {
  if (!freshSample || freshSample.hr == null) return null;
  return {
    mode: 'auto',
    source: freshSample.source || hrState.source || 'web-ble',
    capturedAt: freshSample.capturedAt || freshSample.at || Date.now(),
    sampleSequence: freshSample.sampleSequence ?? null,
    windowStartSequence: freshSample.windowStartSequence ?? null,
  };
}

export function cloneCaptureProvenance(capture) {
  if (!capture || typeof capture !== 'object') return null;
  return {
    mode: capture.mode,
    source: capture.source,
    capturedAt: capture.capturedAt ?? null,
    sampleSequence: capture.sampleSequence ?? null,
    windowStartSequence: capture.windowStartSequence ?? null,
  };
}
