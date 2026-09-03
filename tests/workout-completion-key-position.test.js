import { describe, expect, it } from 'vitest';
import {
  createDualWorkoutIdentityError,
  keyRowDisagreesWithCanonicalPosition,
  resolveCanonicalWorkoutIdentity,
} from '../src/workout-completion-identity.js';

describe('key-row position disagreement', () => {
  it('flags a completion_key row whose stored position differs from the requested canonical position', () => {
    const identity = resolveCanonicalWorkoutIdentity({
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
    });
    expect(keyRowDisagreesWithCanonicalPosition({
      id: 'row-a',
      completion_key: '2:1',
      week_index: 1,
      workout_index: 0,
    }, identity)).toBe(true);
  });

  it('allows a key row with matching position or null legacy position', () => {
    const identity = resolveCanonicalWorkoutIdentity({
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
    });
    expect(keyRowDisagreesWithCanonicalPosition({
      id: 'row-b',
      completion_key: '2:1',
      week_index: 2,
      workout_index: 1,
    }, identity)).toBe(false);
    expect(keyRowDisagreesWithCanonicalPosition({
      id: 'row-c',
      completion_key: '2:1',
      week_index: null,
      workout_index: null,
    }, identity)).toBe(false);
  });

  it('creates an explicit key_position_mismatch conflict error', () => {
    const error = createDualWorkoutIdentityError(null, { id: 'row-a' }, 'key_position_mismatch');
    expect(error.workoutIdentityConflict).toBe('key_position_mismatch');
    expect(error.completionKeyRowId).toBe('row-a');
    expect(error.positionalRowId).toBeNull();
  });
});
