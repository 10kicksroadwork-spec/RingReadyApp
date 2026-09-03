/** Workout completion identity helpers shared by cloud saves and athlete UX.
 *  Aligns with RingReady Testing & Reliability Source of Truth:
 *  Identity, Idempotency, Recoverability, Authority, and Error UX contracts.
 */

export const UNIQUE_CONFLICT = {
  POSITION: 'POSITION_CONFLICT',
  COMPLETION_KEY: 'COMPLETION_KEY_CONFLICT',
  CLIENT_RECORD_ID: 'CLIENT_RECORD_ID_CONFLICT',
  UNKNOWN: 'UNKNOWN_UNIQUE_CONFLICT',
};

function textOf(error) {
  return String(error?.message || error || '').trim();
}

function lowerTextOf(error) {
  return textOf(error).toLowerCase();
}

function parseNonNegativeInteger(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  if (typeof value === 'number' && !Number.isInteger(value)) return null;
  if (typeof value === 'string' && !/^-?\d+$/.test(value.trim())) return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 0) return null;
  return num;
}

export function resolveCanonicalWorkoutIdentity(record = {}) {
  const context = record?.cfg?.workoutContext || record?.workoutContext || {};
  const weekIndex = parseNonNegativeInteger(context.weekIndex);
  const workoutIndex = parseNonNegativeInteger(context.workoutIndex);
  if (weekIndex !== null && workoutIndex !== null) {
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

export function classifyUniqueViolation(error) {
  const code = String(error?.code || error?.error_code || '').toUpperCase();
  const message = lowerTextOf(error);
  const isUnique = code === '23505'
    || message.includes('duplicate key')
    || message.includes('unique constraint');
  if (!isUnique) return null;

  if (
    message.includes('workout_completions_user_id_week_index_workout_index_key')
    || (message.includes('week_index') && message.includes('workout_index'))
  ) {
    return UNIQUE_CONFLICT.POSITION;
  }
  if (message.includes('workout_completions_user_completion_key_idx') || message.includes('completion_key')) {
    return UNIQUE_CONFLICT.COMPLETION_KEY;
  }
  if (message.includes('workout_completions_user_client_record_id_idx') || message.includes('client_record_id')) {
    return UNIQUE_CONFLICT.CLIENT_RECORD_ID;
  }
  return UNIQUE_CONFLICT.UNKNOWN;
}

export function isReconcileableUniqueConflict(error) {
  const kind = classifyUniqueViolation(error);
  return kind === UNIQUE_CONFLICT.POSITION || kind === UNIQUE_CONFLICT.COMPLETION_KEY;
}

/** @deprecated Prefer classifyUniqueViolation / isReconcileableUniqueConflict. */
export function isDuplicateWorkoutIdentityError(error) {
  return isReconcileableUniqueConflict(error);
}

export function isAuthSessionError(error) {
  const message = lowerTextOf(error);
  const status = Number(error?.status || error?.statusCode || 0);
  return status === 401
    || message.includes('jwt')
    || message.includes('not authenticated')
    || message.includes('session expired')
    || message.includes('invalid claim');
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

function isKnownAthleteSafeMessage(message) {
  const normalized = String(message || '').trim().toUpperCase();
  if (!normalized) return false;
  return normalized.startsWith('ADD WORKOUT PROOF')
    || normalized.startsWith('WORKOUT ALREADY EXISTS')
    || normalized.startsWith('WORKOUT IDENTITY CONFLICT')
    || normalized.startsWith('SIGN IN REQUIRED')
    || normalized.startsWith('NETWORK RESULT UNKNOWN')
    || normalized.startsWith('COULD NOT SAVE WORKOUT')
    || normalized.startsWith('COULD NOT CLEAR')
    || normalized.startsWith('OPEN WORKOUT')
    || normalized.startsWith('FILL OUT')
    || normalized.startsWith('PROOF ')
    || normalized.startsWith("COULDN'T CONFIRM")
    || normalized.startsWith('SCREENSHOT')
    || normalized.startsWith('RING READY COULD NOT');
}

/** Athletes must never see raw SQL/RLS/Supabase/JS infrastructure text. */
export function athleteFacingWorkoutSaveError(error) {
  // Proof-diagnostics already produced athlete-safe copy — do not flatten it.
  if (error?.proofFailureKind || error?.proofUserMessage) {
    const proofMessage = String(error.proofUserMessage || error.message || '').trim();
    if (proofMessage) return proofMessage;
  }

  const uniqueKind = classifyUniqueViolation(error);
  if (uniqueKind === UNIQUE_CONFLICT.POSITION || uniqueKind === UNIQUE_CONFLICT.COMPLETION_KEY) {
    return 'WORKOUT ALREADY EXISTS — REFRESHING YOUR SAVED RESULT';
  }
  if (uniqueKind === UNIQUE_CONFLICT.CLIENT_RECORD_ID || uniqueKind === UNIQUE_CONFLICT.UNKNOWN) {
    return 'COULD NOT SAVE WORKOUT — TRY AGAIN. IF THIS CONTINUES, CONTACT YOUR COACH.';
  }
  if (error?.workoutIdentityConflict === 'dual_row') {
    return 'WORKOUT IDENTITY CONFLICT — CONTACT YOUR COACH.';
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

/**
 * Authority check: soft-success only when the authoritative cloud row matches the
 * requested logical save enough to claim the write landed.
 */
export function doesCloudCompletionMatchRequestedSave(cloudRecord, requestedRecord = {}) {
  if (!cloudRecord) return false;
  if (cloudRecord.proof_pending === true || cloudRecord.proofPending === true) return false;

  const requested = resolveCanonicalWorkoutIdentity(requestedRecord);
  const cloudKey = String(
    cloudRecord.completionKey
    || cloudRecord.completion_key
    || '',
  ).trim();
  if (requested.completionKey && cloudKey && cloudKey !== requested.completionKey) return false;

  if (requested.source === 'week_workout') {
    const cloudWeek = Number(cloudRecord.workoutContext?.weekIndex ?? cloudRecord.week_index ?? cloudRecord.weekIndex);
    const cloudWorkout = Number(cloudRecord.workoutContext?.workoutIndex ?? cloudRecord.workout_index ?? cloudRecord.workoutIndex);
    if (cloudWeek !== requested.weekIndex || cloudWorkout !== requested.workoutIndex) return false;
  }

  const requestedLog = requestedRecord.workoutLog || {};
  const cloudLog = cloudRecord.workoutLog || {};
  const requestedMinutes = Number(requestedLog.totalMinutes);
  const cloudMinutes = Number(
    cloudLog.totalMinutes
    ?? cloudRecord.total_minutes
    ?? cloudRecord.totalMinutes,
  );
  if (Number.isFinite(requestedMinutes) && Number.isFinite(cloudMinutes)) {
    if (Math.abs(requestedMinutes - cloudMinutes) > 0.001) return false;
  }

  const requestedAvg = Number(requestedLog.avgBpm);
  const cloudAvg = Number(cloudLog.avgBpm ?? cloudRecord.avg_bpm ?? cloudRecord.avgBpm);
  if (Number.isFinite(requestedAvg) && Number.isFinite(cloudAvg) && requestedAvg !== cloudAvg) {
    return false;
  }

  return true;
}

export function createDualWorkoutIdentityError(positionalRow, keyRow) {
  const error = new Error('WORKOUT IDENTITY CONFLICT — CONTACT YOUR COACH.');
  error.workoutIdentityConflict = 'dual_row';
  error.positionalRowId = positionalRow?.id || null;
  error.completionKeyRowId = keyRow?.id || null;
  return error;
}
