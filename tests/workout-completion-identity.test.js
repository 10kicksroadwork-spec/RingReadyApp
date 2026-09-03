import { describe, expect, it } from 'vitest';
import {
  athleteFacingWorkoutSaveError,
  isAmbiguousNetworkError,
  isAuthSessionError,
  isDuplicateWorkoutIdentityError,
  looksLikeInfrastructureError,
  resolveCanonicalWorkoutIdentity,
} from '../src/workout-completion-identity.js';

describe('workout completion identity', () => {
  it('makes week/workout canonical over a stale completionKey', () => {
    expect(resolveCanonicalWorkoutIdentity({
      completionKey: 'legacy-stale-key',
      workoutContext: { weekIndex: 2, workoutIndex: 1 },
    })).toEqual({
      weekIndex: 2,
      workoutIndex: 1,
      completionKey: '2:1',
      source: 'week_workout',
    });
  });

  it('falls back to legacy completionKey only without week/workout context', () => {
    expect(resolveCanonicalWorkoutIdentity({ completionKey: 'orphan-key' })).toEqual({
      weekIndex: null,
      workoutIndex: null,
      completionKey: 'orphan-key',
      source: 'legacy_completion_key',
    });
  });
});

describe('workout completion identity errors', () => {
  it('maps the production week/workout unique constraint to athlete-safe copy', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "workout_completions_user_id_week_index_workout_index_key"',
    };
    expect(isDuplicateWorkoutIdentityError(error)).toBe(true);
    expect(athleteFacingWorkoutSaveError(error)).toBe('WORKOUT ALREADY EXISTS — REFRESHING YOUR SAVED RESULT');
    expect(athleteFacingWorkoutSaveError(error).toLowerCase()).not.toContain('constraint');
    expect(athleteFacingWorkoutSaveError(error).toLowerCase()).not.toContain('postgres');
  });

  it('detects completion_key and client_record_id uniqueness collisions', () => {
    expect(isDuplicateWorkoutIdentityError({
      message: 'duplicate key value violates unique constraint "workout_completions_user_completion_key_idx"',
    })).toBe(true);
    expect(isDuplicateWorkoutIdentityError({
      message: 'duplicate key value violates unique constraint "workout_completions_user_client_record_id_idx"',
    })).toBe(true);
  });

  it('never leaks RLS/SQL/Supabase internals to athletes', () => {
    const cases = [
      { message: 'new row violates row-level security policy for table "workout_completions"' },
      { code: '42501', message: 'permission denied for table workout_completions' },
      { message: 'Could not find the table \'public.workout_completions\' in the schema cache' },
      { message: 'PGRST116: JSON object requested, multiple (or no) rows returned' },
    ];
    for (const error of cases) {
      expect(looksLikeInfrastructureError(error)).toBe(true);
      const facing = athleteFacingWorkoutSaveError(error);
      expect(facing.toLowerCase()).not.toMatch(/postgres|supabase|rls|schema cache|pgrst|permission denied|violates/);
      expect(facing).toBe('COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.');
    }
  });

  it('maps auth and ambiguous network failures to recoverable instructions', () => {
    expect(isAuthSessionError({ message: 'JWT expired' })).toBe(true);
    expect(athleteFacingWorkoutSaveError({ message: 'JWT expired' }))
      .toBe('SIGN IN REQUIRED — YOUR SESSION EXPIRED. SIGN IN AGAIN TO FINISH SAVING.');
    expect(isAmbiguousNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(athleteFacingWorkoutSaveError({ message: 'Failed to fetch' }))
      .toBe("NETWORK RESULT UNKNOWN — WE'LL CHECK WHETHER YOUR WORKOUT SAVED BEFORE RETRYING.");
  });

  it('passes through already athlete-safe messages', () => {
    expect(athleteFacingWorkoutSaveError(new Error('ADD WORKOUT PROOF'))).toBe('ADD WORKOUT PROOF');
  });

  it('maps unknown/raw failures to a recoverable athlete instruction', () => {
    expect(athleteFacingWorkoutSaveError(new Error('cloud completion failed')))
      .toBe('COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.');
  });
});
