import { describe, expect, it } from 'vitest';
import {
  athleteFacingWorkoutSaveError,
  classifyUniqueViolation,
  doesCloudCompletionMatchRequestedSave,
  isAmbiguousNetworkError,
  isAuthSessionError,
  isReconcileableUniqueConflict,
  looksLikeInfrastructureError,
  resolveCanonicalWorkoutIdentity,
  UNIQUE_CONFLICT,
} from '../src/workout-completion-identity.js';

describe('resolveCanonicalWorkoutIdentity', () => {
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

  it('rejects null/blank/decimal/negative as positional identity', () => {
    expect(resolveCanonicalWorkoutIdentity({
      workoutContext: { weekIndex: null, workoutIndex: 1 },
      completionKey: 'fallback',
    }).source).toBe('legacy_completion_key');
    expect(resolveCanonicalWorkoutIdentity({
      workoutContext: { weekIndex: '', workoutIndex: 1 },
    }).completionKey).toBe('');
    expect(resolveCanonicalWorkoutIdentity({
      workoutContext: { weekIndex: 1.5, workoutIndex: 2 },
    }).source).toBe('missing');
    expect(resolveCanonicalWorkoutIdentity({
      workoutContext: { weekIndex: -1, workoutIndex: 0 },
    }).source).toBe('missing');
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

describe('unique conflict classification', () => {
  it('classifies positional unique conflicts as reconcileable', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "workout_completions_user_id_week_index_workout_index_key"',
    };
    expect(classifyUniqueViolation(error)).toBe(UNIQUE_CONFLICT.POSITION);
    expect(isReconcileableUniqueConflict(error)).toBe(true);
    expect(athleteFacingWorkoutSaveError(error)).toBe('WORKOUT ALREADY EXISTS — REFRESHING YOUR SAVED RESULT');
  });

  it('classifies client_record_id conflicts as non-reconcileable for soft-success', () => {
    const error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "workout_completions_user_client_record_id_idx"',
    };
    expect(classifyUniqueViolation(error)).toBe(UNIQUE_CONFLICT.CLIENT_RECORD_ID);
    expect(isReconcileableUniqueConflict(error)).toBe(false);
    expect(athleteFacingWorkoutSaveError(error)).toBe(
      'COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.',
    );
  });

  it('does not treat generic 23505 soft-success without matching requested metrics', () => {
    const requested = {
      workoutContext: { weekIndex: 0, workoutIndex: 2 },
      workoutLog: { totalMinutes: 40, avgBpm: 150 },
    };
    const staleVisible = {
      completionKey: '0:2',
      proof_pending: false,
      workoutContext: { weekIndex: 0, workoutIndex: 2 },
      workoutLog: { totalMinutes: 35, avgBpm: 140 },
    };
    expect(doesCloudCompletionMatchRequestedSave(staleVisible, requested)).toBe(false);
    expect(doesCloudCompletionMatchRequestedSave({
      ...staleVisible,
      workoutLog: { totalMinutes: 40, avgBpm: 150 },
    }, requested)).toBe(true);
  });
});

describe('workout completion identity errors', () => {
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
    }
  });

  it('preserves proof-diagnostics athlete copy instead of flattening it', () => {
    expect(athleteFacingWorkoutSaveError({
      proofFailureKind: 'proof_rpc',
      message: "COULDN'T CONFIRM THE SAVE. CHECK YOUR CONNECTION AND TAP SAVE AGAIN.",
    })).toBe("COULDN'T CONFIRM THE SAVE. CHECK YOUR CONNECTION AND TAP SAVE AGAIN.");
  });

  it('maps auth and ambiguous network failures to recoverable instructions', () => {
    expect(isAuthSessionError({ message: 'JWT expired' })).toBe(true);
    expect(athleteFacingWorkoutSaveError({ message: 'JWT expired' }))
      .toBe('SIGN IN REQUIRED — YOUR SESSION EXPIRED. SIGN IN AGAIN TO FINISH SAVING.');
    expect(isAmbiguousNetworkError({ message: 'Failed to fetch' })).toBe(true);
    expect(athleteFacingWorkoutSaveError({ message: 'Failed to fetch' }))
      .toBe("NETWORK RESULT UNKNOWN — WE'LL CHECK WHETHER YOUR WORKOUT SAVED BEFORE RETRYING.");
  });

  it('maps unknown/raw failures to a recoverable athlete instruction', () => {
    expect(athleteFacingWorkoutSaveError(new Error('cloud completion failed')))
      .toBe('COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.');
  });
});
