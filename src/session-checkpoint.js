import { ACTIVE_SESSION_KEY_PREFIX, ACTIVE_SESSION_MAX_AGE_MS, LEGACY_ACTIVE_SESSION_STORAGE_KEY } from './constants.js';
import { getCurrentUser } from './auth.js';
import {
  listStorageKeys,
  probeStorageWrite,
  readJSONValue,
  removeStorageKey,
  writeJSON,
} from './safe-storage.js';

export const CHECKPOINT_VERSION = 1;

const RESUMABLE_PHASES = new Set([
  'idle',
  'sprinting',
  'resting',
  'manual-entry',
]);

function readJSON(key, fallback) {
  return readJSONValue(key, fallback);
}

function activeSessionStorageKey(userId) {
  return `${ACTIVE_SESSION_KEY_PREFIX}${userId}`;
}

function resolveCheckpointUserId(explicitUserId) {
  const userId = String(explicitUserId || getCurrentUser()?.id || '').trim();
  return userId || '';
}

function discardCheckpoint(userId = resolveCheckpointUserId()) {
  if (!userId) return;
  const result = removeStorageKey(activeSessionStorageKey(userId));
  if (!result.ok) {
    console.warn('Could not discard active sprint session checkpoint', result.error);
  }
}

export function isCheckpointStorageAvailable() {
  return probeStorageWrite().ok;
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

export function buildActiveSessionCheckpoint(cfg, state, timer = null, userId = resolveCheckpointUserId()) {
  const now = new Date().toISOString();
  return {
    version: CHECKPOINT_VERSION,
    userId,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
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

function validateCheckpointOwnership(checkpoint) {
  const currentUserId = resolveCheckpointUserId();
  if (!currentUserId) return false;
  if (!checkpoint?.userId || checkpoint.userId !== currentUserId) {
    if (checkpoint?.userId) discardCheckpoint(checkpoint.userId);
    return false;
  }
  return true;
}

export function loadActiveSessionCheckpoint(userId = resolveCheckpointUserId()) {
  if (!userId) return null;

  // Remove pre-account-scoping global checkpoint; never resume cross-account.
  const legacyResult = removeStorageKey(LEGACY_ACTIVE_SESSION_STORAGE_KEY);
  if (!legacyResult.ok && legacyResult.code !== 'storage_unavailable') {
    console.warn('Could not clear legacy active sprint session', legacyResult.error);
  }

  const checkpoint = readJSON(activeSessionStorageKey(userId), null);
  if (!checkpoint || typeof checkpoint !== 'object') return null;
  if (checkpoint.version !== CHECKPOINT_VERSION) return null;
  if (!checkpoint.cfg || !checkpoint.state) return null;
  if (!validateCheckpointOwnership(checkpoint)) return null;
  return checkpoint;
}

export function saveActiveSessionCheckpoint(cfg, state, timer = null) {
  const userId = resolveCheckpointUserId();
  if (!userId || !cfg || !state) return null;
  if (state.phase === 'done') {
    clearActiveSessionCheckpoint(userId);
    return null;
  }

  const existing = readJSON(activeSessionStorageKey(userId), null);
  const checkpoint = buildActiveSessionCheckpoint(cfg, state, timer, userId);
  if (existing?.createdAt) checkpoint.createdAt = existing.createdAt;

  const writeResult = writeJSON(activeSessionStorageKey(userId), checkpoint);
  if (!writeResult.ok) {
    console.warn('Could not persist active sprint session', writeResult.error);
    checkpoint.storageWriteFailed = true;
    checkpoint.storageWriteCode = writeResult.code;
    return checkpoint;
  }
  return checkpoint;
}

export function clearActiveSessionCheckpoint(userId = resolveCheckpointUserId()) {
  if (userId) {
    discardCheckpoint(userId);
    return;
  }
  clearActiveSessionCheckpointsForAllUsers();
}

export function clearActiveSessionCheckpointsForAllUsers() {
  removeStorageKey(LEGACY_ACTIVE_SESSION_STORAGE_KEY);
  const listed = listStorageKeys(ACTIVE_SESSION_KEY_PREFIX);
  if (!listed.ok) {
    console.warn('Could not clear active sprint session checkpoints', listed.error);
    return;
  }
  listed.value.forEach((key) => {
    removeStorageKey(key);
  });
}

export function hasActiveSessionCheckpoint(userId = resolveCheckpointUserId()) {
  return !!loadActiveSessionCheckpoint(userId);
}

export function isCheckpointResumable(checkpoint, nowMs = Date.now()) {
  if (!checkpoint?.cfg || !checkpoint?.state) return false;
  if (!validateCheckpointOwnership(checkpoint)) return false;
  if (!RESUMABLE_PHASES.has(checkpoint.state.phase)) return false;

  const savedAt = new Date(checkpoint.updatedAt || checkpoint.savedAt || '').getTime();
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

export function resolveRestCaptureAttempted(timerCheckpoint, pendingRep) {
  return !!(timerCheckpoint?.captureAttempted || (pendingRep && pendingRep.restHR !== null));
}
