import { describe, expect, it, vi, beforeEach } from 'vitest';
import { evaluateSprintBleVerification } from '../src/sprint-ble-verification.js';
import { buildSessionRecord } from '../src/storage.js';
import {
  applyAutoRestCapture,
  isRestCaptureAtPrescribedCheckpoint,
  simulateRestTimerCaptureSequence,
} from '../src/sprint-rest-capture.js';

function freshBleSample(sequence = 12, windowStart = 5) {
  return {
    hr: 145,
    source: 'web-ble',
    capturedAt: Date.now(),
    sampleSequence: sequence,
    windowStartSequence: windowStart,
  };
}

function autoSprintCapture(index = 0) {
  return {
    mode: 'auto',
    source: 'web-ble',
    capturedAt: Date.now(),
    sampleSequence: 10 + index,
    windowStartSequence: 5,
  };
}

function buildW1Cfg() {
  return {
    reps: 5,
    rest: 90,
    maxHR: 190,
    targetPct: 0.85,
    workoutContext: {
      weekIndex: 0,
      workoutIndex: 0,
      workoutType: 'Sprint Intervals',
      sprintConfig: {
        reps: 5,
        restSeconds: 90,
        distanceMeters: 150,
        restCaptureSeconds: 60,
      },
    },
  };
}

function buildRepFromPending(pendingRep, index = 0) {
  return {
    sprintHR: 170,
    restHR: pendingRep.restHR,
    drop: 30,
    suspicious: false,
    sprintCapture: autoSprintCapture(index),
    restCapture: pendingRep.restCapture,
  };
}

describe('rest capture checkpoint timing', () => {
  it('accepts capture within prescribed tolerance (60–62 sec)', () => {
    expect(isRestCaptureAtPrescribedCheckpoint({
      captureAtRestSec: 60,
      targetRestCaptureSec: 60,
    }, 60)).toBe(true);
    expect(isRestCaptureAtPrescribedCheckpoint({
      captureAtRestSec: 62,
      targetRestCaptureSec: 60,
    }, 60)).toBe(true);
  });

  it('rejects late end-of-rest capture recorded at actual 90 seconds', () => {
    expect(isRestCaptureAtPrescribedCheckpoint({
      captureAtRestSec: 90,
      targetRestCaptureSec: 60,
    }, 60)).toBe(false);
  });
});

describe('simulateRestTimerCaptureSequence', () => {
  it('stores actual 90s elapsed when checkpoint misses and end-of-rest capture succeeds', () => {
    const { pendingRep } = simulateRestTimerCaptureSequence({
      captureFreshHRAt: (elapsed) => (elapsed === 90 ? freshBleSample(20, 10) : null),
    });

    expect(pendingRep.restHR).toBe(145);
    expect(pendingRep.restCapture.captureAtRestSec).toBe(90);
    expect(pendingRep.restCapture.targetRestCaptureSec).toBe(60);
  });

  it('fails BLE verification when checkpoint misses and end-of-rest capture succeeds', () => {
    const cfg = buildW1Cfg();
    const { pendingRep } = simulateRestTimerCaptureSequence({
      captureFreshHRAt: (elapsed) => (elapsed === 90 ? freshBleSample(20, 10) : null),
    });

    const data = Array.from({ length: 5 }, (_, index) => (
      index === 0 ? buildRepFromPending(pendingRep, index) : buildRepFromPending({
        restHR: 145,
        restCapture: {
          mode: 'auto',
          source: 'web-ble',
          capturedAt: Date.now(),
          sampleSequence: 20 + index,
          windowStartSequence: 10,
          captureAtRestSec: 60,
          targetRestCaptureSec: 60,
        },
      }, index)
    ));
    const record = buildSessionRecord(cfg, data);
    const verification = evaluateSprintBleVerification(record, cfg.workoutContext);
    expect(verification.bleVerified).toBe(false);
    expect(verification.reason).toMatch(/rest_checkpoint_mismatch/);
  });

  it('passes BLE verification when fresh sample lands at prescribed ~60 sec', () => {
    const cfg = buildW1Cfg();
    const { pendingRep } = simulateRestTimerCaptureSequence({
      captureFreshHRAt: (elapsed) => (elapsed === 60 ? freshBleSample(20, 10) : null),
    });

    const data = Array.from({ length: 5 }, (_, index) => buildRepFromPending(pendingRep, index));
    const record = buildSessionRecord(cfg, data);
    const verification = evaluateSprintBleVerification(record, cfg.workoutContext);
    expect(verification.bleVerified).toBe(true);
  });

  it('allows slightly delayed checkpoint capture at 61 seconds', () => {
    const pendingRep = { restHR: null, restCapture: null, needsManualRest: false };
    applyAutoRestCapture(pendingRep, freshBleSample(), 61, 60);
    expect(isRestCaptureAtPrescribedCheckpoint(pendingRep.restCapture, 60)).toBe(true);
  });
});

describe('autoCaptureRestHR timer path', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="chip-rest"></div>
    `;
  });

  it('records truthful elapsed timing through autoCaptureRestHR', async () => {
    vi.doMock('../src/hr-service.js', () => ({
      captureFreshHR: vi.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(freshBleSample(22, 11)),
      isHRConnected: vi.fn(() => true),
      beginCaptureWindow: vi.fn(),
      clearHRBufferForInterval: vi.fn(),
      hasFreshHRSample: vi.fn(() => true),
      hrState: { source: 'web-ble' },
    }));

    vi.doMock('../src/ui.js', () => ({
      showToast: vi.fn(),
      stopRestLogAlert: vi.fn(),
    }));

    const { autoCaptureRestHR, state } = await import('../src/app.js');
    state.pendingRep = {
      restHR: null,
      restCapture: null,
      needsManualRest: false,
    };

    autoCaptureRestHR(60, 60);
    expect(state.pendingRep.restHR).toBeNull();

    autoCaptureRestHR(90, 60);
    expect(state.pendingRep.restHR).toBe(145);
    expect(state.pendingRep.restCapture.captureAtRestSec).toBe(90);
    expect(state.pendingRep.restCapture.targetRestCaptureSec).toBe(60);
  });
});
