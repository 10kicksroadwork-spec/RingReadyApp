/** Cloud payload builders shared by auth saves and proof-identity tests. */

import { readOutputFromWorkoutLog } from './modality.js';
import { resolveCanonicalWorkoutIdentity } from './workout-completion-identity.js';

function textOrEmpty(value) {
  return String(value || '').trim();
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed);
}

function normalizeISODate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function getRecordContext(record = {}) {
  return record?.cfg?.workoutContext || record?.workoutContext || {};
}

export function getCompletionKeyFromRecord(record = {}) {
  return resolveCanonicalWorkoutIdentity(record).completionKey;
}

export { resolveCanonicalWorkoutIdentity };

export function buildWorkoutCloudPayload(record, userId) {
  const context = getRecordContext(record);
  const identity = resolveCanonicalWorkoutIdentity(record);
  const workoutLog = record.workoutLog || null;
  const output = readOutputFromWorkoutLog(workoutLog || {});
  return {
    user_id: userId,
    client_record_id: textOrEmpty(record.id),
    completion_key: identity.completionKey,
    week_index: identity.weekIndex,
    workout_index: identity.workoutIndex,
    week_label: textOrEmpty(context.weekLabel),
    week_title: textOrEmpty(context.weekTitle),
    day_of_week: textOrEmpty(context.dayOfWeek),
    workout_type: textOrEmpty(context.workoutType),
    description: textOrEmpty(context.description),
    warmup: textOrEmpty(context.warmup),
    target_zone: textOrEmpty(context.targetZone),
    target_bpm: integerOrNull(context.targetBPM),
    total_minutes: workoutLog ? numberOrNull(workoutLog.totalMinutes) : null,
    total_seconds: workoutLog ? integerOrNull(workoutLog.totalSeconds) : null,
    avg_bpm: workoutLog ? integerOrNull(workoutLog.avgBpm) : null,
    max_bpm: workoutLog ? integerOrNull(workoutLog.maxBpm) : null,
    modality: output.modality,
    output_type: output.outputType,
    output_value: output.outputValue,
    avg_watts: output.outputType === 'watts' ? output.outputValue : numberOrNull(workoutLog?.avgWatts),
    distance: output.outputType === 'distance' ? output.outputValue : null,
    completed_at: workoutLog?.completedAt
      ? normalizeISODate(workoutLog.completedAt)
      : (record.completedAt || record.date ? normalizeISODate(record.completedAt || record.date) : null),
    proof_policy_version: integerOrNull(record.proofPolicyVersion),
    attachment_id: record.attachment?.id || null,
    proof_pending: false,
    record_json: record,
    updated_at: new Date().toISOString(),
  };
}

/** Client-local retry metadata must never cross the cloud boundary. */
export function stripClientSprintMetadata(record = {}) {
  if (!record || typeof record !== 'object') return {};
  const cloudSafeRecord = { ...record };
  delete cloudSafeRecord.cloudPending;
  return cloudSafeRecord;
}

export function mapCloudSprintSessionRow(row, parseJSON = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}) {
  if (!row) return null;
  const record = stripClientSprintMetadata(parseJSON(row.session_json, {}));
  return {
    ...record,
    id: record.id || row.session_id || row.id,
    date: row.session_at || record.date || row.created_at,
    avgDrop: record.avgDrop ?? row.avg_drop ?? null,
    peakHR: record.peakHR ?? row.peak_hr ?? null,
  };
}

export function buildSprintCloudPayload(record, userId) {
  const cloudSafeRecord = stripClientSprintMetadata(record);
  const context = getRecordContext(cloudSafeRecord);
  const data = Array.isArray(cloudSafeRecord.data) ? cloudSafeRecord.data : [];
  return {
    user_id: userId,
    session_id: String(cloudSafeRecord.id || globalThis.crypto?.randomUUID?.() || Date.now()),
    session_at: normalizeISODate(cloudSafeRecord.date || cloudSafeRecord.completedAt),
    week_index: integerOrNull(context.weekIndex),
    workout_index: integerOrNull(context.workoutIndex),
    workout_type: textOrEmpty(context.workoutType || 'Sprint Intervals'),
    hr_source: textOrEmpty(cloudSafeRecord.hrSource || cloudSafeRecord.cfg?.hrSource || ''),
    reps_planned: integerOrNull(cloudSafeRecord.cfg?.reps || context.reps),
    rest_seconds: integerOrNull(cloudSafeRecord.cfg?.rest || context.restSeconds),
    max_hr: integerOrNull(cloudSafeRecord.cfg?.maxHR),
    target_pct: numberOrNull(cloudSafeRecord.cfg?.targetPct || context.targetPct),
    target_bpm: integerOrNull(context.targetBPM),
    intervals_completed: data.length,
    avg_drop: numberOrNull(cloudSafeRecord.avgDrop),
    peak_hr: integerOrNull(cloudSafeRecord.peakHR),
    proof_policy_version: integerOrNull(cloudSafeRecord.proofPolicyVersion),
    attachment_id: cloudSafeRecord.attachment?.id || null,
    session_json: cloudSafeRecord,
    updated_at: new Date().toISOString(),
  };
}

export function buildMileTestCloudPayload(result, hrInfo, testContext, userId) {
  const testKey = String(testContext?.testKey || result.testKey || 'mile-test:baseline');
  const resultWithContext = { ...result, testKey };
  return {
    user_id: userId,
    client_record_id: textOrEmpty(result.id),
    test_key: testKey,
    saved_at: normalizeISODate(result.savedAt),
    distance: numberOrNull(result.distance),
    total_minutes: numberOrNull(result.totalMinutes),
    total_seconds: integerOrNull(result.totalSeconds),
    pace_min_per_mile: numberOrNull(result.paceMinPerMile),
    avg_bpm: integerOrNull(result.avgBpm),
    max_bpm: integerOrNull(result.maxBpm),
    proof_policy_version: integerOrNull(result.proofPolicyVersion),
    attachment_id: result.attachment?.id || null,
    proof_pending: false,
    result_json: resultWithContext,
    hr_info_json: hrInfo || null,
    test_context_json: testContext || null,
    updated_at: new Date().toISOString(),
  };
}

export function buildProvisionalWorkoutCloudPayload(record, userId) {
  const context = getRecordContext(record);
  const identity = resolveCanonicalWorkoutIdentity(record);
  return {
    user_id: userId,
    client_record_id: textOrEmpty(record.id),
    completion_key: identity.completionKey,
    week_index: identity.weekIndex,
    workout_index: identity.workoutIndex,
    week_label: textOrEmpty(context.weekLabel),
    week_title: textOrEmpty(context.weekTitle),
    day_of_week: textOrEmpty(context.dayOfWeek),
    workout_type: textOrEmpty(context.workoutType),
    description: textOrEmpty(context.description),
    warmup: textOrEmpty(context.warmup),
    target_zone: textOrEmpty(context.targetZone),
    target_bpm: integerOrNull(context.targetBPM),
    total_minutes: null,
    total_seconds: null,
    avg_bpm: null,
    max_bpm: null,
    distance: null,
    completed_at: null,
    proof_policy_version: null,
    attachment_id: null,
    proof_pending: true,
    record_json: {
      id: record.id,
      status: 'pending_proof',
      workoutContext: context,
      cfg: { workoutContext: context },
    },
    updated_at: new Date().toISOString(),
  };
}

export function buildProvisionalMileTestCloudPayload(result, testContext, userId) {
  const testKey = String(testContext?.testKey || result.testKey || 'mile-test:baseline');
  return {
    user_id: userId,
    client_record_id: textOrEmpty(result.id),
    test_key: testKey,
    saved_at: null,
    distance: null,
    total_minutes: null,
    total_seconds: null,
    pace_min_per_mile: null,
    avg_bpm: null,
    max_bpm: null,
    proof_policy_version: null,
    attachment_id: null,
    proof_pending: true,
    result_json: {
      id: result.id,
      testKey,
      status: 'pending_proof',
    },
    hr_info_json: null,
    test_context_json: testContext || null,
    updated_at: new Date().toISOString(),
  };
}

export function buildWorkoutIdentityRecord(record) {
  const context = getRecordContext(record);
  return {
    id: record.id,
    status: 'pending_proof',
    workoutContext: record.workoutContext || context,
    cfg: record.cfg || { workoutContext: context },
  };
}

export function buildMileTestIdentityResult(result, testContext) {
  return {
    ...result,
    testKey: testContext?.testKey || result.testKey,
    savedAt: result.savedAt || new Date().toISOString(),
  };
}
