import { describe, expect, it } from 'vitest';
import {
  athleteFacingWorkoutSaveError,
  isDuplicateWorkoutIdentityError,
} from '../src/workout-completion-identity.js';

describe('workout completion identity errors', () => {
  it('detects the production week/workout unique constraint', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "workout_completions_user_id_week_index_workout_index_key"',
    };
    expect(isDuplicateWorkoutIdentityError(error)).toBe(true);
    expect(athleteFacingWorkoutSaveError(error)).toBe('WORKOUT ALREADY EXISTS — REFRESHING SAVED RESULT');
  });

  it('detects completion_key and client_record_id uniqueness collisions', () => {
    expect(isDuplicateWorkoutIdentityError({
      message: 'duplicate key value violates unique constraint "workout_completions_user_completion_key_idx"',
    })).toBe(true);
    expect(isDuplicateWorkoutIdentityError({
      message: 'duplicate key value violates unique constraint "workout_completions_user_client_record_id_idx"',
    })).toBe(true);
  });

  it('passes through unrelated athlete-facing messages', () => {
    expect(athleteFacingWorkoutSaveError(new Error('Proof upload timed out'))).toBe('Proof upload timed out');
  });
});
