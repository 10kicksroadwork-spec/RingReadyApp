import { describe, expect, it } from 'vitest';
import { resolveRestCaptureAttempted } from '../src/session-checkpoint.js';

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
