import { STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY } from './constants.js';
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
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (err) {
    console.warn(`Could not read ${key}`, err);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function cloneCaptureProvenance(capture) {
  if (!capture || typeof capture !== 'object') return null;
  return {
    mode: capture.mode,
    source: capture.source,
    capturedAt: capture.capturedAt ?? null,
    sampleSequence: capture.sampleSequence ?? null,
    windowStartSequence: capture.windowStartSequence ?? null,
    captureAtRestSec: capture.captureAtRestSec ?? null,
  };
}

function cloneSessionData(data) {
  return (Array.isArray(data) ? data : []).map((d) => ({
    sprintHR: d.sprintHR,
    restHR: d.restHR,
    drop: d.drop,
    suspicious: !!d.suspicious,
    sprintCapture: cloneCaptureProvenance(d.sprintCapture),
    restCapture: cloneCaptureProvenance(d.restCapture),
  }));
}

function cloneConfig(cfg) {
  return {
    reps: cfg.reps,
    rest: cfg.rest,
    maxHR: cfg.maxHR,
    targetPct: cfg.targetPct,
    workoutContext: cfg.workoutContext
      ? JSON.parse(JSON.stringify(cfg.workoutContext))
      : null,
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

export function saveSessionToHistory(cfg, data) {
  try {
    const sessions = readJSON(STORAGE_KEY, []);
    const record = buildSessionRecord(cfg, data);
    sessions.unshift(record);
    if (sessions.length > MAX_STORED_SESSIONS) {
      sessions.length = MAX_STORED_SESSIONS;
    }
    writeJSON(STORAGE_KEY, sessions);
    return record;
  } catch (err) {
    console.warn('Could not save session history', err);
    return buildSessionRecord(cfg, data);
  }
}

export function getWorkoutCompletionKey(weekIndex, workoutIndex) {
  const week = Number(weekIndex);
  const workout = Number(workoutIndex);
  if (!Number.isFinite(week) || !Number.isFinite(workout)) return '';
  return `${week}:${workout}`;
}

function getCompletionKeyFromRecord(record) {
  const context =
    record?.cfg?.workoutContext ||
    record?.workoutContext ||
    null;
  if (!context) return '';
  return getWorkoutCompletionKey(
    context.weekIndex,
    context.workoutIndex
  );
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

export function isWorkoutCompletionCleared(
  weekIndexOrKey,
  workoutIndex,
  cloudUpdatedAt = ''
) {
  const key =
    typeof weekIndexOrKey === 'string' &&
    String(weekIndexOrKey).includes(':')
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

export function markWorkoutCompletionCleared(
  weekIndex,
  workoutIndex
) {
  const key = getWorkoutCompletionKey(
    weekIndex,
    workoutIndex
  );
  if (!key) return '';
  const cleared = getClearedWorkoutCompletions();
  const stamp = new Date().toISOString();
  cleared[key] = stamp;
  writeJSON(CLEARED_COMPLETIONS_KEY, cleared);
  return stamp;
}

export function clearWorkoutCompletionClearedMarker(
  weekIndex,
  workoutIndex
) {
  const key = getWorkoutCompletionKey(
    weekIndex,
    workoutIndex
  );
  if (!key) return;
  const cleared = getClearedWorkoutCompletions();
  if (!(key in cleared)) return;
  delete cleared[key];
  writeJSON(CLEARED_COMPLETIONS_KEY, cleared);
}

export function saveWorkoutCompletion(record) {
  const key = getCompletionKeyFromRecord(record);
  if (!key) return null;
  const completions = getWorkoutCompletions();
  const completed = {
    ...record,
    completionKey: key,
    completedAt: new Date().toISOString(),
  };
  completions[key] = completed;
  writeJSON(
    WORKOUT_COMPLETIONS_STORAGE_KEY,
    completions
  );
  const context =
    record?.workoutContext ||
    record?.cfg?.workoutContext ||
    {};
  clearWorkoutCompletionClearedMarker(
    context.weekIndex,
    context.workoutIndex
  );
  return completed;
}

export function removeWorkoutCompletion(
  weekIndex,
  workoutIndex
) {
  const key = getWorkoutCompletionKey(
    weekIndex,
    workoutIndex
  );
  if (!key) return;
  const completions = getWorkoutCompletions();
  if (!completions[key]) return false;
  delete completions[key];
  writeJSON(
    WORKOUT_COMPLETIONS_STORAGE_KEY,
    completions
  );
  return true;
}
