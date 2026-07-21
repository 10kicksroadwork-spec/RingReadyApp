import {
  APP_NAME,
  PROFILE_STORAGE_KEY,
  SYNC_ENDPOINT_KEY,
  SYNC_QUEUE_KEY,
} from './constants.js';
import { calculateAvgDrop, calculatePeakHR } from './workout.js';
import { hrState } from './hr-service.js';

const MAX_QUEUE_ITEMS = 50;

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

function isEndpointURL(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function getLocalDate() {
  return new Date().toLocaleDateString('en-US');
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
  return String(localStorage.getItem(SYNC_ENDPOINT_KEY) || getBuildEndpoint() || '').trim();
}

export function applySyncEndpointFromURL() {
  const url = new URL(window.location.href);
  const syncUrl = String(url.searchParams.get('syncUrl') || url.searchParams.get('sync_url') || '').trim();
  const clearSyncUrl = url.searchParams.get('clearSyncUrl') === '1';
  let changed = false;

  if (clearSyncUrl) {
    localStorage.removeItem(SYNC_ENDPOINT_KEY);
    changed = true;
  }

  if (syncUrl && isEndpointURL(syncUrl)) {
    localStorage.setItem(SYNC_ENDPOINT_KEY, syncUrl);
    changed = true;
  }

  if (changed) {
    url.searchParams.delete('syncUrl');
    url.searchParams.delete('sync_url');
    url.searchParams.delete('clearSyncUrl');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
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

export function getSyncQueue() {
  return readJSON(SYNC_QUEUE_KEY, []);
}

function saveSyncQueue(queue) {
  writeJSON(SYNC_QUEUE_KEY, queue.slice(0, MAX_QUEUE_ITEMS));
}

export function getPendingSyncCount() {
  return getSyncQueue().filter((item) => item.status === 'pending').length;
}

function buildBasePayload(eventType) {
  const profile = getAthleteProfile();
  const submittedAt = new Date().toISOString();

  return {
    schemaVersion: 1,
    appName: APP_NAME,
    eventType,
    eventId: makeEventId(),
    athleteName: profile.athleteName,
    athleteProfile: profile,
    submittedAt,
    localDate: getLocalDate(),
    source: 'pwa',
  };
}

export function enqueuePayloadForSync(payload) {
  const queue = getSyncQueue();
  const id = payload.sessionId || payload.eventId || makeEventId();
  const item = {
    id,
    status: 'pending',
    createdAt: payload.submittedAt || new Date().toISOString(),
    attempts: 0,
    lastError: '',
    payload: { ...payload, eventId: payload.eventId || id },
  };

  queue.unshift(item);
  saveSyncQueue(queue);
  updateSyncStatusUI();
  return item;
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
  const distance = Number(workoutLog.distance) || 0;
  const totalMinutes = Number(workoutLog.totalMinutes) || 0;
  const avgBpm = Number(workoutLog.avgBpm) || 0;
  const maxBpm = Number(workoutLog.maxBpm) || 0;
  const completedAt = workoutLog.completedAt || new Date().toISOString();

  return {
    ...buildBasePayload('daily_workout'),
    workoutContext: Object.keys(workoutContext).length ? workoutContext : null,
    weekTab: workoutContext.weekTab || '',
    dayOfWeek: workoutContext.dayOfWeek || '',
    workoutType: workoutContext.workoutType || 'Daily Workout',
    description: workoutContext.description || '',
    warmup: workoutContext.warmup || '',
    targetZone: workoutContext.targetZone || '',
    targetBPM: Number(workoutContext.targetBPM) || '',
    workoutLog: {
      distance,
      totalMinutes,
      avgBpm,
      maxBpm,
      completedAt,
    },
  };
}

export function enqueueDailyWorkoutForSync(workoutLog, workoutContext) {
  return enqueuePayloadForSync(buildDailyWorkoutPayload(workoutLog, workoutContext));
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
  const endpoint = getSyncEndpoint();
  const queue = getSyncQueue();
  const pending = queue.filter((item) => item.status === 'pending');

  if (!endpoint) {
    updateSyncStatusUI();
    return { status: 'not-configured', sent: 0, pending: pending.length };
  }

  if (!navigator.onLine) {
    updateSyncStatusUI();
    return { status: 'offline', sent: 0, pending: pending.length };
  }

  let sent = 0;
  for (const item of queue) {
    if (item.status !== 'pending') continue;
    try {
      item.attempts = (item.attempts || 0) + 1;
      await postSubmission(endpoint, item);
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      item.lastError = '';
      sent++;
    } catch (err) {
      item.lastError = String(err && err.message ? err.message : err);
    }
  }

  saveSyncQueue(queue);
  updateSyncStatusUI();
  return { status: 'ok', sent, pending: getPendingSyncCount() };
}

export function updateSyncStatusUI() {
  const title = document.getElementById('sync-title');
  const copy = document.getElementById('sync-copy');
  const btn = document.getElementById('sync-now-btn');
  if (!title || !copy || !btn) return;

  const pending = getPendingSyncCount();
  const endpoint = getSyncEndpoint();
  const online = navigator.onLine;

  if (!endpoint) {
    title.textContent = pending ? `${pending} saved locally` : 'Local Save Ready';
    copy.textContent = 'Sheets sync will activate after the Apps Script endpoint is connected.';
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
  copy.textContent = pending ? 'Tap sync to send saved app data.' : 'Completed sessions and test results can be sent to the coach sheet.';
  btn.textContent = 'SYNC';
  btn.disabled = false;
  btn.style.opacity = '1';
}

export function initSyncControls({ showToast }) {
  applySyncEndpointFromURL();
  const syncBtn = document.getElementById('sync-now-btn');

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      const result = await flushSyncQueue();
      if (result.status === 'not-configured') showToast?.('SHEETS SYNC NOT CONNECTED');
      else if (result.status === 'offline') showToast?.('OFFLINE - SAVED LOCALLY');
      else if (result.sent > 0) showToast?.('SYNC SENT');
      else showToast?.('NOTHING TO SYNC');
    });
  }

  window.addEventListener('online', () => flushSyncQueue());
  window.addEventListener('offline', updateSyncStatusUI);
  updateSyncStatusUI();
}