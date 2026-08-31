import { describe, expect, it } from 'vitest';
import { validateSprintBleVerificationRow } from '../src/sprint-ble-db-validation.js';
import { isBleVerifiedSprintRow, resolveVerificationMethod } from '../src/sprint-ble-verification.js';

function autoCapture(sampleSequence = 12, windowStartSequence = 5, captureAtRestSec = 60) {
  return {
    mode: 'auto',
    source: 'web-ble',
    capturedAt: Date.now(),
    sampleSequence,
    windowStartSequence,
    captureAtRestSec,
  };
}

function buildValidW5Session() {
  const reps = 10;
  return {
    data: Array.from({ length: reps }, (_, index) => ({
      sprintHR: 165,
      restHR: 145,
      sprintCapture: autoCapture(10 + index, 5),
      restCapture: autoCapture(20 + index, 10, 60),
    })),
  };
}

describe('sprint BLE DB trust validation mirror', () => {
  it('accepts a valid full canonical W5 session', () => {
    expect(validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 10,
      repsPlanned: 10,
      restSeconds: 90,
      sessionJson: buildValidW5Session(),
    })).toBe(true);
  });

  it('rejects W5 when client claims 5 prescribed reps', () => {
    expect(validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 5,
      repsPlanned: 5,
      restSeconds: 90,
      sessionJson: {
        data: buildValidW5Session().data.slice(0, 5),
      },
    })).toBe(false);
  });

  it('rejects direct ble_verified=true when session_json is not valid', () => {
    const valid = validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 5,
      repsPlanned: 5,
      restSeconds: 90,
      sessionJson: { data: buildValidW5Session().data.slice(0, 5) },
    });
    expect(valid).toBe(false);
  });

  it('rejects rest captured at 90s instead of prescribed 60s checkpoint', () => {
    const session = buildValidW5Session();
    session.data[0].restCapture = autoCapture(21, 10, 90);
    expect(validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 10,
      repsPlanned: 10,
      restSeconds: 90,
      sessionJson: session,
    })).toBe(false);
  });

  it('rejects manual sprint capture', () => {
    const session = buildValidW5Session();
    session.data[1].sprintCapture = {
      mode: 'manual',
      source: 'manual',
      capturedAt: Date.now(),
    };
    expect(validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 10,
      repsPlanned: 10,
      restSeconds: 90,
      sessionJson: session,
    })).toBe(false);
  });

  it('fails closed on malformed session_json without throwing', () => {
    expect(() => validateSprintBleVerificationRow({
      weekIndex: 0,
      workoutIndex: 0,
      intervalsCompleted: 5,
      repsPlanned: 5,
      restSeconds: 90,
      sessionJson: { data: 'not-an-array' },
    })).not.toThrow();
    expect(validateSprintBleVerificationRow({
      weekIndex: 0,
      workoutIndex: 0,
      intervalsCompleted: 5,
      repsPlanned: 5,
      restSeconds: 90,
      sessionJson: { data: 'not-an-array' },
    })).toBe(false);
  });

  it('rejects invalid HR values', () => {
    const session = buildValidW5Session();
    session.data[0].sprintHR = 'banana';
    expect(validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 10,
      repsPlanned: 10,
      restSeconds: 90,
      sessionJson: session,
    })).toBe(false);

    session.data[0].sprintHR = 165;
    session.data[0].restHR = '-900';
    expect(validateSprintBleVerificationRow({
      weekIndex: 4,
      workoutIndex: 0,
      intervalsCompleted: 10,
      repsPlanned: 10,
      restSeconds: 90,
      sessionJson: session,
    })).toBe(false);
  });
});

describe('coach/athlete DB authority for BLE status', () => {
  it('does not resurrect bleVerified from session_json when DB column is false', () => {
    const sprintRow = {
      ble_verified: false,
      session_json: { bleVerified: true },
    };
    expect(isBleVerifiedSprintRow(sprintRow)).toBe(false);
    expect(resolveVerificationMethod({
      row: { attachment_id: null },
      sprintRow,
      attachments: [],
      isSprint: true,
    })).toBe('missing');
  });
});
