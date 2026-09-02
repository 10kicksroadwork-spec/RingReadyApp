import { describe, expect, it } from 'vitest';
import { evaluateSprintBleVerification } from '../src/sprint-ble-verification.js';
import { buildSessionRecord, saveSessionToHistory } from '../src/storage.js';

function autoCapture(sampleSequence = 12, windowStartSequence = 5, captureAtRestSec = 60) {
  return {
    mode: 'auto',
    source: 'web-ble',
    capturedAt: Date.now(),
    sampleSequence,
    windowStartSequence,
    captureAtRestSec,
    targetRestCaptureSec: 60,
  };
}

function buildTimerStyleSessionData(reps = 5) {
  return Array.from({ length: reps }, (_, index) => ({
    sprintHR: 170 + index,
    restHR: 140 + index,
    drop: 30,
    suspicious: false,
    sprintCapture: autoCapture(10 + index, 5),
    restCapture: autoCapture(20 + index, 10, 60),
  }));
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

describe('sprint storage → verification integration', () => {
  it('preserves BLE capture provenance through buildSessionRecord', () => {
    const cfg = buildW1Cfg();
    const data = buildTimerStyleSessionData(5);
    const record = buildSessionRecord(cfg, data);

    expect(record.data).toHaveLength(5);
    expect(record.data[0].sprintCapture).toEqual(data[0].sprintCapture);
    expect(record.data[0].restCapture).toEqual(data[0].restCapture);
    expect(record.data[4].restCapture.captureAtRestSec).toBe(60);
  });

  it('preserves BLE capture provenance through saveSessionToHistory', () => {
    const cfg = buildW1Cfg();
    const data = buildTimerStyleSessionData(5);
    const record = saveSessionToHistory(cfg, data);

    expect(record.data[2].sprintCapture.sampleSequence).toBe(12);
    expect(record.data[2].restCapture.windowStartSequence).toBe(10);
    expect(record.data[2].restCapture.captureAtRestSec).toBe(60);
  });

  it('evaluates bleVerified true after storage round-trip for full W1 BLE session', () => {
    const cfg = buildW1Cfg();
    const data = buildTimerStyleSessionData(5);
    const record = saveSessionToHistory(cfg, data);
    const verification = evaluateSprintBleVerification(record, cfg.workoutContext);

    expect(verification).toEqual({
      bleVerified: true,
      reason: 'ble_verified',
    });
  });

  it('evaluates bleVerified false when storage strips provenance (regression guard)', () => {
    const cfg = buildW1Cfg();
    const strippedData = buildTimerStyleSessionData(5).map(({ sprintHR, restHR, drop, suspicious }) => ({
      sprintHR,
      restHR,
      drop,
      suspicious,
    }));
    const record = buildSessionRecord(cfg, strippedData);
    const verification = evaluateSprintBleVerification(record, cfg.workoutContext);

    expect(verification.bleVerified).toBe(false);
  });
});
