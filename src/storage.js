import { STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY } from './constants.js';
import { calculateAvgDrop, calculatePeakHR } from './workout.js';

const MAX_STORED_SESSIONS = 50;

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

export function saveSessionToHistory(cfg, data) {
  try {
    const sessions = readJSON(STORAGE_KEY, []);
    const record = buildSessionRecord(cfg, data);
    sessions.unshift(record);
    if (sessions.length > MAX_STORED_SESSIONS) sessions.length = MAX_STORED_SESSIONS;
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
  writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, completions);
  return completed;
}

export function removeWorkoutCompletion(weekIndex, workoutIndex) {
  const key = getWorkoutCompletionKey(weekIndex, workoutIndex);
  if (!key) return false;

  const completions = getWorkoutCompletions();
  if (!completions[key]) return false;

  delete completions[key];
  writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, completions);
  return true;
}