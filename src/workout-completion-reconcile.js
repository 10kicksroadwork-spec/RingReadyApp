/** Injectable workout-completion reconcile algorithm used by production auth
 *  and the live Layer C production-contract. Keep these paths identical.
 */

import {
  buildProvisionalWorkoutCloudPayload,
  buildWorkoutCloudPayload,
  getCompletionKeyFromRecord,
} from './cloud-record-mapper.js';
import {
  canRollbackProvisionalStaging,
  planWorkoutIdentityStaging,
} from './proof-staging.js';
import {
  createDualWorkoutIdentityError,
  isReconcileableUniqueConflict,
  keyRowDisagreesWithCanonicalPosition,
  resolveCanonicalWorkoutIdentity,
} from './workout-completion-identity.js';

export const WORKOUT_IDENTITY_COLUMNS = 'id, client_record_id, attachment_id, proof_pending, proof_policy_version, completion_key, week_index, workout_index';

/** Columns required to prove a durable finalized completion after write. */
export const WORKOUT_FINALIZE_VERIFY_COLUMNS = `${WORKOUT_IDENTITY_COLUMNS}, completed_at`;

function normalizeISODate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function selectMaybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

export function createWorkoutFinalizeError(message, details = {}) {
  const error = new Error(message || 'WORKOUT FINALIZATION FAILED — TRY AGAIN.');
  error.workoutFinalizeFailed = true;
  Object.assign(error, details);
  return error;
}

/**
 * Fail closed: a successful cloud save must leave a durable, visible completion row.
 * "No PostgREST error" is not enough — zero-row updates and stranded provisional
 * rows must not report success.
 */
export function assertDurableFinalizedWorkoutRow(row, expectedPayload = {}) {
  if (!row) {
    throw createWorkoutFinalizeError('Workout completion update affected no row.', {
      finalizeReason: 'zero_row',
    });
  }
  // Require literal false — null/undefined must not pass as "finalized".
  if (row.proof_pending !== false) {
    throw createWorkoutFinalizeError('Workout completion remained proof_pending after save.', {
      finalizeReason: 'proof_pending',
      rowId: row.id || null,
    });
  }
  if (
    expectedPayload.completion_key
    && String(row.completion_key || '') !== String(expectedPayload.completion_key)
  ) {
    throw createWorkoutFinalizeError('Workout completion_key mismatch after save.', {
      finalizeReason: 'completion_key',
      rowId: row.id || null,
      expected: expectedPayload.completion_key,
      actual: row.completion_key || null,
    });
  }
  if (
    expectedPayload.week_index !== null
    && expectedPayload.week_index !== undefined
  ) {
    // Number(null) === 0 — reject null/undefined/non-integer before comparing.
    const rowWeek = Number(row.week_index);
    if (
      row.week_index === null
      || row.week_index === undefined
      || !Number.isInteger(rowWeek)
      || rowWeek !== Number(expectedPayload.week_index)
    ) {
      throw createWorkoutFinalizeError('Workout week_index mismatch after save.', {
        finalizeReason: 'week_index',
        rowId: row.id || null,
      });
    }
  }
  if (
    expectedPayload.workout_index !== null
    && expectedPayload.workout_index !== undefined
  ) {
    const rowWorkout = Number(row.workout_index);
    if (
      row.workout_index === null
      || row.workout_index === undefined
      || !Number.isInteger(rowWorkout)
      || rowWorkout !== Number(expectedPayload.workout_index)
    ) {
      throw createWorkoutFinalizeError('Workout workout_index mismatch after save.', {
        finalizeReason: 'workout_index',
        rowId: row.id || null,
      });
    }
  }
  if (!row.completed_at) {
    throw createWorkoutFinalizeError('Workout completed_at missing after save.', {
      finalizeReason: 'completed_at',
      rowId: row.id || null,
    });
  }
  if (
    expectedPayload.attachment_id
    && String(row.attachment_id || '') !== String(expectedPayload.attachment_id)
  ) {
    throw createWorkoutFinalizeError('Workout attachment_id mismatch after save.', {
      finalizeReason: 'attachment_id',
      rowId: row.id || null,
      expected: expectedPayload.attachment_id,
      actual: row.attachment_id || null,
    });
  }
  return row;
}

/**
 * Position is primary when valid week/workout exist.
 * Dual-row disagreement (positional id != completion_key id) is an explicit conflict.
 */
export async function findWorkoutCompletionIdentity(
  client,
  userId,
  record,
  columns = WORKOUT_IDENTITY_COLUMNS,
) {
  const identity = resolveCanonicalWorkoutIdentity(record);

  if (identity.source === 'week_workout') {
    const positional = await selectMaybeSingle(
      client
        .from('workout_completions')
        .select(columns)
        .eq('user_id', userId)
        .eq('week_index', identity.weekIndex)
        .eq('workout_index', identity.workoutIndex),
    );

    const byKey = identity.completionKey
      ? await selectMaybeSingle(
        client
          .from('workout_completions')
          .select(columns)
          .eq('user_id', userId)
          .eq('completion_key', identity.completionKey),
      )
      : null;

    if (positional && byKey && positional.id !== byKey.id) {
      throw createDualWorkoutIdentityError(positional, byKey, 'dual_row');
    }
    if (positional) return positional;
    if (byKey) {
      // Position is canonical. A key hit at a different stored position is an
      // explicit conflict — never silently move that row into the requested slot.
      if (keyRowDisagreesWithCanonicalPosition(byKey, identity)) {
        throw createDualWorkoutIdentityError(null, byKey, 'key_position_mismatch');
      }
      return byKey;
    }
    return null;
  }

  if (identity.completionKey) {
    return selectMaybeSingle(
      client
        .from('workout_completions')
        .select(columns)
        .eq('user_id', userId)
        .eq('completion_key', identity.completionKey),
    );
  }

  return null;
}

async function updateWorkoutCompletionById(client, id, payload) {
  const { data, error } = await client
    .from('workout_completions')
    .update(payload)
    .eq('id', id)
    .select(WORKOUT_FINALIZE_VERIFY_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return assertDurableFinalizedWorkoutRow(data, payload);
}

function mergePreservedAttachmentFields(payload, existing) {
  const next = { ...payload };
  if (!next.attachment_id && existing?.attachment_id) {
    next.attachment_id = existing.attachment_id;
  }
  if (!next.proof_policy_version && existing?.proof_policy_version) {
    next.proof_policy_version = existing.proof_policy_version;
  }
  return next;
}

async function applyStagingPlan(client, userId, record, existing, staging) {
  if (staging.action === 'skip' || staging.action === 'noop') {
    return {
      clientRecordId: staging.clientRecordId,
      created: false,
      rollbackOwned: false,
      reused: !!existing,
      action: staging.action,
    };
  }

  if (staging.action === 'patch-client-id') {
    const { error } = await client
      .from('workout_completions')
      .update({
        client_record_id: staging.clientRecordId,
        completion_key: staging.completionKey,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) throw error;
    return {
      clientRecordId: staging.clientRecordId,
      created: false,
      rollbackOwned: false,
      reused: true,
      action: staging.action,
    };
  }

  const payload = buildProvisionalWorkoutCloudPayload({ ...record, id: staging.clientRecordId }, userId);
  if (staging.action === 'refresh-provisional') {
    const { error } = await client
      .from('workout_completions')
      .update({
        client_record_id: staging.clientRecordId,
        completion_key: payload.completion_key,
        week_index: payload.week_index,
        workout_index: payload.workout_index,
        week_label: payload.week_label,
        week_title: payload.week_title,
        day_of_week: payload.day_of_week,
        workout_type: payload.workout_type,
        description: payload.description,
        warmup: payload.warmup,
        target_zone: payload.target_zone,
        target_bpm: payload.target_bpm,
        proof_pending: true,
        record_json: payload.record_json,
        updated_at: payload.updated_at,
      })
      .eq('id', existing.id)
      .eq('proof_pending', true);
    if (error) throw error;
    return {
      clientRecordId: staging.clientRecordId,
      created: false,
      rollbackOwned: false,
      reused: true,
      action: staging.action,
    };
  }

  const { error } = await client
    .from('workout_completions')
    .insert(payload);
  if (!error) {
    return {
      clientRecordId: staging.clientRecordId,
      created: true,
      rollbackOwned: true,
      reused: false,
      action: staging.action,
    };
  }

  if (!isReconcileableUniqueConflict(error)) throw error;
  const raced = await findWorkoutCompletionIdentity(client, userId, record);
  if (!raced) throw error;
  const racedStaging = planWorkoutIdentityStaging(raced, record);
  return applyStagingPlan(client, userId, record, raced, racedStaging);
}

export async function ensureWorkoutIdentityReconciled(client, userId, record) {
  if (!client || !userId || !record?.id) {
    return {
      clientRecordId: '',
      created: false,
      rollbackOwned: false,
      reused: false,
      action: 'skip',
    };
  }

  const existing = await findWorkoutCompletionIdentity(client, userId, record);
  const staging = planWorkoutIdentityStaging(existing, record);
  return applyStagingPlan(client, userId, record, existing, staging);
}

export async function rollbackWorkoutIdentityIfOwned(client, userId, record, staging = {}) {
  if (!canRollbackProvisionalStaging(staging)) return false;
  if (!client || !userId || !record?.id) return false;
  if (!getCompletionKeyFromRecord(record)) return false;

  const data = await findWorkoutCompletionIdentity(client, userId, record, 'id, proof_pending');
  if (!canRollbackProvisionalStaging(staging, data)) return false;

  const { error } = await client
    .from('workout_completions')
    .delete()
    .eq('id', data.id)
    .eq('proof_pending', true);
  if (error) throw error;
  return true;
}

export async function saveWorkoutCompletionReconciled(client, userId, record) {
  if (!client || !userId || !record) return null;
  const payload = buildWorkoutCloudPayload(record, userId);
  if (!payload.completion_key) return null;
  if (payload.completed_at === null && record.completedAt) {
    payload.completed_at = normalizeISODate(record.completedAt || record.date);
  }

  const existing = await findWorkoutCompletionIdentity(client, userId, record);
  if (existing) {
    const merged = mergePreservedAttachmentFields(payload, existing);
    const verified = await updateWorkoutCompletionById(client, existing.id, merged);
    return {
      record,
      rowId: verified.id,
      action: 'update',
      payload: merged,
      verified,
    };
  }

  const { data, error } = await client
    .from('workout_completions')
    .upsert(payload, { onConflict: 'user_id,completion_key' })
    .select(WORKOUT_FINALIZE_VERIFY_COLUMNS)
    .maybeSingle();

  if (!error) {
    const verified = assertDurableFinalizedWorkoutRow(data, payload);
    return {
      record,
      rowId: verified.id,
      action: 'upsert',
      payload,
      verified,
    };
  }

  if (!isReconcileableUniqueConflict(error)) throw error;

  const raced = await findWorkoutCompletionIdentity(client, userId, record);
  if (!raced) throw error;
  const merged = mergePreservedAttachmentFields(payload, raced);
  const verified = await updateWorkoutCompletionById(client, raced.id, merged);
  return {
    record,
    rowId: verified.id,
    action: 'race-update',
    payload: merged,
    verified,
  };
}
