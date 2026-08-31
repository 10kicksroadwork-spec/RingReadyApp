import { ACTIVE_SESSION_STORAGE_KEY, ACTIVE_SESSION_MAX_AGE_MS } from './constants.js';

export const CHECKPOINT_VERSION = 1;

const RESUMABLE_PHASES = new Set([
  'idle',
  'sprinting',
  'resting',
  'manual-entry',
]);

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

function clonePendingRep(pendingRep) {
  if (!pendingRep) return null;
  return {
    sprintHR: pendingRep.sprintHR ?? null,
    restHR: pendingRep.restHR ?? null,
    drop: pendingRep.drop ?? null,
    suspicious: !!pendingRep.suspicious,
    needsManualSprint: !!pendingRep.needsManualSprint,
    needsManualRest: !!pendingRep.needsManualRest,
  };
}

function cloneSessionData(data) {
  return (Array.isArray(data) ? data : []).map((row) => ({
    sprintHR: row.sprintHR,
    restHR: row.restHR,
    drop: row.drop,
    suspicious: !!row.suspicious,
  }));
}

function cloneConfig(cfg) {
  if (!cfg) return null;
  return {
    reps: cfg.reps,
    rest: cfg.rest,
    maxHR: cfg.maxHR,
    targetPct: cfg.targetPct,
    workoutContext: cfg.workoutContext ? { ...cfg.workoutContext } : null,
  };
}

function cloneTimer(timer) {
  if (!timer || !timer.kind) return null;
  return {
    kind: timer.kind,
    startedAt: Number(timer.startedAt) || 0,
    totalRest: Number(timer.totalRest) || 0,
    restCaptureAt: Number(timer.restCaptureAt) || 0,
    captureAttempted: !!timer.captureAttempted,
    delaySec: Number(timer.delaySec) || 0,
  };
}

export function buildActiveSessionCheckpoint(cfg, state, timer = null) {
  return {
    version: CHECKPOINT_VERSION,
    savedAt: new Date().toISOString(),
    cfg: cloneConfig(cfg),
    state: {
      phase: String(state.phase || 'idle'),
      currentRep: Number(state.currentRep) || 0,
      seconds: Number(state.seconds) || 0,
      data: cloneSessionData(state.data),
      pendingRep: clonePendingRep(state.pendingRep),
      awaitingModal: !!state.awaitingModal,
      capturedSprintHR: state.capturedSprintHR ?? null,
      capturedRestHR: state.capturedRestHR ?? null,
    },
    timer: cloneTimer(timer),
  };
}

export function loadActiveSessionCheckpoint() {
  const checkpoint = readJSON(ACTIVE_SESSION_STORAGE_KEY, null);
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  if (checkpoint.version !== CHECKPOINT_VERSION) return null;
  if (!checkpoint.cfg || !checkpoint.state) return null;
  return checkpoint;
}

export function saveActiveSessionCheckpoint(cfg, state, timer = null) {
  if (!cfg || !state) return null;
  if (state.phase === 'done') {
    clearActiveSessionCheckpoint();
    return null;
  }

  const checkpoint = buildActiveSessionCheckpoint(cfg, state, timer);
  try {
    writeJSON(ACTIVE_SESSION_STORAGE_KEY, checkpoint);
  } catch (err) {
    console.warn('Could not persist active sprint session', err);
  }
  return checkpoint;
}

export function clearActiveSessionCheckpoint() {
  try {
    localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch (err) {
    console.warn('Could not clear active sprint session', err);
  }
}

export function hasActiveSessionCheckpoint() {
  return !!loadActiveSessionCheckpoint();
}

export function isCheckpointResumable(checkpoint, nowMs = Date.now()) {
  if (!checkpoint?.cfg || !checkpoint?.state) return false;
  if (!RESUMABLE_PHASES.has(checkpoint.state.phase)) return false;

  const savedAt = new Date(checkpoint.savedAt || '').getTime();
  if (!Number.isFinite(savedAt)) return false;
  if (nowMs - savedAt > ACTIVE_SESSION_MAX_AGE_MS) return false;

  const reps = Number(checkpoint.cfg.reps);
  if (!Number.isFinite(reps) || reps < 1) return false;

  const currentRep = Number(checkpoint.state.currentRep) || 0;
  if (currentRep > reps) return false;

  const completed = Array.isArray(checkpoint.state.data) ? checkpoint.state.data.length : 0;
  if (completed > currentRep) return false;

  return true;
}

export function checkpointHasProgress(checkpoint) {
  if (!checkpoint?.state) return false;
  if (checkpoint.state.phase !== 'idle') return true;
  if ((Number(checkpoint.state.currentRep) || 0) > 0) return true;
  return Array.isArray(checkpoint.state.data) && checkpoint.state.data.length > 0;
}
