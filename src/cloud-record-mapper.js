/** Cloud payload builders shared by auth saves and proof-identity tests. */

import {
  MODALITY_RUNNING,
  normalizeModality,
  readOutputFromWorkoutLog,
  validModalityOrNull,
} from './modality.js';

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

function nullablePositiveNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveOrNull(value) {
  return nullablePositiveNumber(value);
}

function normalizeISODate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function buildCanonicalOutputFields(workoutLog) {
  const output = readOutputFromWorkoutLog(workoutLog || {});
  const modality = normalizeModality(output.modality);
  const outputValue = nullablePositiveNumber(output.outputValue);
  return {
    modality,
    output_type: output.outputType || null,
    output_value: outputValue,
    avg_watts: output.outputType === 'watts' ? outputValue : null,
    distance: output.outputType === 'distance' ? outputValue : null,
  };
}

export function buildWorkoutLogFromCloudRow(row = {}, record = {}) {
  const jsonLog = record.workoutLog || {};
  const relationalLog = {
    totalMinutes: row.total_minutes ?? null,
    totalSeconds: row.total_seconds ?? null,
    totalTimeDisplay: jsonLog.totalTimeDisplay || '',
    avgBpm: row.avg_bpm ?? null,
    maxBpm: row.max_bpm ?? null,
    completedAt: row.completed_at ?? null,
    modality: row.modality ?? null,
    outputType: row.output_type ?? null,
    outputValue: row.output_value ?? null,
    distance: row.distance ?? null,
    avgWatts: row.avg_watts ?? null,
  };

  const hasJsonLog = Object.keys(jsonLog).length > 0;
  const merged = {
    ...relationalLog,
    ...(hasJsonLog ? jsonLog : {}),
    modality:
      validModalityOrNull(jsonLog.modality)
      ?? validModalityOrNull(row.modality)
      ?? MODALITY_RUNNING,
    outputType:
      textOrEmpty(jsonLog.outputType) || textOrEmpty(row.output_type) || null,
    outputValue:
      positiveOrNull(jsonLog.outputValue) ?? positiveOrNull(row.output_value),
    avgWatts:
      positiveOrNull(jsonLog.avgWatts) ?? positiveOrNull(row.avg_watts),
    distance:
      positiveOrNull(jsonLog.distance) ?? positiveOrNull(row.distance),
  };

  const output = readOutputFromWorkoutLog(merged);
  const hasMetrics = [
    merged.totalMinutes,
    merged.avgBpm,
    merged.maxBpm,
    output.outputValue,
    merged.completedAt,
  ].some((value) => value != null && value !== '');

  if (!hasMetrics && !hasJsonLog) return null;

  return {
    ...merged,
    modality: output.modality,
    outputType: output.outputType,
    outputValue: output.outputValue,
    avgWatts: output.outputType === 'watts' ? output.outputValue : null,
    distance: output.outputType === 'distance' ? output.outputValue : merged.distance ?? null,
  };
}

export function getRecordContext(record = {}) {
  return record?.cfg?.workoutContext || record?.workoutContext || {};
}

export function getCompletionKeyFromRecord(record = {}) {
  const context = getRecordContext(record);
  if (record.completionKey) return String(record.completionKey);
  if (Number.isFinite(Number(context.weekIndex)) && Number.isFinite(Number(context.workoutIndex))) {
    return `${Number(context.weekIndex)}:${Number(context.workoutIndex)}`;
  }
  return '';
}

export function buildWorkoutCloudPayload(record, userId) {
  const context = getRecordContext(record);
  const workoutLog = record.workoutLog || null;
  const modality = normalizeModality(workoutLog?.modality);
  const outputFields = workoutLog
    ? buildCanonicalOutputFields(workoutLog)
    : {
      modality,
      output_type: null,
      output_value: null,
      avg_watts: null,
      distance: null,
    };

  return {
    user_id: userId,
    client_record_id: textOrEmpty(record.id),
    completion_key: getCompletionKeyFromRecord(record),
    week_index: integerOrNull(context.weekIndex),
    workout_index: integerOrNull(context.workoutIndex),
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
    ...outputFields,
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
  return {
    user_id: userId,
    client_record_id: textOrEmpty(record.id),
    completion_key: getCompletionKeyFromRecord(record),
    week_index: integerOrNull(context.weekIndex),
    workout_index: integerOrNull(context.workoutIndex),
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
    modality: normalizeModality(record.workoutLog?.modality),
    output_type: null,
    output_value: null,
    avg_watts: null,
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
