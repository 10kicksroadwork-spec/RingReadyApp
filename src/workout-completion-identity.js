/** Workout completion identity helpers shared by cloud saves and athlete UX.
 *  Aligns with RingReady Testing & Reliability Source of Truth:
 *  Identity, Idempotency, Recoverability, and Error UX contracts.
 */

function textOf(error) {
  return String(error?.message || error || '').trim();
}

function lowerTextOf(error) {
  return textOf(error).toLowerCase();
}

export function resolveCanonicalWorkoutIdentity(record = {}) {
  const context = record?.cfg?.workoutContext || record?.workoutContext || {};
  const weekIndex = Number(context.weekIndex);
  const workoutIndex = Number(context.workoutIndex);
  if (Number.isFinite(weekIndex) && Number.isFinite(workoutIndex)) {
    return {
      weekIndex,
      workoutIndex,
      completionKey: `${weekIndex}:${workoutIndex}`,
      source: 'week_workout',
    };
  }
  const legacyKey = String(record?.completionKey || '').trim();
  return {
    weekIndex: null,
    workoutIndex: null,
    completionKey: legacyKey,
    source: legacyKey ? 'legacy_completion_key' : 'missing',
  };
}

export function isDuplicateWorkoutIdentityError(error) {
  const code = String(error?.code || error?.error_code || '').toUpperCase();
  if (code === '23505') return true;
  const message = lowerTextOf(error);
  return message.includes('duplicate key')
    || message.includes('unique constraint')
    || message.includes('workout_completions_user_id_week_index_workout_index_key')
    || message.includes('workout_completions_user_completion_key_idx')
    || message.includes('workout_completions_user_client_record_id_idx');
}

export function isAuthSessionError(error) {
  const message = lowerTextOf(error);
  const status = Number(error?.status || error?.statusCode || 0);
  return status === 401
    || message.includes('jwt')
    || message.includes('not authenticated')
    || message.includes('session expired')
    || message.includes('invalid claim')
    || message.includes('sign in');
}

export function isAmbiguousNetworkError(error) {
  if (error?.ambiguous || error?.name === 'OperationTimeoutError') return true;
  const message = lowerTextOf(error);
  return message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('load failed')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('internet connection');
}

export function looksLikeInfrastructureError(error) {
  const code = String(error?.code || error?.error_code || '').toUpperCase();
  if (/^(22|23|42|PGRST|42501|23505)/.test(code)) return true;
  const message = lowerTextOf(error);
  return message.includes('postgres')
    || message.includes('supabase')
    || message.includes('sqlstate')
    || message.includes('schema cache')
    || message.includes('row-level security')
    || message.includes('rls')
    || message.includes('permission denied')
    || message.includes('violates')
    || message.includes('constraint')
    || message.includes('relation ')
    || message.includes('column ')
    || message.includes('rpc')
    || message.includes('pgrst');
}

/** Athletes must never see raw SQL/RLS/Supabase/JS infrastructure text. */
export function athleteFacingWorkoutSaveError(error) {
  if (isDuplicateWorkoutIdentityError(error)) {
    return 'WORKOUT ALREADY EXISTS — REFRESHING YOUR SAVED RESULT';
  }
  if (isAuthSessionError(error)) {
    return 'SIGN IN REQUIRED — YOUR SESSION EXPIRED. SIGN IN AGAIN TO FINISH SAVING.';
  }
  if (isAmbiguousNetworkError(error)) {
    return "NETWORK RESULT UNKNOWN — WE'LL CHECK WHETHER YOUR WORKOUT SAVED BEFORE RETRYING.";
  }
  if (looksLikeInfrastructureError(error)) {
    return 'COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.';
  }

  const raw = textOf(error);
  if (isKnownAthleteSafeMessage(raw)) return raw;
  return 'COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.';
}

function isKnownAthleteSafeMessage(message) {
  const normalized = String(message || '').trim().toUpperCase();
  if (!normalized) return false;
  return normalized.startsWith('ADD WORKOUT PROOF')
    || normalized.startsWith('WORKOUT ALREADY EXISTS')
    || normalized.startsWith('SIGN IN REQUIRED')
    || normalized.startsWith('NETWORK RESULT UNKNOWN')
    || normalized.startsWith('COULD NOT SAVE WORKOUT')
    || normalized.startsWith('COULD NOT CLEAR')
    || normalized.startsWith('OPEN WORKOUT')
    || normalized.startsWith('FILL OUT')
    || normalized.startsWith('PROOF ');
}
