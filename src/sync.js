import {
  APP_NAME,
  LEGACY_SYNC_QUEUE_KEY,
  LEGACY_SYNC_QUEUE_QUARANTINE_KEY,
  PROFILE_STORAGE_KEY,
  SYNC_ENDPOINT_KEY,
  SYNC_QUEUE_KEY_PREFIX,
} from './constants.js';
import { calculateAvgDrop, calculatePeakHR, isLoggedDrop } from './workout.js';
import { hrState } from './hr-service.js';
import { MODALITY_RUNNING, normalizeModality, readOutputFromWorkoutLog } from './modality.js';
import { getCurrentUser, getAccessToken } from './auth.js';

export const MAX_QUEUE_ITEMS = 50;
export const MAX_SYNC_ATTEMPTS = 5;
const ALLOWED_SYNC_HOST = 'script.google.com';
const ALLOWED_SYNC_PATH = /^\/macros\/s\/[^/]+\/exec$/i;

const PROFILE_DEFAULTS = {
  athleteName: '',
  age: '',
  gender: '',
  genderDetail: '',
  trainingTenure: '',
  primaryDiscipline: '',
  weightClass: '',
  fightDate: '',
  campLength: '7',
  defaultModality: MODALITY_RUNNING,
};

function normalizeCampLength(value) {
  return String(value) === '4' ? '4' : '7';
}

function buildProgramProofKey(campLength, weekIndex, workoutIndex) {
  return `program:${normalizeCampLength(campLength)}:${Number(weekIndex)}:${Number(workoutIndex)}`;
}

function cleanProfile(profile = {}) {
  const cleaned = {
    athleteName: String(profile.athleteName || '').trim(),
    age: String(profile.age || '').trim(),
    gender: String(profile.gender || '').trim(),
    genderDetail: String(profile.genderDetail || '').trim(),
    trainingTenure: String(profile.trainingTenure || '').trim(),
    primaryDiscipline: '',
    weightClass: '',
    fightDate: String(profile.fightDate || '').trim(),
    campLength: normalizeCampLength(profile.campLength || PROFILE_DEFAULTS.campLength),
    defaultModality: normalizeModality(profile.defaultModality || PROFILE_DEFAULTS.defaultModality),
    campResetAt: String(profile.campResetAt || '').trim(),
  };
  const updatedAt = String(profile.updatedAt || profile.updated_at || '').trim();
  if (updatedAt) cleaned.updatedAt = updatedAt;
  return cleaned;
}

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    console.warn(`Could not read ${key}`);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function makeEventId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `rr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isProductionBuild() {
  try {
    return !!(import.meta.env && import.meta.env.PROD);
  } catch {
    return false;
  }
}

function isAllowedSyncEndpoint(value) {
  const trimmed = String(value || '').trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.hostname === ALLOWED_SYNC_HOST && ALLOWED_SYNC_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function getBuildEndpoint() {
  try {
    return import.meta.env && import.meta.env.VITE_RING_READY_SYNC_URL
      ? String(import.meta.env.VITE_RING_READY_SYNC_URL).trim()
      : '';
  } catch {
    return '';
  }
}

export function getSyncEndpoint() {
  const buildEndpoint = getBuildEndpoint();
  if (isProductionBuild()) {
    return buildEndpoint;
  }
  const stored = String(localStorage.getItem(SYNC_ENDPOINT_KEY) || '').trim();
  if (stored && isAllowedSyncEndpoint(stored)) return stored;
  return buildEndpoint;
}

export function applySyncEndpointFromURL() {
  if (isProductionBuild()) {
    localStorage.removeItem(SYNC_ENDPOINT_KEY);
    return;
  }

  const url = new URL(window.location.href);
  const syncUrl = String(url.searchParams.get('syncUrl') || url.searchParams.get('sync_url') || '').trim();
  const clearSyncUrl = url.searchParams.get('clearSyncUrl') === '1';
  let changed = false;

  if (clearSyncUrl) {
    localStorage.removeItem(SYNC_ENDPOINT_KEY);
    changed = true;
  }

  if (syncUrl) {
    if (isAllowedSyncEndpoint(syncUrl)) {
      localStorage.setItem(SYNC_ENDPOINT_KEY, syncUrl);
      changed = true;
    } else {
      console.warn('Rejected sync URL override; endpoint must be a Google Apps Script /exec URL.');
    }
  }

  if (changed) {
    url.searchParams.delete('syncUrl');
    url.searchParams.delete('sync_url');
    url.searchParams.delete('clearSyncUrl');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

function resolveQueueUserId(explicitUserId) {
  return String(explicitUserId || getCurrentUser()?.id || '').trim();
}

function syncQueueStorageKey(userId = resolveQueueUserId()) {
  return userId ? `${SYNC_QUEUE_KEY_PREFIX}${userId}` : '';
}

function normalizeQueueItemStatus(status) {
  if (status === 'sent') return 'dispatched';
  return status || 'pending';
}

function normalizeQueueItem(item = {}) {
  return {
    ...item,
    status: normalizeQueueItemStatus(item.status),
    userId: String(item.userId || '').trim(),
  };
}

function readQueueForUser(userId = resolveQueueUserId()) {
  if (!userId) return [];
  const key = syncQueueStorageKey(userId);
  return readJSON(key, []).map(normalizeQueueItem);
}

export function trimSyncQueue(queue) {
  if (!Array.isArray(queue) || queue.length <= MAX_QUEUE_ITEMS) return queue || [];
  const result = [...queue];
  const removeOldest = (predicate) => {
    for (let i = result.length - 1; i >= 0 && result.length > MAX_QUEUE_ITEMS; i -= 1) {
      if (predicate(result[i])) {
        result.splice(i, 1);
      }
    }
  };
  removeOldest((item) => item.status === 'acknowledged');
  removeOldest((item) => item.status === 'dispatched');
  while (result.length > MAX_QUEUE_ITEMS) {
    let removed = false;
    for (let i = result.length - 1; i >= 0; i -= 1) {
      if (result[i].status === 'acknowledged' || result[i].status === 'dispatched') {
        result.splice(i, 1);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  return result;
}

function saveQueueForUser(queue, userId = resolveQueueUserId()) {
  if (!userId) return;
  writeJSON(syncQueueStorageKey(userId), trimSyncQueue(queue));
}

export function quarantineLegacySyncQueue() {
  const legacy = readJSON(LEGACY_SYNC_QUEUE_KEY, []);
  if (!Array.isArray(legacy) || legacy.length === 0) {
    localStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
    return { quarantined: 0 };
  }

  const existing = readJSON(LEGACY_SYNC_QUEUE_QUARANTINE_KEY, []);
  const merged = [...existing, ...legacy.map((item) => ({ ...item, quarantinedAt: new Date().toISOString() }))];
  writeJSON(LEGACY_SYNC_QUEUE_QUARANTINE_KEY, trimSyncQueue(merged));
  localStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
  return { quarantined: legacy.length };
}

export function getLegacySyncQueueQuarantineCount() {
  const quarantined = readJSON(LEGACY_SYNC_QUEUE_QUARANTINE_KEY, []);
  return Array.isArray(quarantined) ? quarantined.length : 0;
}

export function clearSyncQueueForUser(userId = resolveQueueUserId()) {
  if (!userId) return;
  localStorage.removeItem(syncQueueStorageKey(userId));
}

export function clearAllSyncQueues() {
  clearSyncQueueForUser(resolveQueueUserId());
  localStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
}

export function getAthleteProfile() {
  const saved = readJSON(PROFILE_STORAGE_KEY, {});
  return cleanProfile({ ...PROFILE_DEFAULTS, ...saved });
}

export function saveAthleteProfile(profile, options = {}) {
  const current = getAthleteProfile();
  const next = cleanProfile({ ...current, ...profile });
  if (options.preserveUpdatedAt) {
    const preserved = String(profile.updatedAt || profile.updated_at || current.updatedAt || '').trim();
    if (preserved) next.updatedAt = preserved;
  } else {
    next.updatedAt = new Date().toISOString();
  }
  writeJSON(PROFILE_STORAGE_KEY, next);
  return next;
}

export function getSyncQueue(userId = resolveQueueUserId()) {
  return readQueueForUser(userId);
}

function saveSyncQueue(queue, userId = resolveQueueUserId()) {
  saveQueueForUser(queue, userId);
}

export function getPendingSyncCount(userId = resolveQueueUserId()) {
  return getSyncQueue(userId).filter((item) => item.status === 'pending').length;
}

export function getFailedSyncCount(userId = resolveQueueUserId()) {
  return getSyncQueue(userId).filter((item) => item.status === 'failed' && (item.attempts || 0) >= MAX_SYNC_ATTEMPTS).length;
}

export function getRetryableFailedCount(userId = resolveQueueUserId()) {
  return getSyncQueue(userId).filter((item) => item.status === 'failed' && (item.attempts || 0) < MAX_SYNC_ATTEMPTS).length;
}

export function needsManualSyncRetry(userId = resolveQueueUserId()) {
  return getFailedSyncCount(userId) > 0;
}

function buildProofMetadata(workoutContext = {}, linkedRecordId = '', proofKey = '') {
  const campLength = Number(workoutContext.campLength ?? getAthleteProfile().campLength) || 7;
  const weekIndex = workoutContext.weekIndex;
  const workoutIndex = workoutContext.workoutIndex;
  const resolvedProofKey = proofKey
    || (Number.isFinite(Number(weekIndex)) && Number.isFinite(Number(workoutIndex))
      ? buildProgramProofKey(campLength, weekIndex, workoutIndex)
      : String(workoutContext.testKey || workoutContext.proofKey || ''));
  return {
    linkedRecordId: String(linkedRecordId || workoutContext.linkedRecordId || ''),
    proofKey: resolvedProofKey,
    weekIndex: Number.isFinite(Number(weekIndex)) ? Number(weekIndex) : '',
    workoutIndex: Number.isFinite(Number(workoutIndex)) ? Number(workoutIndex) : '',
  };
}

function buildBasePayload(eventType) {
  const profile = getAthleteProfile();
  const submittedAt = new Date().toISOString();
  const userId = resolveQueueUserId();

  return {
    schemaVersion: 1,
    appName: APP_NAME,
    eventType,
    eventId: makeEventId(),
    userId,
    athleteName: profile.athleteName,
    athleteProfile: profile,
    submittedAt,
    localDate: new Date().toLocaleDateString('en-US'),
    source: 'pwa',
  };
}

export function enqueuePayloadForSync(payload) {
  const userId = resolveQueueUserId();
  if (!userId) {
    console.warn('Cannot enqueue sync payload without authenticated user.');
    return null;
  }

  const queue = getSyncQueue(userId);
  const id = payload.sessionId || payload.linkedRecordId || payload.eventId || makeEventId();
  const item = {
    id,
    userId,
    status: 'pending',
    createdAt: payload.submittedAt || new Date().toISOString(),
    attempts: 0,
    lastError: '',
    payload: { ...payload, eventId: payload.eventId || id, userId },
  };

  queue.unshift(item);
  saveSyncQueue(queue, userId);
  updateSyncStatusUI();
  return item;
}

export function markSyncItemAcknowledged(eventId, userId = resolveQueueUserId()) {
  if (!eventId || !userId) return false;
  const queue = getSyncQueue(userId);
  const item = queue.find((row) => row.id === eventId || row.payload?.eventId === eventId);
  if (!item) return false;
  item.status = 'acknowledged';
  item.acknowledgedAt = new Date().toISOString();
  saveSyncQueue(queue, userId);
  updateSyncStatusUI();
  return true;
}

export function buildSessionPayload(cfg, data, sessionRecord = null) {
  const base = buildBasePayload('sprint_session');
  const workoutContext = cfg.workoutContext || {};
  const workoutType = workoutContext.workoutType || 'Sprint Intervals';
  const targetBPM = Number(workoutContext.targetBPM) || Math.round((cfg.maxHR * cfg.targetPct) / 100);
  const loggedDrops = data
    .map((rep) => rep.drop)
    .filter((drop) => isLoggedDrop(drop))
    .map((drop) => Number(drop));
  const linkedRecordId = String(sessionRecord?.id || base.eventId);
  const proofMeta = buildProofMetadata(workoutContext, linkedRecordId);

  return {
    ...base,
    sessionId: linkedRecordId,
    linkedRecordId: proofMeta.linkedRecordId,
    proofKey: proofMeta.proofKey,
    workoutType,
    workoutContext: Object.keys(workoutContext).length ? workoutContext : null,
    weekTab: workoutContext.weekTab || '',
    dayOfWeek: workoutContext.dayOfWeek || '',
    description: workoutContext.description || '',
    warmup: workoutContext.warmup || '',
    targetZone: workoutContext.targetZone || '',
    hrSource: hrState.source || 'manual',
    config: {
      reps: cfg.reps,
      restSeconds: cfg.rest,
      maxHR: cfg.maxHR,
      targetPct: cfg.targetPct,
      targetBPM,
    },
    summary: {
      intervals: data.length,
      avgDrop: calculateAvgDrop(data),
      peakHR: calculatePeakHR(data),
      bpmDropCsv: loggedDrops.join(', '),
      validDropCount: loggedDrops.length,
    },
    reps: data.map((rep, index) => ({
      rep: index + 1,
      sprintHR: rep.sprintHR,
      restHR: rep.restHR,
      drop: rep.drop,
      suspicious: !!rep.suspicious,
    })),
  };
}

export function enqueueSessionForSync(cfg, data, sessionRecord = null) {
  return enqueuePayloadForSync(buildSessionPayload(cfg, data, sessionRecord));
}

export function buildProfilePayload(profile = getAthleteProfile()) {
  const cleanedProfile = cleanProfile(profile);
  return {
    ...buildBasePayload('profile_update'),
    athleteName: cleanedProfile.athleteName,
    athleteProfile: cleanedProfile,
    profile: cleanedProfile,
  };
}

export function enqueueProfileForSync(profile) {
  return enqueuePayloadForSync(buildProfilePayload(profile));
}

export function buildHRInfoPayload(hrInfo) {
  return {
    ...buildBasePayload('hr_info_update'),
    hrInfo: {
      goalWeight: Number(hrInfo.goalWeight) || '',
      targetDate: String(hrInfo.targetDate || ''),
      maxHr: Number(hrInfo.maxHr) || '',
      restingHr: Number(hrInfo.restingHr) || '',
    },
  };
}

export function enqueueHRInfoForSync(hrInfo) {
  return enqueuePayloadForSync(buildHRInfoPayload(hrInfo));
}

export function buildMileTestPayload(result, hrInfo, testContext = {}) {
  const distance = Number(result.distance) || 0;
  const totalMinutes = Number(result.totalMinutes) || 0;
  const paceMinPerMile = distance > 0 && totalMinutes > 0 ? totalMinutes / distance : '';
  const linkedRecordId = String(result.id || '');
  const proofKey = String(result.testKey || testContext.testKey || testContext.proofKey || 'mile-test:baseline');
  const proofMeta = buildProofMetadata({ ...testContext, testKey: proofKey }, linkedRecordId, proofKey);

  return {
    ...buildBasePayload('mile_test'),
    linkedRecordId: proofMeta.linkedRecordId,
    proofKey: proofMeta.proofKey,
    testContext: Object.keys(testContext).length ? testContext : null,
    test: {
      distance,
      totalMinutes,
      avgBpm: Number(result.avgBpm) || '',
      maxBpm: Number(result.maxBpm) || '',
      paceMinPerMile,
      savedAt: result.savedAt || new Date().toISOString(),
    },
    hrInfo: hrInfo || null,
  };
}

export function enqueueMileTestForSync(result, hrInfo, testContext) {
  return enqueuePayloadForSync(buildMileTestPayload(result, hrInfo, testContext));
}

export function buildDailyWorkoutPayload(workoutLog, workoutContext = {}, linkedRecordId = '') {
  const completedAt = workoutLog.completedAt || new Date().toISOString();
  const isSkip = workoutLog?.status === 'skipped';
  const proofMeta = buildProofMetadata(workoutContext, linkedRecordId);
  const output = readOutputFromWorkoutLog(workoutLog || {});

  return {
    ...buildBasePayload(isSkip ? 'daily_workout_skip' : 'daily_workout'),
    linkedRecordId: proofMeta.linkedRecordId,
    proofKey: proofMeta.proofKey,
    workoutContext: Object.keys(workoutContext).length ? workoutContext : null,
    weekTab: workoutContext.weekTab || '',
    dayOfWeek: workoutContext.dayOfWeek || '',
    workoutType: workoutContext.workoutType || 'Daily Workout',
    description: workoutContext.description || '',
    warmup: workoutContext.warmup || '',
    targetZone: workoutContext.targetZone || '',
    targetBPM: Number(workoutContext.targetBPM) || '',
    modality: normalizeModality(workoutContext.modality || output.modality || MODALITY_RUNNING),
    workoutLog: isSkip
      ? {
        status: 'skipped',
        skipReason: workoutLog.skipReason || '',
        skipReasonLabel: workoutLog.skipReasonLabel || '',
        skipDetail: workoutLog.skipDetail || '',
        coachApproved: !!workoutLog.coachApproved,
        note: workoutLog.note || '',
        completedAt,
      }
      : {
        modality: output.modality,
        outputType: output.outputType,
        outputValue: output.outputValue ?? '',
        distance: output.outputType === 'distance' ? (Number(output.outputValue) || 0) : '',
        avgWatts: output.outputType === 'watts' ? (Number(output.outputValue) || 0) : '',
        totalMinutes: Number(workoutLog.totalMinutes) || 0,
        avgBpm: Number(workoutLog.avgBpm) || 0,
        maxBpm: Number(workoutLog.maxBpm) || 0,
        completedAt,
      },
  };
}

export function enqueueDailyWorkoutForSync(workoutLog, workoutContext, linkedRecordId = '') {
  return enqueuePayloadForSync(buildDailyWorkoutPayload(workoutLog, workoutContext, linkedRecordId));
}

export function buildWorkoutCompletionClearPayload(workoutContext = {}, linkedRecordId = '') {
  const proofMeta = buildProofMetadata(workoutContext, linkedRecordId);

  return {
    ...buildBasePayload('workout_completion_clear'),
    linkedRecordId: proofMeta.linkedRecordId,
    proofKey: proofMeta.proofKey,
    weekIndex: proofMeta.weekIndex,
    workoutIndex: proofMeta.workoutIndex,
    workoutContext: Object.keys(workoutContext).length ? workoutContext : null,
  };
}

export function enqueueWorkoutCompletionClearForSync(workoutContext = {}, linkedRecordId = '') {
  return enqueuePayloadForSync(buildWorkoutCompletionClearPayload(workoutContext, linkedRecordId));
}

export function buildWorkoutProofPayload(attachment) {
  return {
    ...buildBasePayload('workout_proof'),
    proofPolicyVersion: 2,
    attachmentId: String(attachment?.id || ''),
  };
}

export function enqueueWorkoutProofForSync(attachment) {
  return enqueuePayloadForSync(buildWorkoutProofPayload(attachment));
}

function getSyncRelayEndpoint() {
  try {
    const configured = import.meta.env && import.meta.env.VITE_RING_READY_SYNC_RELAY_URL
      ? String(import.meta.env.VITE_RING_READY_SYNC_RELAY_URL).trim()
      : '';
    if (configured) return configured;
    if (isProductionBuild()) return '/api/sync';
  } catch {
    // ignore
  }
  return '';
}

export function isSyncTransportConfigured() {
  if (getSyncRelayEndpoint()) return true;
  if (isProductionBuild()) return false;
  return !!getSyncEndpoint();
}

async function postSubmission(item) {
  const body = JSON.stringify(item.payload);
  const relayEndpoint = getSyncRelayEndpoint();

  if (relayEndpoint) {
    const token = await getAccessToken();
    if (!token) throw new Error('Sign in required for Sheets sync');

    const response = await fetch(relayEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
    });

    const raw = await response.text();
    let result;
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error('Invalid response from Sheets sync relay');
    }

    if (!response.ok || result.ok !== true) {
      throw new Error(String(result.error || 'Sheets sync rejected'));
    }

    return result;
  }

  if (isProductionBuild()) {
    throw new Error('Sheets sync relay unavailable');
  }

  const directEndpoint = getSyncEndpoint();
  if (!directEndpoint) {
    throw new Error('Sheets sync not configured');
  }

  await fetch(directEndpoint, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body,
  });
}

function shouldProcessQueueItem(item, userId, options = {}) {
  if (item.userId !== userId) return false;
  if (item.status === 'pending') return true;
  if (item.status !== 'failed') return false;
  if (options.manualRetry) return true;
  return (item.attempts || 0) < MAX_SYNC_ATTEMPTS;
}

export async function flushSyncQueue(options = {}) {
  const userId = resolveQueueUserId();
  if (!userId) {
    updateSyncStatusUI();
    return { status: 'not-signed-in', dispatched: 0, pending: 0, manualRetryRequired: false };
  }

  quarantineLegacySyncQueue();

  const queue = getSyncQueue(userId);
  const pending = queue.filter((item) => item.status === 'pending' && item.userId === userId);

  if (!isSyncTransportConfigured()) {
    updateSyncStatusUI();
    return { status: 'not-configured', dispatched: 0, pending: pending.length, manualRetryRequired: needsManualSyncRetry(userId) };
  }

  if (!navigator.onLine) {
    updateSyncStatusUI();
    return { status: 'offline', dispatched: 0, pending: pending.length, manualRetryRequired: needsManualSyncRetry(userId) };
  }

  if (options.manualRetry) {
    queue.forEach((item) => {
      if (item.status === 'failed' && item.userId === userId) {
        item.attempts = 0;
      }
    });
  }

  let dispatched = 0;
  const dispatchOrder = [...queue].reverse().filter((item) => shouldProcessQueueItem(item, userId, options));
  for (const item of dispatchOrder) {
    try {
      item.attempts = (item.attempts || 0) + 1;
      await postSubmission(item);
      if (getSyncRelayEndpoint()) {
        item.status = 'acknowledged';
        item.acknowledgedAt = new Date().toISOString();
      } else {
        item.status = 'dispatched';
        item.dispatchedAt = new Date().toISOString();
      }
      item.lastError = '';
      dispatched++;
    } catch (err) {
      item.status = 'failed';
      item.lastError = String(err && err.message ? err.message : err);
    }
  }

  saveSyncQueue(queue, userId);
  updateSyncStatusUI();
  return {
    status: 'ok',
    dispatched,
    pending: getPendingSyncCount(userId),
    manualRetryRequired: needsManualSyncRetry(userId),
  };
}

export function retryFailedSyncItems(options = {}) {
  return flushSyncQueue({ manualRetry: true, ...options });
}

export function updateSyncStatusUI() {
  const title = document.getElementById('sync-title');
  const copy = document.getElementById('sync-copy');
  const btn = document.getElementById('sync-now-btn');
  if (!title || !copy || !btn) return;

  const pending = getPendingSyncCount();
  const retryableFailed = getRetryableFailedCount();
  const manualFailed = getFailedSyncCount();
  const endpoint = isSyncTransportConfigured();
  const online = navigator.onLine;
  const legacyCount = getLegacySyncQueueQuarantineCount();

  if (!endpoint) {
    title.textContent = pending ? `${pending} saved locally` : 'Local Save Ready';
    copy.textContent = legacyCount
      ? `${legacyCount} legacy Sheets events not migrated.`
      : 'Sheets sync will activate after the authenticated relay is connected.';
    btn.textContent = 'LOCAL';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    return;
  }

  if (!online) {
    title.textContent = pending ? `${pending} waiting to sync` : 'Offline';
    copy.textContent = 'Completed app data will upload when this device is back online.';
    btn.textContent = 'WAIT';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    return;
  }

  if (manualFailed > 0 && pending === 0 && retryableFailed === 0) {
    title.textContent = `${manualFailed} delivery failed`;
    copy.textContent = 'Delivery failed — manual retry required';
    btn.textContent = 'RETRY';
    btn.disabled = false;
    btn.style.opacity = '1';
    return;
  }

  const readyCount = pending + retryableFailed;
  title.textContent = readyCount ? `${readyCount} ready to sync` : 'Sheets Sync Ready';
  copy.textContent = readyCount
    ? 'Tap sync to dispatch saved app data to Sheets.'
    : 'Completed sessions and test results can be sent to the coach sheet.';
  btn.textContent = manualFailed > 0 ? 'RETRY' : 'SYNC';
  btn.disabled = false;
  btn.style.opacity = '1';
}

export function initSyncControls({ showToast }) {
  applySyncEndpointFromURL();
  quarantineLegacySyncQueue();
  const syncBtn = document.getElementById('sync-now-btn');

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      const manualRetry = needsManualSyncRetry();
      const result = await flushSyncQueue(manualRetry ? { manualRetry: true } : {});
      if (result.status === 'not-configured') showToast?.('SHEETS SYNC NOT CONNECTED');
      else if (result.status === 'offline') showToast?.('OFFLINE - SAVED LOCALLY');
      else if (result.status === 'not-signed-in') showToast?.('SIGN IN TO SYNC');
      else if (result.dispatched > 0) showToast?.('SHEETS REQUEST DISPATCHED');
      else if (result.manualRetryRequired) showToast?.('DELIVERY FAILED — MANUAL RETRY REQUIRED');
      else showToast?.('NOTHING TO SYNC');
    });
  }

  window.addEventListener('online', () => flushSyncQueue());
  window.addEventListener('offline', updateSyncStatusUI);
  updateSyncStatusUI();
}
