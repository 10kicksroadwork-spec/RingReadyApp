import { describe, expect, it, beforeEach } from 'vitest';
import {
  LOCAL_ATHLETE_CHECKPOINT_USER_ID,
  loadActiveSessionCheckpoint,
  resolveRestCaptureAttempted,
  saveActiveSessionCheckpoint,
} from '../src/session-checkpoint.js';

describe('local athlete checkpoint namespace', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists checkpoints under the local-athlete key when no signed-in user exists', () => {
    const cfg = { reps: 4, rest: 60, maxHR: 180, targetPct: 90, workoutContext: null };
    const state = {
      phase: 'sprinting',
      currentRep: 1,
      seconds: 0,
      data: [],
      pendingRep: null,
      awaitingModal: false,
      capturedSprintHR: null,
      capturedRestHR: null,
    };

    saveActiveSessionCheckpoint(cfg, state, null, 'session-echo-1');
    const checkpoint = loadActiveSessionCheckpoint(LOCAL_ATHLETE_CHECKPOINT_USER_ID);

    expect(checkpoint?.sessionId).toBe('session-echo-1');
    expect(checkpoint?.state.phase).toBe('sprinting');
  });
});

describe('rest capture checkpoint restore', () => {
  it('preserves captureAttempted after checkpoint clear', () => {
    expect(resolveRestCaptureAttempted({ captureAttempted: true }, { restHR: null })).toBe(true);
  });

  it('treats logged rest HR as already captured', () => {
    expect(resolveRestCaptureAttempted({ captureAttempted: false }, { restHR: 120 })).toBe(true);
  });

  it('allows first capture when not attempted and rest HR missing', () => {
    expect(resolveRestCaptureAttempted({ captureAttempted: false }, { restHR: null })).toBe(false);
  });
});
