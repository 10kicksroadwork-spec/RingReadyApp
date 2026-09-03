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

function normalizeISODate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

async function selectMaybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
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
  const { error } = await client
    .from('workout_completions')
    .update(payload)
    .eq('id', id);
  if (error) throw error;
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
    await updateWorkoutCompletionById(
      client,
      existing.id,
      mergePreservedAttachmentFields(payload, existing),
    );
    return {
      record,
      rowId: existing.id,
      action: 'update',
      payload: mergePreservedAttachmentFields(payload, existing),
    };
  }

  const { data, error } = await client
    .from('workout_completions')
    .upsert(payload, { onConflict: 'user_id,completion_key' })
    .select('id')
    .maybeSingle();

  if (!error) {
    return {
      record,
      rowId: data?.id || null,
      action: 'upsert',
      payload,
    };
  }

  if (!isReconcileableUniqueConflict(error)) throw error;

  const raced = await findWorkoutCompletionIdentity(client, userId, record);
  if (!raced) throw error;
  const merged = mergePreservedAttachmentFields(payload, raced);
  await updateWorkoutCompletionById(client, raced.id, merged);
  return {
    record,
    rowId: raced.id,
    action: 'race-update',
    payload: merged,
  };
}
