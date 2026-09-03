/** Workout completion identity helpers shared by cloud saves and athlete UX.
 *  Aligns with RingReady Testing & Reliability Source of Truth:
 *  Identity, Idempotency, Recoverability, Authority, and Error UX contracts.
 */

import { readOutputFromWorkoutLog } from './modality.js';

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

/** Single canonical parser for workout position indices. */
export function parseNonNegativeInteger(value) {
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
  if (error?.workoutIdentityConflict) {
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

function isPopulated(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

function numbersEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) <= 0.001;
}

function valuesEqual(requested, cloud) {
  if (typeof requested === 'number' || typeof cloud === 'number') {
    return Number.isFinite(Number(requested)) && Number.isFinite(Number(cloud)) && numbersEqual(requested, cloud);
  }
  return String(requested) === String(cloud);
}

/**
 * Canonical comparable mutation projection (excludes nondeterministic timestamps).
 * Used for Authority soft-success checks.
 */
export function buildComparableCompletionMutation(record = {}) {
  const identity = resolveCanonicalWorkoutIdentity(record);
  const workoutLog = record.workoutLog || {};
  const output = readOutputFromWorkoutLog(workoutLog);
  const attachmentId = record.attachment?.id || record.attachment_id || null;
  return {
    completion_key: identity.completionKey || null,
    week_index: identity.weekIndex,
    workout_index: identity.workoutIndex,
    total_minutes: Number.isFinite(Number(workoutLog.totalMinutes)) ? Number(workoutLog.totalMinutes) : null,
    total_seconds: parseNonNegativeInteger(workoutLog.totalSeconds),
    avg_bpm: parseNonNegativeInteger(workoutLog.avgBpm),
    max_bpm: parseNonNegativeInteger(workoutLog.maxBpm),
    modality: output.modality || null,
    output_type: output.outputType || null,
    output_value: Number.isFinite(Number(output.outputValue)) ? Number(output.outputValue) : null,
    distance: output.outputType === 'distance' && Number.isFinite(Number(output.outputValue))
      ? Number(output.outputValue)
      : (Number.isFinite(Number(workoutLog.distance)) ? Number(workoutLog.distance) : null),
    avg_watts: output.outputType === 'watts' && Number.isFinite(Number(output.outputValue))
      ? Number(output.outputValue)
      : (Number.isFinite(Number(workoutLog.avgWatts)) ? Number(workoutLog.avgWatts) : null),
    attachment_id: attachmentId ? String(attachmentId) : null,
  };
}

export function projectCloudCompletionMutation(cloudRecord = {}) {
  const context = cloudRecord.workoutContext || cloudRecord.cfg?.workoutContext || {};
  const workoutLog = cloudRecord.workoutLog || {};
  const week = parseNonNegativeInteger(
    context.weekIndex ?? cloudRecord.week_index ?? cloudRecord.weekIndex,
  );
  const workout = parseNonNegativeInteger(
    context.workoutIndex ?? cloudRecord.workout_index ?? cloudRecord.workoutIndex,
  );
  const completionKey = String(
    cloudRecord.completionKey || cloudRecord.completion_key || '',
  ).trim() || (week !== null && workout !== null ? `${week}:${workout}` : null);

  const modality = workoutLog.modality || cloudRecord.modality || null;
  const outputType = workoutLog.outputType || cloudRecord.output_type || cloudRecord.outputType || null;
  const outputValueRaw = workoutLog.outputValue ?? cloudRecord.output_value ?? cloudRecord.outputValue;
  const outputValue = Number.isFinite(Number(outputValueRaw)) ? Number(outputValueRaw) : null;
  const attachmentId = cloudRecord.attachment?.id || cloudRecord.attachment_id || null;

  const totalMinutesRaw = workoutLog.totalMinutes ?? cloudRecord.total_minutes ?? cloudRecord.totalMinutes;
  const distanceRaw = workoutLog.distance ?? cloudRecord.distance
    ?? (outputType === 'distance' ? outputValueRaw : null);
  const avgWattsRaw = workoutLog.avgWatts ?? cloudRecord.avg_watts ?? cloudRecord.avgWatts
    ?? (outputType === 'watts' ? outputValueRaw : null);

  return {
    completion_key: completionKey,
    week_index: week,
    workout_index: workout,
    total_minutes: Number.isFinite(Number(totalMinutesRaw)) ? Number(totalMinutesRaw) : null,
    total_seconds: parseNonNegativeInteger(workoutLog.totalSeconds ?? cloudRecord.total_seconds ?? cloudRecord.totalSeconds),
    avg_bpm: parseNonNegativeInteger(workoutLog.avgBpm ?? cloudRecord.avg_bpm ?? cloudRecord.avgBpm),
    max_bpm: parseNonNegativeInteger(workoutLog.maxBpm ?? cloudRecord.max_bpm ?? cloudRecord.maxBpm),
    modality: modality || null,
    output_type: outputType || null,
    output_value: outputValue,
    distance: Number.isFinite(Number(distanceRaw)) ? Number(distanceRaw) : null,
    avg_watts: Number.isFinite(Number(avgWattsRaw)) ? Number(avgWattsRaw) : null,
    attachment_id: attachmentId ? String(attachmentId) : null,
  };
}

/**
 * Authority check: soft-success only when authoritative cloud state proves the
 * requested mutation landed. If a requested metric is populated, cloud must
 * contain and equal it.
 */
export function doesCloudCompletionMatchRequestedSave(cloudRecord, requestedRecord = {}) {
  if (!cloudRecord) return false;
  if (cloudRecord.proof_pending === true || cloudRecord.proofPending === true) return false;

  const requested = buildComparableCompletionMutation(requestedRecord);
  const cloud = projectCloudCompletionMutation(cloudRecord);

  const fields = [
    'completion_key',
    'week_index',
    'workout_index',
    'total_minutes',
    'total_seconds',
    'avg_bpm',
    'max_bpm',
    'modality',
    'output_type',
    'output_value',
    'distance',
    'avg_watts',
    'attachment_id',
  ];

  for (const field of fields) {
    if (!isPopulated(requested[field])) continue;
    if (!isPopulated(cloud[field])) return false;
    if (!valuesEqual(requested[field], cloud[field])) return false;
  }
  return true;
}

export function createDualWorkoutIdentityError(positionalRow, keyRow, kind = 'dual_row') {
  const error = new Error('WORKOUT IDENTITY CONFLICT — CONTACT YOUR COACH.');
  error.workoutIdentityConflict = kind;
  error.positionalRowId = positionalRow?.id || null;
  error.completionKeyRowId = keyRow?.id || null;
  return error;
}

/** True when a key-row's stored position disagrees with the requested canonical position. */
export function keyRowDisagreesWithCanonicalPosition(keyRow, identity) {
  if (!keyRow || identity?.source !== 'week_workout') return false;
  const keyWeek = parseNonNegativeInteger(keyRow.week_index ?? keyRow.weekIndex);
  const keyWorkout = parseNonNegativeInteger(keyRow.workout_index ?? keyRow.workoutIndex);
  if (keyWeek === null && keyWorkout === null) return false;
  return keyWeek !== identity.weekIndex || keyWorkout !== identity.workoutIndex;
}
