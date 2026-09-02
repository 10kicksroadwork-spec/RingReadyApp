import { STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY } from './constants.js';
import { readJSONValue, writeJSON } from './safe-storage.js';
import { calculateAvgDrop, calculatePeakHR } from './workout.js';

const MAX_STORED_SESSIONS = 50;
const CLEARED_COMPLETIONS_KEY = 'ringReadyClearedWorkoutCompletions';

function makeLocalId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readJSON(key, fallback) {
  return readJSONValue(key, fallback);
}

function persistJSON(key, value) {
  const result = writeJSON(key, value);
  if (!result.ok) {
    console.warn(`Could not write ${key}`, result.error);
    return { logicalOk: false, persisted: false };
  }
  return { logicalOk: true, persisted: result.persisted === true };
}

function cloneSessionData(data) {
  return data.map((d) => ({
    sprintHR: d.sprintHR,
    restHR: d.restHR,
    drop: d.drop,
    suspicious: !!d.suspicious,
  }));
}

function cloneConfig(cfg) {
  return {
    reps: cfg.reps,
    rest: cfg.rest,
    maxHR: cfg.maxHR,
    targetPct: cfg.targetPct,
    workoutContext: cfg.workoutContext ? { ...cfg.workoutContext } : null,
  };
}

export function buildSessionRecord(cfg, data) {
  const sessionData = cloneSessionData(data);
  return {
    id: makeLocalId(),
    date: new Date().toISOString(),
    cfg: cloneConfig(cfg),
    data: sessionData,
    avgDrop: calculateAvgDrop(sessionData),
    peakHR: calculatePeakHR(sessionData),
  };
}

export function persistSessionRecord(record) {
  try {
    const sessions = readJSON(STORAGE_KEY, []);
    sessions.unshift(record);
    if (sessions.length > MAX_STORED_SESSIONS) sessions.length = MAX_STORED_SESSIONS;
    const cache = persistJSON(STORAGE_KEY, sessions);
    if (!cache.persisted) {
      console.warn('Could not save session history locally');
    }
    return { record, localCacheOk: cache.persisted, ...cache };
  } catch (err) {
    console.warn('Could not save session history', err);
    return { record, localCacheOk: false, logicalOk: false, persisted: false };
  }
}

export function persistSessionToHistory(cfg, data) {
  return persistSessionRecord(buildSessionRecord(cfg, data));
}

export function saveSessionToHistory(cfg, data) {
  return persistSessionToHistory(cfg, data).record;
}

export function finalizeWorkoutCompletionRecord(record) {
  const key = getCompletionKeyFromRecord(record);
  if (!key) return null;
  return {
    ...record,
    completionKey: key,
    completedAt: record?.completedAt || new Date().toISOString(),
  };
}

export function persistWorkoutCompletion(record) {
  const finalized = finalizeWorkoutCompletionRecord(record);
  if (!finalized) {
    return { record: null, localCacheOk: false, logicalOk: false, persisted: false };
  }

  const completions = getWorkoutCompletions();
  completions[finalized.completionKey] = finalized;
  const cache = persistJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, completions);
  const context = record?.workoutContext || record?.cfg?.workoutContext || {};
  if (cache.logicalOk) {
    clearWorkoutCompletionClearedMarker(context.weekIndex, context.workoutIndex);
  }
  return {
    record: finalized,
    localCacheOk: cache.persisted,
    logicalOk: cache.logicalOk,
    persisted: cache.persisted,
  };
}

export function getWorkoutCompletionKey(weekIndex, workoutIndex) {
  const week = Number(weekIndex);
  const workout = Number(workoutIndex);
  if (!Number.isFinite(week) || !Number.isFinite(workout)) return '';
  return `${week}:${workout}`;
}

function getCompletionKeyFromRecord(record) {
  const context = record?.cfg?.workoutContext || record?.workoutContext || null;
  if (!context) return '';
  return getWorkoutCompletionKey(context.weekIndex, context.workoutIndex);
}

export function getWorkoutCompletions() {
  return readJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, {});
}

export function getWorkoutCompletion(weekIndex, workoutIndex) {
  const key = getWorkoutCompletionKey(weekIndex, workoutIndex);
  if (!key) return null;
  return getWorkoutCompletions()[key] || null;
}

export function getClearedWorkoutCompletions() {
  return readJSON(CLEARED_COMPLETIONS_KEY, {});
}

export function isWorkoutCompletionCleared(weekIndexOrKey, workoutIndex, cloudUpdatedAt = '') {
  const key = typeof weekIndexOrKey === 'string' && String(weekIndexOrKey).includes(':')
    ? String(weekIndexOrKey)
    : getWorkoutCompletionKey(weekIndexOrKey, workoutIndex);
  if (!key) return false;
  const cleared = getClearedWorkoutCompletions()[key];
  if (!cleared) return false;
  if (!cloudUpdatedAt) return true;
  const clearedTime = new Date(cleared).getTime();
  const compareTime = new Date(cloudUpdatedAt).getTime();
  if (!Number.isFinite(clearedTime)) return true;
  if (!Number.isFinite(compareTime)) return true;
  return clearedTime >= compareTime;
}

export function markWorkoutCompletionCleared(weekIndex, workoutIndex) {
  const key = getWorkoutCompletionKey(weekIndex, workoutIndex);
  if (!key) return '';
  const cleared = getClearedWorkoutCompletions();
  const stamp = new Date().toISOString();
  cleared[key] = stamp;
  persistJSON(CLEARED_COMPLETIONS_KEY, cleared);
  return stamp;
}

export function clearWorkoutCompletionClearedMarker(weekIndex, workoutIndex) {
  const key = getWorkoutCompletionKey(weekIndex, workoutIndex);
  if (!key) return { logicalOk: false, persisted: false };
  const cleared = getClearedWorkoutCompletions();
  if (!(key in cleared)) return { logicalOk: true, persisted: true };
  delete cleared[key];
  return persistJSON(CLEARED_COMPLETIONS_KEY, cleared);
}

export function saveWorkoutCompletion(record) {
  return persistWorkoutCompletion(record).record;
}

export function removeWorkoutCompletion(weekIndex, workoutIndex) {
  const key = getWorkoutCompletionKey(weekIndex, workoutIndex);
  if (!key) return { logicalOk: false, persisted: false };

  const completions = getWorkoutCompletions();
  if (!completions[key]) return { logicalOk: false, persisted: false };

  delete completions[key];
  return persistJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, completions);
}
