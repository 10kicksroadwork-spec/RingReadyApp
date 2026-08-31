import {
  APP_NAME,
  LEGACY_SYNC_QUEUE_KEY,
  LEGACY_SYNC_QUEUE_QUARANTINE_KEY,
  PROFILE_STORAGE_KEY,
  SYNC_ENDPOINT_KEY,
  SYNC_QUEUE_KEY_PREFIX,
} from './constants.js';
import { calculateAvgDrop, calculatePeakHR } from './workout.js';
import { hrState } from './hr-service.js';
import { MODALITY_RUNNING, normalizeModality } from './modality.js';
import { getCurrentUser } from './auth.js';

const MAX_QUEUE_ITEMS = 50;
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

function cleanProfile(profile = {}) {
  return {
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

function makeEventId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `rr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isProductionBuild() {
  try {
    return !!(import.meta.env && import.meta.env.PROD);
  } catch (err) {
    return false;
  }
}

function isAllowedSyncEndpoint(value) {
  const trimmed = String(value || '').trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.hostname === ALLOWED_SYNC_HOST && ALLOWED_SYNC_PATH.test(url.pathname);
  } catch (err) {
    return false;
  }
}

function getBuildEndpoint() {
  try {
    return import.meta.env && import.meta.env.VITE_RING_READY_SYNC_URL
      ? String(import.meta.env.VITE_RING_READY_SYNC_URL).trim()
      : '';
  } catch (err) {
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

function saveQueueForUser(queue, userId = resolveQueueUserId()) {
  if (!userId) return;
  writeJSON(syncQueueStorageKey(userId), queue.slice(0, MAX_QUEUE_ITEMS));
}

export function quarantineLegacySyncQueue() {
  const legacy = readJSON(LEGACY_SYNC_QUEUE_KEY, []);
  if (!Array.isArray(legacy) || legacy.length === 0) {
    localStorage.removeItem(LEGACY_SYNC_QUEUE_KEY);
    return { quarantined: 0 };
  }

  const existing = readJSON(LEGACY_SYNC_QUEUE_QUARANTINE_KEY, []);
  const merged = [...existing, ...legacy.map((item) => ({ ...item, quarantinedAt: new Date().toISOString() }))];
  writeJSON(LEGACY_SYNC_QUEUE_QUARANTINE_KEY, merged.slice(0, MAX_QUEUE_ITEMS));
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

export function saveAthleteProfile(profile) {
  const current = getAthleteProfile();
  const next = cleanProfile({ ...current, ...profile });
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
  const id = payload.sessionId || payload.eventId || makeEventId();
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

export function buildSessionPayload(cfg, data) {
  const base = buildBasePayload('sprint_session');
  const workoutContext = cfg.workoutContext || {};
  const workoutType = workoutContext.workoutType || 'Sprint Intervals';
  const targetBPM = Number(workoutContext.targetBPM) || Math.round((cfg.maxHR * cfg.targetPct) / 100);
  const validDrops = data
    .map((rep) => rep.drop)
    .filter((drop) => Number.isFinite(Number(drop)) && Number(drop) > 0)
    .map((drop) => Number(drop));

  return {
    ...base,
    sessionId: base.eventId,
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
      bpmDropCsv: validDrops.join(', '),
      validDropCount: validDrops.length,
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

export function enqueueSessionForSync(cfg, data) {
  return enqueuePayloadForSync(buildSessionPayload(cfg, data));
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

  return {
    ...buildBasePayload('mile_test'),
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

export function buildDailyWorkoutPayload(workoutLog, workoutContext = {}) {
  const completedAt = workoutLog.completedAt || new Date().toISOString();
  const isSkip = workoutLog?.status === 'skipped';

  return {
    ...buildBasePayload(isSkip ? 'daily_workout_skip' : 'daily_workout'),
    workoutContext: Object.keys(workoutContext).length ? workoutContext : null,
    weekTab: workoutContext.weekTab || '',
    dayOfWeek: workoutContext.dayOfWeek || '',
    workoutType: workoutContext.workoutType || 'Daily Workout',
    description: workoutContext.description || '',
    warmup: workoutContext.warmup || '',
    targetZone: workoutContext.targetZone || '',
    targetBPM: Number(workoutContext.targetBPM) || '',
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
        distance: Number(workoutLog.distance) || 0,
        totalMinutes: Number(workoutLog.totalMinutes) || 0,
        avgBpm: Number(workoutLog.avgBpm) || 0,
        maxBpm: Number(workoutLog.maxBpm) || 0,
        completedAt,
      },
  };
}

export function enqueueDailyWorkoutForSync(workoutLog, workoutContext) {
  return enqueuePayloadForSync(buildDailyWorkoutPayload(workoutLog, workoutContext));
}

export function buildWorkoutProofPayload(attachment, linkedRecordId = '') {
  return {
    ...buildBasePayload('workout_proof'),
    proofPolicyVersion: 2,
    linkedRecordId: String(linkedRecordId || ''),
    attachmentId: String(attachment?.id || ''),
  };
}

export function enqueueWorkoutProofForSync(attachment, workoutContext, linkedRecordId) {
  void workoutContext;
  return enqueuePayloadForSync(buildWorkoutProofPayload(attachment, linkedRecordId));
}

async function postSubmission(endpoint, item) {
  const body = JSON.stringify(item.payload);

  await fetch(endpoint, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body,
  });
}

export async function flushSyncQueue() {
  const userId = resolveQueueUserId();
  if (!userId) {
    updateSyncStatusUI();
    return { status: 'not-signed-in', dispatched: 0, pending: 0 };
  }

  quarantineLegacySyncQueue();

  const endpoint = getSyncEndpoint();
  const queue = getSyncQueue(userId);
  const pending = queue.filter((item) => item.status === 'pending' && item.userId === userId);

  if (!endpoint) {
    updateSyncStatusUI();
    return { status: 'not-configured', dispatched: 0, pending: pending.length };
  }

  if (!navigator.onLine) {
    updateSyncStatusUI();
    return { status: 'offline', dispatched: 0, pending: pending.length };
  }

  let dispatched = 0;
  for (const item of queue) {
    if (item.status !== 'pending') continue;
    if (item.userId !== userId) continue;
    try {
      item.attempts = (item.attempts || 0) + 1;
      await postSubmission(endpoint, item);
      item.status = 'dispatched';
      item.dispatchedAt = new Date().toISOString();
      item.lastError = '';
      dispatched++;
    } catch (err) {
      item.status = 'failed';
      item.lastError = String(err && err.message ? err.message : err);
    }
  }

  saveSyncQueue(queue, userId);
  updateSyncStatusUI();
  return { status: 'ok', dispatched, pending: getPendingSyncCount(userId) };
}

export function updateSyncStatusUI() {
  const title = document.getElementById('sync-title');
  const copy = document.getElementById('sync-copy');
  const btn = document.getElementById('sync-now-btn');
  if (!title || !copy || !btn) return;

  const pending = getPendingSyncCount();
  const endpoint = getSyncEndpoint();
  const online = navigator.onLine;
  const legacyCount = getLegacySyncQueueQuarantineCount();

  if (!endpoint) {
    title.textContent = pending ? `${pending} saved locally` : 'Local Save Ready';
    copy.textContent = legacyCount
      ? `${legacyCount} legacy Sheets events not migrated.`
      : 'Sheets sync will activate after the Apps Script endpoint is connected.';
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

  title.textContent = pending ? `${pending} ready to sync` : 'Sheets Sync Ready';
  copy.textContent = pending
    ? 'Tap sync to dispatch saved app data to Sheets.'
    : 'Completed sessions and test results can be sent to the coach sheet.';
  btn.textContent = 'SYNC';
  btn.disabled = false;
  btn.style.opacity = '1';
}

export function initSyncControls({ showToast }) {
  applySyncEndpointFromURL();
  quarantineLegacySyncQueue();
  const syncBtn = document.getElementById('sync-now-btn');

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      const result = await flushSyncQueue();
      if (result.status === 'not-configured') showToast?.('SHEETS SYNC NOT CONNECTED');
      else if (result.status === 'offline') showToast?.('OFFLINE - SAVED LOCALLY');
      else if (result.status === 'not-signed-in') showToast?.('SIGN IN TO SYNC');
      else if (result.dispatched > 0) showToast?.('SHEETS REQUEST DISPATCHED');
      else showToast?.('NOTHING TO SYNC');
    });
  }

  window.addEventListener('online', () => flushSyncQueue());
  window.addEventListener('offline', updateSyncStatusUI);
  updateSyncStatusUI();
}
