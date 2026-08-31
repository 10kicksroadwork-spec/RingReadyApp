import { describe, expect, it } from 'vitest';
import {
  deriveSessionHrSource,
  evaluateSprintBleVerification,
  isBleVerifiedSprintRow,
  isFreshAutoBleCapture,
  resolveVerificationMethod,
} from '../src/sprint-ble-verification.js';

function autoCapture(sampleSequence = 12, windowStartSequence = 5, captureAtRestSec = 60) {
  const capture = {
    mode: 'auto',
    source: 'web-ble',
    capturedAt: Date.now(),
    sampleSequence,
    windowStartSequence,
  };
  if (captureAtRestSec != null) {
    capture.captureAtRestSec = captureAtRestSec;
  }
  return capture;
}

function manualCapture() {
  return {
    mode: 'manual',
    source: 'manual',
    capturedAt: Date.now(),
    sampleSequence: null,
    windowStartSequence: null,
  };
}

function buildSprintRecord(weekIndex, prescribedReps, overrides = {}) {
  const workoutContext = {
    weekIndex,
    workoutIndex: 0,
    sprintConfig: {
      reps: overrides.clientReps ?? prescribedReps,
      restSeconds: 90,
      distanceMeters: 150,
      restCaptureSeconds: 60,
    },
  };

  const data = Array.from({ length: overrides.completedReps ?? prescribedReps }, (_, index) => {
    const sprintCapture = overrides.manualSprintRep === index
      ? manualCapture()
      : (overrides.staleSprintRep === index
        ? { ...autoCapture(4, 4), sampleSequence: 4, windowStartSequence: 4 }
        : autoCapture(10 + index, 5));
    const restCapture = overrides.manualRestRep === index
      ? manualCapture()
      : (overrides.missingRestRep === index
        ? null
        : autoCapture(
          20 + index,
          10,
          overrides.lateRestRep === index ? 90 : 60,
        ));

    return {
      sprintHR: 165,
      restHR: overrides.missingRestRep === index ? null : 145,
      drop: 20,
      suspicious: overrides.suspiciousRep === index,
      sprintCapture,
      restCapture,
    };
  });

  return {
    cfg: {
      workoutContext,
      reps: overrides.timerReps ?? prescribedReps,
      rest: 90,
    },
    data,
  };
}

describe('sprint BLE verification', () => {
  it('accepts a full prescribed session with fresh auto BLE captures', () => {
    const record = buildSprintRecord(0, 5);
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext)).toEqual({
      bleVerified: true,
      reason: 'ble_verified',
    });
  });

  it('rejects when completed reps do not match canonical prescription', () => {
    const record = buildSprintRecord(4, 10, { completedReps: 5, timerReps: 5, clientReps: 5 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(false);
  });

  it('rejects stale prior-interval sample reuse', () => {
    const record = buildSprintRecord(0, 3, { staleSprintRep: 1 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(false);
  });

  it('rejects manual sprint capture', () => {
    const record = buildSprintRecord(0, 3, { manualSprintRep: 1 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(false);
  });

  it('rejects manual rest capture', () => {
    const record = buildSprintRecord(0, 3, { manualRestRep: 2 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(false);
  });

  it('rejects missing rest HR', () => {
    const record = buildSprintRecord(0, 3, { missingRestRep: 0 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(false);
  });

  it('rejects rest HR captured at 90s instead of prescribed 60s checkpoint', () => {
    const record = buildSprintRecord(0, 3, { lateRestRep: 1 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(false);
  });

  it('allows suspicious drops when provenance is valid', () => {
    const record = buildSprintRecord(0, 5, { suspiciousRep: 1 });
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(true);
  });

  it('accepts full canonical W5 (10 reps) with fresh BLE captures', () => {
    const record = buildSprintRecord(4, 10);
    expect(evaluateSprintBleVerification(record, record.cfg.workoutContext).bleVerified).toBe(true);
  });

  it('rejects invalid sprint prescription context', () => {
    const record = buildSprintRecord(0, 3);
    expect(evaluateSprintBleVerification(record, {}).bleVerified).toBe(false);
    expect(evaluateSprintBleVerification({ data: [] }, null).bleVerified).toBe(false);
  });

  it('derives session hr_source from rep captures', () => {
    expect(deriveSessionHrSource([
      { sprintCapture: autoCapture(), restCapture: autoCapture() },
    ])).toBe('web-ble');

    expect(deriveSessionHrSource([
      { sprintCapture: { ...autoCapture(), source: 'native-ble' }, restCapture: autoCapture() },
    ])).toBe('mixed-ble');
  });

  it('marks hr_source mixed when any capture is manual', () => {
    expect(deriveSessionHrSource([
      { sprintCapture: autoCapture(), restCapture: autoCapture() },
      { sprintCapture: autoCapture(), restCapture: manualCapture() },
    ])).toBe('mixed');
  });

  it('requires fresh auto BLE capture metadata', () => {
    expect(isFreshAutoBleCapture(autoCapture())).toBe(true);
    expect(isFreshAutoBleCapture(manualCapture())).toBe(false);
    expect(isFreshAutoBleCapture({ ...autoCapture(), sampleSequence: 3, windowStartSequence: 3 })).toBe(false);
  });

  it('only trusts the database ble_verified column', () => {
    expect(isBleVerifiedSprintRow({ ble_verified: true })).toBe(true);
    expect(isBleVerifiedSprintRow({ ble_verified: false, session_json: { bleVerified: true } })).toBe(false);
  });
});

describe('resolveVerificationMethod', () => {
  it('returns ble for ble_verified sprint without attachment', () => {
    expect(resolveVerificationMethod({
      row: { attachment_id: null },
      sprintRow: { ble_verified: true, session_json: { bleVerified: true } },
      attachments: [],
      isSprint: true,
    })).toBe('ble');
  });

  it('returns missing for manual sprint without attachment', () => {
    expect(resolveVerificationMethod({
      row: { attachment_id: null },
      sprintRow: { ble_verified: false, session_json: { bleVerified: false } },
      attachments: [],
      isSprint: true,
    })).toBe('missing');
  });

  it('does not trust session_json bleVerified when database column is false', () => {
    expect(resolveVerificationMethod({
      row: { attachment_id: null },
      sprintRow: { ble_verified: false, session_json: { bleVerified: true } },
      attachments: [],
      isSprint: true,
    })).toBe('missing');
  });

  it('prefers attachment when screenshot exists', () => {
    expect(resolveVerificationMethod({
      row: { attachment_id: 'proof-1' },
      sprintRow: { ble_verified: true },
      attachments: [],
      isSprint: true,
    })).toBe('attachment');
  });
});
