import {
  deleteCloudWorkoutCompletion,
  getCurrentUser,
  initSupabaseAuth,
  loadCloudHRInfo,
  loadCloudMileTest,
  loadCloudProfile,
  loadCloudSprintSessions,
  loadCloudWorkoutCompletions,
  saveCloudHRInfo,
  saveCloudMileTest,
  saveCloudProfile,
  saveCloudSprintSession,
  saveCloudWorkoutCompletion,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from './auth.js';
import { isSupabaseConfigured } from './supabase-client.js';

const WEEK_INDEX_KEY = 'ringReadyActiveWeekIndex';
const PROFILE_FORM_COLLAPSED_KEY = 'ringReadyProfileFormCollapsed';
const ONBOARDING_DISMISSED_KEY = 'ringReadyOnboardingDismissed';
const AUTH_USER_STORAGE_KEY = 'ringReadyAuthUserId';

let activeWeekIndex = Number(localStorage.getItem(WEEK_INDEX_KEY) || 0);
let scMode = localStorage.getItem(SC_MODE_STORAGE_KEY) || 'Gym Machines';
let scWeek = Number(localStorage.getItem(SC_WEEK_STORAGE_KEY) || activeWeekIndex + 1);
let shellHooks = null;
let authMode = 'sign-in';

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch (err) { console.warn(`Could not read ${key}`, err); return fallback; }
}
function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = value ?? ''; }
function setInputValue(id, value) { const el = document.getElementById(id); if (el) el.value = value ?? ''; }
function readInputValue(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function parseNumberInput(id, fallback) {
  const el = document.getElementById(id);
  if (!el || el.value === '') return fallback;
  const parsed = Number(el.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function formatWholeNumber(value, fallback = '--') { const num = Number(value); return Number.isFinite(num) && num > 0 ? String(Math.round(num)) : fallback; }
function cleanAuthError(error) {
  const message = String(error?.message || error || 'Account action failed.');
  if (/invalid login credentials/i.test(message)) return 'Email or password did not match.';
  if (/email not confirmed/i.test(message)) return 'Check your email to confirm this account, then sign in.';
  return message;
}
function hasProfileData(profile = {}) {
  return ['athleteName', 'age', 'gender', 'genderDetail', 'trainingTenure', 'fightDate'].some((key) => String(profile[key] || '').trim()) || String(profile.campLength || '') === '4';
}
function hasCustomHRInfo(hrInfo = {}) {
  return Number(hrInfo.goalWeight) !== Number(HR_INFO_DEFAULTS.goalWeight)
    || String(hrInfo.targetDate || '') !== String(HR_INFO_DEFAULTS.targetDate)
    || Number(hrInfo.maxHr) !== Number(HR_INFO_DEFAULTS.maxHr)
    || Number(hrInfo.restingHr) !== Number(HR_INFO_DEFAULTS.restingHr);
}
function getCloudTimestamp(record) {
  const value = record?.completedAt || record?.savedAt || record?.date || record?.workoutLog?.completedAt || '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
function clearAccountLocalData() {
  [PROFILE_STORAGE_KEY, STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY, HR_INFO_STORAGE_KEY, MILE_TEST_STORAGE_KEY, PROFILE_FORM_COLLAPSED_KEY].forEach((key) => localStorage.removeItem(key));
}
function mergeWorkoutCompletions(localCompletions = {}, cloudCompletions = {}) {
  const merged = { ...localCompletions };
  Object.entries(cloudCompletions || {}).forEach(([key, cloudRecord]) => {
    const localRecord = merged[key];
    if (!localRecord || getCloudTimestamp(cloudRecord) >= getCloudTimestamp(localRecord)) merged[key] = cloudRecord;
  });
  return merged;
}
function mergeSprintSessions(localSessions = [], cloudSessions = []) {
  const byId = new Map();
  [...cloudSessions, ...localSessions].forEach((record) => {
    if (!record) return;
    const id = String(record.id || record.sessionId || record.date || Math.random());
    const existing = byId.get(id);
    if (!existing || getCloudTimestamp(record) >= getCloudTimestamp(existing)) byId.set(id, record);
  });
  return Array.from(byId.values()).sort((a, b) => getCloudTimestamp(b) - getCloudTimestamp(a)).slice(0, 50);
}
function chooseLatestMileResult(localResult, cloudResult) {
  if (!localResult) return cloudResult || null;
  if (!cloudResult) return localResult;
  return getCloudTimestamp(cloudResult) >= getCloudTimestamp(localResult) ? cloudResult : localResult;
}
async function saveTrainingDataToCloud({ completions = {}, sessions = [], mileTest = null } = {}) {
  if (!isSupabaseConfigured || !getCurrentUser()) return;
  const saves = [
    ...Object.values(completions).filter(Boolean).map((record) => saveCloudWorkoutCompletion(record)),
    ...sessions.filter(Boolean).map((record) => saveCloudSprintSession(record)),
  ];
  if (mileTest) saves.push(saveCloudMileTest(mileTest, getHRInfo(), { weekTab: 'Mile Test', workoutType: MILE_TEST_INFO.workout, dayOfWeek: MILE_TEST_INFO.day, description: MILE_TEST_INFO.description, warmup: MILE_TEST_INFO.warmup }));
  const results = await Promise.allSettled(saves);
  results.filter((result) => result.status === 'rejected').forEach((result) => console.warn('Cloud training save failed', result.reason));
}
async function saveWorkoutCompletionToCloud(record, successMessage = '') {
  if (!record || !isSupabaseConfigured || !getCurrentUser()) return false;
  try {
    await saveCloudWorkoutCompletion(record);
    if (successMessage) shellHooks?.showToast?.(successMessage);
    return true;
  } catch (error) {
    console.warn('Cloud workout completion save failed', error);
    return false;
  }
}
async function deleteWorkoutCompletionFromCloud(weekIndex, workoutIndex) {
  if (!isSupabaseConfigured || !getCurrentUser()) return false;
  try {
    await deleteCloudWorkoutCompletion(weekIndex, workoutIndex);
    return true;
  } catch (error) {
    console.warn('Cloud workout completion delete failed', error);
    return false;
  }
}
async function saveSprintSessionToCloud(record) {
  if (!record || !isSupabaseConfigured || !getCurrentUser()) return false;
  try {
    await saveCloudSprintSession(record);
    return true;
  } catch (error) {
    console.warn('Cloud sprint session save failed', error);
    return false;
  }
}
function setAuthStatus(message = '', isError = false) {
  const el = document.getElementById('auth-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
}
function renderAuthUI() {
  const isSignUp = authMode === 'sign-up';
  setText('auth-copy', isSignUp ? 'Create your Ring Ready account so your profile can follow you across devices.' : 'Sign in to save your profile and training history to your account.');
  setText('auth-submit-btn', isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN');
  setText('auth-mode-toggle-btn', isSignUp ? 'Already have an account? Sign in' : 'Create an account instead');
  const password = document.getElementById('auth-password-input');
  if (password) password.autocomplete = isSignUp ? 'new-password' : 'current-password';
}
function renderAllPages() {
  renderShell();
  renderAthleteProfilePage();
  renderWelcomePage();
  renderHRInfoPage();
  renderSCPage();
  renderMileTestPage();
}
function enterAppHome() {
  renderAllPages();
  shellHooks?.showScreen('home');
  setActiveNavigation('home');
  maybeShowOnboarding();
}
function showAuthScreen(message = '') {
  renderAuthUI();
  setAuthStatus(message);
  shellHooks?.showScreen('auth');
  setActiveNavigation('');
}
async function hydrateCloudData() {
  if (!isSupabaseConfigured || !getCurrentUser()) return;
  const user = getCurrentUser();
  const lastUserId = localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (lastUserId && lastUserId !== user.id) clearAccountLocalData();
  localStorage.setItem(AUTH_USER_STORAGE_KEY, user.id);

  const localProfile = getAthleteProfile();
  const localHRInfo = getHRInfo();
  const localCompletions = readJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, {});
  const localSessions = getSessionHistory();
  const localMileTest = getMileTestResult();

  const [cloudProfile, cloudHRInfo, cloudCompletions, cloudSessions, cloudMileTest] = await Promise.all([
    loadCloudProfile(),
    loadCloudHRInfo(),
    loadCloudWorkoutCompletions(),
    loadCloudSprintSessions(),
    loadCloudMileTest(),
  ]);

  if (cloudProfile && hasProfileData(cloudProfile)) {
    saveAthleteProfile(cloudProfile);
  } else if (hasProfileData(localProfile)) {
    await saveCloudProfile(localProfile);
  }

  if (cloudHRInfo && hasCustomHRInfo(cloudHRInfo)) {
    saveHRInfo({ ...HR_INFO_DEFAULTS, ...cloudHRInfo });
  } else if (hasCustomHRInfo(localHRInfo)) {
    await saveCloudHRInfo(localHRInfo);
  }

  const mergedCompletions = mergeWorkoutCompletions(localCompletions, cloudCompletions);
  const mergedSessions = mergeSprintSessions(localSessions, cloudSessions);
  const latestMileTest = chooseLatestMileResult(localMileTest, cloudMileTest);

  writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, mergedCompletions);
  writeJSON(STORAGE_KEY, mergedSessions);
  if (latestMileTest) writeJSON(MILE_TEST_STORAGE_KEY, latestMileTest);

  await saveTrainingDataToCloud({ completions: mergedCompletions, sessions: mergedSessions, mileTest: latestMileTest });
}
async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!isSupabaseConfigured) {
    enterAppHome();
    return;
  }
  const email = readInputValue('auth-email-input');
  const password = readInputValue('auth-password-input');
  if (!email || password.length < 8) {
    setAuthStatus('Enter an email and password with at least 8 characters.', true);
    return;
  }

  const submit = document.getElementById('auth-submit-btn');
  if (submit) submit.disabled = true;
  setAuthStatus(authMode === 'sign-up' ? 'Creating account...' : 'Signing in...');
  try {
    const result = authMode === 'sign-up' ? await signUpWithEmail(email, password) : await signInWithEmail(email, password);
    if (!result.session && !getCurrentUser()) {
      authMode = 'sign-in';
      renderAuthUI();
      setAuthStatus('Check your email to confirm the account, then sign in.');
      return;
    }
    await hydrateCloudData();
    enterAppHome();
    shellHooks?.showToast?.(authMode === 'sign-up' ? 'ACCOUNT CREATED' : 'SIGNED IN');
  } catch (error) {
    setAuthStatus(cleanAuthError(error), true);
  } finally {
    if (submit) submit.disabled = false;
  }
}
function toggleAuthMode() {
  authMode = authMode === 'sign-up' ? 'sign-in' : 'sign-up';
  renderAuthUI();
  setAuthStatus('');
}
async function handleLogout() {
  try {
    await signOut();
    clearAccountLocalData();
    localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    renderAllPages();
    showAuthScreen('Signed out.');
  } catch (error) {
    shellHooks?.showToast?.(cleanAuthError(error).toUpperCase());
  }
}
function handleAuthStateChange(session) {
  if (!session && isSupabaseConfigured) showAuthScreen();
}
function formatDistance(value) { const num = Number(value); if (!Number.isFinite(num) || num <= 0) return '--'; return num >= 10 ? num.toFixed(1) : num.toFixed(2); }
function formatDashboardDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function getRecordDate(record) {
  const date = new Date(record?.completedAt || record?.date || record?.workoutLog?.completedAt || '');
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
function getCampWeekLimit() { return Math.min(PROGRAM.length, getAthleteProfile().campLength === '4' ? 4 : PROGRAM.length); }
function getVisibleProgram() { return PROGRAM.slice(0, getCampWeekLimit()); }
function clampWeek(index) { const limit = Math.max(1, getCampWeekLimit()); return Math.max(0, Math.min(limit - 1, Number(index) || 0)); }
function clampSCWeek(week) { return Math.max(1, Math.min(getCampWeekLimit(), Number(week) || 1)); }
function saveWeek(index) { activeWeekIndex = clampWeek(index); localStorage.setItem(WEEK_INDEX_KEY, String(activeWeekIndex)); }

function getHRInfo() {
  const saved = readJSON(HR_INFO_STORAGE_KEY, {});
  return {
    goalWeight: Number(saved.goalWeight ?? HR_INFO_DEFAULTS.goalWeight),
    targetDate: String(saved.targetDate || HR_INFO_DEFAULTS.targetDate),
    maxHr: Number(saved.maxHr ?? HR_INFO_DEFAULTS.maxHr),
    restingHr: Number(saved.restingHr ?? HR_INFO_DEFAULTS.restingHr),
  };
}
function saveHRInfo(info) {
  const next = {
    goalWeight: Number(info.goalWeight) || HR_INFO_DEFAULTS.goalWeight,
    targetDate: String(info.targetDate || HR_INFO_DEFAULTS.targetDate),
    maxHr: Number(info.maxHr) || HR_INFO_DEFAULTS.maxHr,
    restingHr: Number(info.restingHr) || HR_INFO_DEFAULTS.restingHr,
  };
  writeJSON(HR_INFO_STORAGE_KEY, next);
  return next;
}
function calculateZoneBPM(zone, hrInfo) { const reserve = Math.max(0, hrInfo.maxHr - hrInfo.restingHr); return Math.round((reserve * zone.pct) / 100 + hrInfo.restingHr); }
function getWorkoutTargetPct(workout) {
  const matches = String(workout.targetZone || '').match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const values = matches.map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function getWorkoutTargetBPM(workout, hrInfo = getHRInfo()) {
  const pct = getWorkoutTargetPct(workout);
  return Number.isFinite(pct) ? calculateZoneBPM({ pct }, hrInfo) : Number(workout.targetBPM) || null;
}
function syncSetupHRInputs(hrInfo = getHRInfo()) { const maxInput = document.getElementById('max-hr'); if (maxInput) maxInput.value = String(Math.round(hrInfo.maxHr)); }
function getSprintSetupFromWorkout(workout) {
  const text = `${workout.type || ''} ${workout.description || ''}`;
  const repMatch = text.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*m/i);
  const restMatch = text.match(/(\d+)\s*(?:second|sec|s)\s*(?:rest|recovery)/i);
  return { reps: repMatch ? Number(repMatch[1]) : null, distanceMeters: repMatch ? Number(repMatch[2]) : null, restSeconds: restMatch ? Number(restMatch[1]) : null };
}
function buildWorkoutContext(week, workout, weekIndex, workoutIndex) {
  const sprintSetup = getSprintSetupFromWorkout(workout);
  const targetPct = getWorkoutTargetPct(workout);
  return {
    weekIndex, workoutIndex, weekLabel: week.label, weekTitle: week.title, weekTab: week.title ? `${week.label} (${week.title})` : week.label,
    dayOfWeek: workout.day, workoutType: workout.type, description: workout.description, warmup: workout.warmup || '', targetZone: workout.targetZone || '',
    targetBPM: getWorkoutTargetBPM(workout), targetPct, reps: sprintSetup.reps, restSeconds: sprintSetup.restSeconds, distanceMeters: sprintSetup.distanceMeters,
  };
}
function makeWorkoutCompletionId() { return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : `workout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function hasSessionResults(completion) { return Array.isArray(completion?.data) && completion.data.length > 0; }
function buildBasicWorkoutCompletion(week, workout, weekIndex, workoutIndex, workoutLog = null) {
  const context = buildWorkoutContext(week, workout, weekIndex, workoutIndex);
  return { id: makeWorkoutCompletionId(), date: new Date().toISOString(), type: 'daily-workout-completion', cfg: { workoutContext: context }, workoutContext: context, workoutLog, data: [], avgDrop: null, peakHR: workoutLog ? workoutLog.maxBpm : null };
}
function parseWorkoutDuration(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const colonMatch = raw.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    const totalSeconds = minutes * 60 + seconds;
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0 || seconds > 59) return null;
    return { totalMinutes: Number((totalSeconds / 60).toFixed(2)), totalSeconds, totalTimeDisplay: `${minutes}:${String(seconds).padStart(2, '0')}` };
  }
  const decimalMinutes = Number(raw);
  if (!Number.isFinite(decimalMinutes) || decimalMinutes <= 0) return null;
  const totalSeconds = Math.round(decimalMinutes * 60);
  return { totalMinutes: Number((totalSeconds / 60).toFixed(2)), totalSeconds, totalTimeDisplay: `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}` };
}
function formatWorkoutDuration(log = {}) {
  if (log.totalTimeDisplay) return log.totalTimeDisplay;
  const seconds = Number.isFinite(Number(log.totalSeconds)) ? Number(log.totalSeconds) : Number.isFinite(Number(log.totalMinutes)) ? Math.round(Number(log.totalMinutes) * 60) : null;
  return !Number.isFinite(seconds) || seconds <= 0 ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function formatMinutesAsDuration(minutes) { const totalSeconds = Math.round(Number(minutes) * 60); return !Number.isFinite(totalSeconds) || totalSeconds <= 0 ? '' : `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`; }
function getWorkoutDurationPlaceholder(workout = {}) {
  const text = String(workout.description || '');
  const totalMatch = text.match(/total\s+time[\s\S]*?(?:is|=)\s*(\d+(?:\.\d+)?)/i);
  if (totalMatch) return formatMinutesAsDuration(totalMatch[1]);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:min|minutes?)\b/i);
  return minuteMatch ? formatMinutesAsDuration(minuteMatch[1]) : 'MM:SS';
}
function parseThreeDigitHR(id) { const value = readInputValue(id); return /^\d{1,3}$/.test(value) ? Number(value) : NaN; }
function readDetailWorkoutLog(options = {}) {
  const silent = !!options.silent;
  const duration = parseWorkoutDuration(readInputValue('detail-total-minutes-input'));
  const avgBpm = parseThreeDigitHR('detail-avg-bpm-input');
  const maxBpm = parseThreeDigitHR('detail-max-bpm-input');
  const distance = parseNumberInput('detail-distance-input', NaN);
  if (!duration || ![avgBpm, maxBpm, distance].every((value) => Number.isFinite(value) && value > 0)) { if (!silent) shellHooks?.showToast?.('FILL OUT WORKOUT LOG'); return null; }
  if (avgBpm > 999 || maxBpm > 999) { if (!silent) shellHooks?.showToast?.('HR MUST BE 3 DIGITS OR LESS'); return null; }
  if (maxBpm < avgBpm) { if (!silent) shellHooks?.showToast?.('MAX HR SHOULD BE AVG OR HIGHER'); return null; }
  return { totalMinutes: duration.totalMinutes, totalSeconds: duration.totalSeconds, totalTimeDisplay: duration.totalTimeDisplay, avgBpm, maxBpm, distance, completedAt: new Date().toISOString() };
}
function sanitizeWorkoutDurationInput(value) {
  const cleaned = String(value || '').replace(/[^\d:.]/g, '');
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    return `${parts[0].slice(0, 3)}:${parts.slice(1).join('').slice(0, 2)}`;
  }
  const parts = cleaned.split('.');
  return parts.length > 1 ? `${parts[0].slice(0, 3)}.${parts.slice(1).join('').slice(0, 2)}` : parts[0].slice(0, 3);
}
function sanitizeThreeDigitInput(value) { return String(value || '').replace(/\D/g, '').slice(0, 3); }
function updateDetailCompletionState() {
  const action = document.getElementById('detail-action-btn');
  if (!action || action.dataset.action !== 'complete-workout') return;
  const completion = getWorkoutCompletion(action.dataset.weekIndex, action.dataset.workoutIndex);
  action.textContent = completion ? 'SAVE CHANGES' : 'COMPLETE WORKOUT';
  action.disabled = !readDetailWorkoutLog({ silent: true });
  action.classList.toggle('completed', false);
  const clearBtn = document.getElementById('detail-clear-completion-btn');
  if (clearBtn) clearBtn.hidden = !completion;
}
function normalizeDetailDurationInput() {
  const input = document.getElementById('detail-total-minutes-input');
  if (!input) return;
  const duration = parseWorkoutDuration(input.value);
  if (duration) input.value = duration.totalTimeDisplay;
  updateDetailCompletionState();
}
function handleDetailLogInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.id === 'detail-total-minutes-input') {
    const next = sanitizeWorkoutDurationInput(input.value);
    if (input.value !== next) input.value = next;
  }
  if (input.id === 'detail-avg-bpm-input' || input.id === 'detail-max-bpm-input') {
    const next = sanitizeThreeDigitInput(input.value);
    if (input.value !== next) input.value = next;
  }
  updateDetailCompletionState();
}
function setDetailWorkoutLog(isVisible, completion = null, workout = null) {
  const card = document.getElementById('detail-log-card');
  if (!card) return;
  card.hidden = !isVisible;
  const timeInput = document.getElementById('detail-total-minutes-input');
  if (timeInput) timeInput.placeholder = getWorkoutDurationPlaceholder(workout);
  const log = completion?.workoutLog || {};
  setInputValue('detail-total-minutes-input', formatWorkoutDuration(log));
  setInputValue('detail-avg-bpm-input', log.avgBpm ?? '');
  setInputValue('detail-max-bpm-input', log.maxBpm ?? '');
  setInputValue('detail-distance-input', log.distance ?? '');
  card.querySelectorAll('input').forEach((input) => { input.disabled = false; });
}
function flushQueuedEvent(syncMessage) {
  flushSyncQueue().then((result) => {
    if (result.sent > 0) shellHooks?.showToast?.(syncMessage);
    else if (result.status === 'offline') shellHooks?.showToast?.('SAVED LOCALLY - WILL SYNC LATER');
  });
}
async function completeWorkoutFromDetail(weekIndex, workoutIndex) {
  const safeWeekIndex = Number(weekIndex);
  const safeWorkoutIndex = Number(workoutIndex);
  const week = getWeek(safeWeekIndex);
  const workout = week.workouts[safeWorkoutIndex] || week.workouts[0];
  const workoutLog = readDetailWorkoutLog();
  if (!workoutLog) return;
  const existing = getWorkoutCompletion(safeWeekIndex, safeWorkoutIndex);
  const record = buildBasicWorkoutCompletion(week, workout, safeWeekIndex, safeWorkoutIndex, workoutLog);
  if (existing?.id) record.id = existing.id;
  const completed = saveWorkoutCompletion(record);
  let cloudSaved = false;
  if (completed) cloudSaved = await saveWorkoutCompletionToCloud(completed);
  if (completed && !existing) {
    enqueueDailyWorkoutForSync(workoutLog, record.workoutContext);
    flushQueuedEvent('WORKOUT SYNCED');
  }
  renderShell();
  renderAthleteProfileDashboard();
  openWorkoutDetail(safeWeekIndex, safeWorkoutIndex);
  if (!completed) shellHooks?.showToast?.('COULD NOT SAVE WORKOUT');
  else if (cloudSaved) shellHooks?.showToast?.(existing ? 'WORKOUT UPDATED IN ACCOUNT' : 'WORKOUT SAVED TO ACCOUNT');
  else shellHooks?.showToast?.(existing ? 'WORKOUT UPDATED' : 'WORKOUT COMPLETE');
}
async function clearCompletionFromDetail(weekIndex, workoutIndex) {
  const safeWeekIndex = Number(weekIndex);
  const safeWorkoutIndex = Number(workoutIndex);
  if (!Number.isFinite(safeWeekIndex) || !Number.isFinite(safeWorkoutIndex)) return;
  if (!window.confirm('Mark this workout incomplete on this device?')) return;
  const removed = removeWorkoutCompletion(safeWeekIndex, safeWorkoutIndex);
  if (!removed) { shellHooks?.showToast?.('NO COMPLETION TO CLEAR'); return; }
  await deleteWorkoutCompletionFromCloud(safeWeekIndex, safeWorkoutIndex);
  renderShell();
  renderAthleteProfileDashboard();
  openWorkoutDetail(safeWeekIndex, safeWorkoutIndex);
  shellHooks?.showToast?.('WORKOUT MARKED INCOMPLETE');
}
function renderHeaderProfile() {
  const profile = getAthleteProfile();
  const chip = document.getElementById('header-athlete-name');
  if (!chip) return;
  chip.textContent = profile.athleteName || 'Set Profile';
  chip.classList.toggle('empty', !profile.athleteName);
}
function getVisibleWorkoutSlots() {
  return getVisibleProgram().flatMap((week, weekIndex) => week.workouts.map((workout, workoutIndex) => ({ week, weekIndex, workout, workoutIndex })));
}
function getVisibleCompletionRows() {
  return getVisibleWorkoutSlots().map((slot) => ({ ...slot, completion: getWorkoutCompletion(slot.weekIndex, slot.workoutIndex) })).filter((row) => !!row.completion);
}
function getSessionHistory() { return readJSON(STORAGE_KEY, []); }
function average(values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}
function getMileTestResult() { return readJSON(MILE_TEST_STORAGE_KEY, null); }
function renderAthleteProfileDashboard() {
  const root = document.getElementById('profile-dashboard');
  if (!root) return;
  const profile = getAthleteProfile();
  const hrInfo = getHRInfo();
  const mileTest = getMileTestResult();
  const slots = getVisibleWorkoutSlots();
  const completions = getVisibleCompletionRows();
  const totalWorkouts = slots.length;
  const completedWorkouts = completions.length;
  const completionPct = totalWorkouts ? Math.round((completedWorkouts / totalWorkouts) * 100) : 0;
  const dailyLogs = completions.map((row) => ({ ...row, log: row.completion.workoutLog || null })).filter((row) => row.log).sort((a, b) => getRecordDate(b.completion) - getRecordDate(a.completion));
  const latestRun = dailyLogs[0] || null;
  const totalMiles = dailyLogs.reduce((sum, row) => sum + (Number(row.log.distance) || 0), 0);
  const totalMinutes = dailyLogs.reduce((sum, row) => sum + (Number(row.log.totalMinutes) || 0), 0);
  const averageRunHR = average(dailyLogs.map((row) => row.log.avgBpm));
  const completedSprintRecords = completions.map((row) => row.completion).filter((record) => hasSessionResults(record));
  const sessionHistory = getSessionHistory().filter((record) => hasSessionResults(record));
  const sprintRecords = completedSprintRecords.length ? completedSprintRecords : sessionHistory;
  const sprintDrop = average(sprintRecords.map((record) => record.avgDrop));
  const sprintPeak = Math.max(0, ...sprintRecords.map((record) => Number(record.peakHR) || 0));
  const weeklyRows = getVisibleProgram().map((week, weekIndex) => {
    const total = week.workouts.length;
    const done = week.workouts.filter((_, workoutIndex) => getWorkoutCompletion(weekIndex, workoutIndex)).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  });
  const nextWorkout = slots.find((slot) => !getWorkoutCompletion(slot.weekIndex, slot.workoutIndex));
  const nextCopy = nextWorkout ? `${nextWorkout.week.label} / ${nextWorkout.workout.day} / ${nextWorkout.workout.type}` : 'Camp complete';
  const latestRunCopy = latestRun ? `${latestRun.week.label} / ${latestRun.workout.type} / ${formatDistance(latestRun.log.distance)} mi` : 'No run logged yet';
  const mileCopy = mileTest ? `${formatWholeNumber(mileTest.totalMinutes)} min / ${formatWholeNumber(mileTest.maxBpm)} max bpm` : 'No Mile Test saved yet';
  root.innerHTML = `
    <article class="dash-card dash-progress-card"><div><div class="info-kicker">Progress Dashboard</div><h3>${escapeHTML(profile.athleteName || 'Fighter')} is ${completionPct}% through camp.</h3><p>${completedWorkouts} of ${totalWorkouts} roadwork sessions completed across the ${getCampWeekLimit()} week plan.</p></div><div class="dash-ring" style="--progress:${completionPct * 3.6}deg" aria-label="${completionPct}% complete"><strong>${completionPct}%</strong><span>${completedWorkouts}/${totalWorkouts}</span></div></article>
    <div class="dash-stat-grid"><article class="dash-card dash-stat-card"><span>Distance</span><strong>${formatDistance(totalMiles)}</strong><em>miles logged</em></article><article class="dash-card dash-stat-card"><span>Total Time</span><strong>${formatWholeNumber(totalMinutes)}</strong><em>minutes logged</em></article><article class="dash-card dash-stat-card"><span>Avg Run HR</span><strong>${formatWholeNumber(averageRunHR)}</strong><em>bpm</em></article><article class="dash-card dash-stat-card"><span>Sprint Drop</span><strong>${formatWholeNumber(sprintDrop)}</strong><em>avg bpm</em></article></div>
    <article class="dash-card dash-chart-card"><div class="dash-card-head"><div><span>Weekly Completion</span><strong>Camp work by week</strong></div><em>${completedWorkouts}/${totalWorkouts}</em></div><div class="week-bar-list">${weeklyRows.map((row, index) => `<div class="week-bar-row"><span>W${index + 1}</span><div class="week-bar-track"><i style="width:${row.pct}%"></i></div><em>${row.done}/${row.total}</em></div>`).join('')}</div></article>
    <div class="dash-detail-grid"><article class="dash-card dash-detail-card"><span>Latest Run</span><strong>${escapeHTML(latestRunCopy)}</strong><p>${latestRun ? `${formatWholeNumber(latestRun.log.totalMinutes)} min / ${formatWholeNumber(latestRun.log.avgBpm)} avg bpm / ${formatDashboardDate(latestRun.completion.completedAt)}` : 'Complete a non-sprint workout to fill this in.'}</p></article><article class="dash-card dash-detail-card"><span>HR Profile</span><strong>${formatWholeNumber(hrInfo.maxHr)} max / ${formatWholeNumber(hrInfo.restingHr)} resting</strong><p>Mile Test: ${escapeHTML(mileCopy)}</p></article><article class="dash-card dash-detail-card"><span>Next Up</span><strong>${escapeHTML(nextCopy)}</strong><p>${nextWorkout ? 'Open the week plan when you are ready to complete it.' : 'Everything currently visible in this camp is marked complete.'}</p></article><article class="dash-card dash-detail-card"><span>Sprint Work</span><strong>${sprintRecords.length ? `${sprintRecords.length} session${sprintRecords.length === 1 ? '' : 's'}` : 'No sprint data yet'}</strong><p>${sprintRecords.length ? `${formatWholeNumber(sprintPeak)} peak bpm across saved sprint work.` : 'Finish a sprint timer session to see recovery stats.'}</p></article></div>`;
}
function isProfileFormCollapsed(profile = getAthleteProfile()) {
  if (!profile.athleteName) return false;
  const stored = localStorage.getItem(PROFILE_FORM_COLLAPSED_KEY);
  return stored === null ? true : stored === '1';
}
function setProfileFormCollapsed(isCollapsed) { localStorage.setItem(PROFILE_FORM_COLLAPSED_KEY, isCollapsed ? '1' : '0'); renderAthleteProfilePage(); }
function syncProfileFormCollapse(profile = getAthleteProfile()) {
  const panel = document.getElementById('profile-form-panel');
  const content = document.getElementById('profile-form-content');
  const btn = document.getElementById('profile-form-toggle-btn');
  if (!content || !btn) return;
  const isCollapsed = isProfileFormCollapsed(profile);
  content.hidden = isCollapsed;
  panel?.classList.toggle('collapsed', isCollapsed);
  btn.textContent = isCollapsed ? 'EDIT' : 'HIDE';
  btn.setAttribute('aria-expanded', String(!isCollapsed));
}
function renderAthleteProfilePage() {
  const profile = getAthleteProfile();
  setInputValue('profile-athlete-name', profile.athleteName);
  setInputValue('profile-age-input', profile.age);
  setInputValue('profile-gender-select', profile.gender);
  setInputValue('profile-gender-detail-input', profile.genderDetail);
  setInputValue('profile-tenure-select', profile.trainingTenure);
  setInputValue('profile-fight-date-input', profile.fightDate);
  setInputValue('profile-camp-length-select', profile.campLength || '7');
  renderHeaderProfile();
  renderAthleteProfileDashboard();
  syncProfileFormCollapse(profile);
}
function clearLocalTestData() {
  if (!window.confirm('Clear local test data on this device? This resets profile, HR info, mile test, completed workouts, sprint history, pending sync, and onboarding.')) return;
  [PROFILE_STORAGE_KEY, STORAGE_KEY, SYNC_QUEUE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY, HR_INFO_STORAGE_KEY, MILE_TEST_STORAGE_KEY, AUTH_USER_STORAGE_KEY, SC_MODE_STORAGE_KEY, SC_WEEK_STORAGE_KEY, WEEK_INDEX_KEY, PROFILE_FORM_COLLAPSED_KEY, ONBOARDING_DISMISSED_KEY].forEach((key) => localStorage.removeItem(key));
  activeWeekIndex = 0;
  scMode = 'Gym Machines';
  scWeek = 1;
  saveWeek(0);
  renderShell();
  renderAthleteProfilePage();
  renderWelcomePage();
  renderHRInfoPage();
  renderSCPage();
  renderMileTestPage();
  maybeShowOnboarding();
  shellHooks?.showToast?.('LOCAL TEST DATA CLEARED');
}
async function saveAthleteProfileFromInputs() {
  let profile = saveAthleteProfile({
    athleteName: readInputValue('profile-athlete-name'),
    age: readInputValue('profile-age-input'),
    gender: readInputValue('profile-gender-select'),
    genderDetail: readInputValue('profile-gender-detail-input'),
    trainingTenure: readInputValue('profile-tenure-select'),
    primaryDiscipline: '',
    weightClass: '',
    fightDate: readInputValue('profile-fight-date-input'),
    campLength: readInputValue('profile-camp-length-select') || '7',
  });

  let cloudSaved = false;
  if (profile.athleteName && isSupabaseConfigured && getCurrentUser()) {
    try {
      const cloudProfile = await saveCloudProfile(profile);
      if (cloudProfile) profile = saveAthleteProfile(cloudProfile);
      cloudSaved = true;
    } catch (error) {
      console.warn('Cloud profile save failed', error);
      shellHooks?.showToast?.('PROFILE SAVED LOCALLY');
    }
  }

  if (profile.athleteName) {
    localStorage.setItem(PROFILE_FORM_COLLAPSED_KEY, '1');
    enqueueProfileForSync(profile);
    flushQueuedEvent('PROFILE SYNCED');
  }
  saveWeek(activeWeekIndex);
  scWeek = clampSCWeek(scWeek);
  renderAthleteProfilePage();
  renderShell();
  renderSCPage();
  maybeShowOnboarding();
  if (!profile.athleteName) shellHooks?.showToast?.('PROFILE SAVED - NAME STILL BLANK');
  else shellHooks?.showToast?.(cloudSaved ? `PROFILE SAVED TO ACCOUNT - ${profile.campLength} WEEK CAMP` : `PROFILE SAVED - ${profile.campLength} WEEK CAMP`);
}
function workoutTag(workout) {
  if (workout.action === 'sprint') return 'Timer Ready';
  if (workout.action === 'mile-test') return 'Mile Test';
  if (/benchmark/i.test(workout.type)) return 'Benchmark';
  if (/easy|shake/i.test(workout.type)) return 'Recovery';
  if (/long/i.test(workout.type)) return 'Volume';
  return 'Run';
}
function getActionCopy(workout, completion = null) {
  if (completion) return hasSessionResults(completion) ? 'RESULTS' : 'EDIT';
  if (workout.action === 'sprint') return 'OPEN TIMER';
  if (workout.action === 'mile-test') return 'OPEN MILE TEST';
  return 'VIEW';
}
function renderShell() {
  activeWeekIndex = clampWeek(activeWeekIndex);
  const week = getWeek(activeWeekIndex);
  setText('current-week-label', `${week.label}: ${week.title}`);
  setText('current-week-focus', week.focus || '');
  renderHeaderProfile();
  const prevBtn = document.getElementById('week-prev-btn');
  const nextBtn = document.getElementById('week-next-btn');
  if (prevBtn) prevBtn.disabled = activeWeekIndex === 0;
  if (nextBtn) nextBtn.disabled = activeWeekIndex >= getCampWeekLimit() - 1;
  const root = document.getElementById('week-workouts');
  if (!root) return;
  root.innerHTML = week.workouts.map((workout, index) => {
    const completion = getWorkoutCompletion(activeWeekIndex, index);
    const targetBPM = getWorkoutTargetBPM(workout);
    return `<button type="button" class="week-workout-card ${completion ? 'completed' : ''}" data-week-index="${activeWeekIndex}" data-workout-index="${index}"><div><div class="field-label week-card-day">${escapeHTML(workout.day)}</div><div class="week-card-title">${escapeHTML(workout.type)}</div><div class="week-card-desc">${escapeHTML(workout.description)}</div></div><div class="week-card-side"><div class="workout-tag">${escapeHTML(completion ? 'Done' : workoutTag(workout))}</div><div class="workout-target">${targetBPM ? `${targetBPM} bpm` : '--'}</div><div class="workout-action">${escapeHTML(getActionCopy(workout, completion))}</div></div></button>`;
  }).join('');
  renderDrawerWeeks();
}
function renderWelcomePage() {
  const root = document.getElementById('welcome-content');
  if (!root) return;
  root.innerHTML = WELCOME_SECTIONS.map((section) => `<a class="welcome-card" href="${escapeHTML(section.docUrl)}" target="_blank" rel="noreferrer"><div class="info-kicker">${escapeHTML(section.group)}</div><h3>${escapeHTML(section.title)}</h3><p>${escapeHTML(section.summary)}</p><ul>${section.bullets.map((bullet) => `<li>${escapeHTML(bullet)}</li>`).join('')}</ul><span class="welcome-card-action">Open Google Doc</span></a>`).join('');
}
function renderHRInfoPage() {
  const hrInfo = getHRInfo();
  setInputValue('hr-goal-weight-input', hrInfo.goalWeight);
  setInputValue('hr-target-date-input', hrInfo.targetDate);
  setInputValue('hr-max-input', Math.round(hrInfo.maxHr));
  setInputValue('hr-resting-input', Math.round(hrInfo.restingHr));
  const root = document.getElementById('hr-zone-list');
  if (root) root.innerHTML = HR_ZONES.map((zone, index) => `<div class="zone-row zone-row-${index}"><div><span>${escapeHTML(zone.label)}</span><strong>${calculateZoneBPM(zone, hrInfo)} bpm</strong></div><em>${escapeHTML(zone.uses.join(' / '))}</em></div>`).join('');
  syncSetupHRInputs(hrInfo);
}
async function saveHRInfoFromInputs() {
  let hrInfo = saveHRInfo({
    goalWeight: parseNumberInput('hr-goal-weight-input', HR_INFO_DEFAULTS.goalWeight),
    targetDate: readInputValue('hr-target-date-input') || HR_INFO_DEFAULTS.targetDate,
    maxHr: parseNumberInput('hr-max-input', HR_INFO_DEFAULTS.maxHr),
    restingHr: parseNumberInput('hr-resting-input', HR_INFO_DEFAULTS.restingHr),
  });

  let cloudSaved = false;
  if (isSupabaseConfigured && getCurrentUser()) {
    try {
      const cloudHRInfo = await saveCloudHRInfo(hrInfo);
      if (cloudHRInfo) hrInfo = saveHRInfo({ ...HR_INFO_DEFAULTS, ...cloudHRInfo });
      cloudSaved = true;
    } catch (error) {
      console.warn('Cloud HR info save failed', error);
      shellHooks?.showToast?.('HR INFO SAVED LOCALLY');
    }
  }

  enqueueHRInfoForSync(hrInfo);
  flushQueuedEvent('HR INFO SYNCED');
  renderHRInfoPage();
  renderShell();
  renderAthleteProfileDashboard();
  shellHooks?.showToast?.(cloudSaved ? 'HR INFO SAVED TO ACCOUNT' : 'HR INFO SAVED');
}
function renderSCPage() {
  scWeek = clampSCWeek(scWeek);
  localStorage.setItem(SC_MODE_STORAGE_KEY, scMode);
  localStorage.setItem(SC_WEEK_STORAGE_KEY, String(scWeek));
  document.querySelectorAll('[data-sc-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.scMode === scMode));
  const tabs = document.getElementById('sc-week-tabs');
  if (tabs) tabs.innerHTML = Array.from({ length: getCampWeekLimit() }, (_, index) => `<button type="button" class="sc-week-btn ${index + 1 === scWeek ? 'active' : ''}" data-sc-week="${index + 1}">W${index + 1}</button>`).join('');
  const list = document.getElementById('sc-session-list');
  if (!list) return;
  const sessions = SC_SESSIONS.filter((session) => session.week === scWeek && session.modality === scMode);
  list.innerHTML = sessions.length ? sessions.map((session) => `<article class="page-panel sc-session-card"><div class="sc-card-head"><div><div class="info-kicker">${escapeHTML(session.day)}</div><h3>${escapeHTML(session.sessionType)}</h3></div><span class="workout-tag">${escapeHTML(session.modality)}</span></div><ul class="exercise-list">${session.exercises.split('|').map((exercise) => `<li>${escapeHTML(exercise.trim())}</li>`).join('')}</ul><div class="sc-metrics"><div><span>Sets x Reps</span><strong>${escapeHTML(session.setsReps)}</strong></div><div><span>Intensity</span><strong>${escapeHTML(session.intensity)}</strong></div><div><span>Rest</span><strong>${escapeHTML(session.rest)}</strong></div></div><p>${escapeHTML(session.notes)}</p></article>`).join('') : '<article class="page-panel"><p>No S&C sessions listed for this week.</p></article>';
}
function renderMileTestPage() {
  setText('mile-test-title', MILE_TEST_INFO.workout);
  setText('mile-test-desc', MILE_TEST_INFO.description);
  setText('mile-test-day', MILE_TEST_INFO.day);
  setText('mile-test-warmup', MILE_TEST_INFO.warmup);
  const link = document.getElementById('mile-warmup-link');
  if (link) link.href = MILE_TEST_INFO.warmupLink;
  const result = getMileTestResult();
  if (result) {
    setInputValue('mile-distance-input', result.distance);
    setInputValue('mile-time-input', result.totalMinutes);
    setInputValue('mile-avg-bpm-input', result.avgBpm);
    setInputValue('mile-max-bpm-input', result.maxBpm);
  }
  const last = document.getElementById('mile-last-result');
  if (last) last.textContent = result ? `Last saved: ${formatDistance(result.distance)} mi / ${formatWholeNumber(result.totalMinutes)} min / ${formatWholeNumber(result.maxBpm)} max bpm / ${formatDashboardDate(result.savedAt)}` : 'No Mile Test saved yet.';
  const locations = document.getElementById('mile-location-list');
  if (locations) locations.innerHTML = MILE_TEST_INFO.locations.map((location) => `<div>${escapeHTML(location)}</div>`).join('');
}
async function saveMileTestResult() {
  const distance = parseNumberInput('mile-distance-input', NaN);
  const totalMinutes = parseNumberInput('mile-time-input', NaN);
  const avgBpm = parseNumberInput('mile-avg-bpm-input', 0);
  const maxBpm = parseNumberInput('mile-max-bpm-input', 0);
  if (![distance, totalMinutes].every((value) => Number.isFinite(value) && value > 0)) { shellHooks?.showToast?.('ENTER DISTANCE AND TIME'); return; }
  if (avgBpm > 999 || maxBpm > 999) { shellHooks?.showToast?.('HR MUST BE 3 DIGITS OR LESS'); return; }
  const result = { distance, totalMinutes, totalSeconds: Math.round(totalMinutes * 60), avgBpm, maxBpm, paceMinPerMile: distance > 0 ? totalMinutes / distance : '', savedAt: new Date().toISOString() };
  writeJSON(MILE_TEST_STORAGE_KEY, result);
  if (maxBpm > 0) saveHRInfo({ ...getHRInfo(), maxHr: maxBpm });
  const testContext = { weekTab: 'Mile Test', workoutType: MILE_TEST_INFO.workout, dayOfWeek: MILE_TEST_INFO.day, description: MILE_TEST_INFO.description, warmup: MILE_TEST_INFO.warmup };
  let cloudSaved = false;
  if (isSupabaseConfigured && getCurrentUser()) {
    try {
      await saveCloudMileTest(result, getHRInfo(), testContext);
      if (maxBpm > 0) await saveCloudHRInfo(getHRInfo());
      cloudSaved = true;
    } catch (error) {
      console.warn('Cloud mile test save failed', error);
    }
  }
  if (getAthleteProfile().athleteName) {
    enqueueMileTestForSync(result, getHRInfo(), testContext);
    flushQueuedEvent('MILE TEST SYNCED');
  }
  renderMileTestPage();
  renderHRInfoPage();
  renderShell();
  renderAthleteProfileDashboard();
  if (cloudSaved) shellHooks?.showToast?.(maxBpm > 0 ? 'MILE TEST SAVED TO ACCOUNT + MAX HR UPDATED' : 'MILE TEST SAVED TO ACCOUNT');
  else shellHooks?.showToast?.(maxBpm > 0 ? 'MILE TEST SAVED + MAX HR UPDATED' : 'MILE TEST SAVED');
}
function renderDrawerWeeks() {
  const root = document.getElementById('drawer-week-list');
  if (!root) return;
  root.innerHTML = getVisibleProgram().map((week, index) => `<button type="button" class="drawer-week-btn ${index === activeWeekIndex ? 'active' : ''}" data-week-index="${index}"><span class="drawer-week-label">Week ${index + 1}</span><strong>${escapeHTML(week.title || week.label)}</strong><em>${escapeHTML(week.focus || '')}</em></button>`).join('');
}
function setWeekDrawerOpen(isOpen) {
  const drawer = document.getElementById('week-drawer');
  const backdrop = document.getElementById('week-drawer-backdrop');
  drawer?.classList.toggle('open', isOpen);
  backdrop?.classList.toggle('open', isOpen);
  drawer?.setAttribute('aria-hidden', String(!isOpen));
}
function openWeekDrawer() { renderDrawerWeeks(); setWeekDrawerOpen(true); }
function closeWeekDrawer() { setWeekDrawerOpen(false); }
function renderPage(screenId) {
  if (screenId === 'home') renderShell();
  if (screenId === 'athlete-profile') renderAthleteProfilePage();
  if (screenId === 'welcome-page') renderWelcomePage();
  if (screenId === 'hr-info') renderHRInfoPage();
  if (screenId === 'sc-page') renderSCPage();
  if (screenId === 'mile-test-page') renderMileTestPage();
}
function setActiveNavigation(screenId) {
  document.querySelectorAll('[data-page-target]').forEach((btn) => btn.classList.toggle('active', btn.dataset.pageTarget === screenId));
}
function dismissOnboarding() {
  localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}
function maybeShowOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  const hasProfile = !!getAthleteProfile().athleteName;
  const dismissed = localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
  modal.hidden = hasProfile || dismissed;
  modal.setAttribute('aria-hidden', String(hasProfile || dismissed));
}
function navigateTo(screenId) {
  closeWeekDrawer();
  renderPage(screenId);
  shellHooks?.showScreen(screenId);
  setActiveNavigation(screenId);
}
function openWorkoutDetail(weekIndex, workoutIndex) {
  const safeWeekIndex = Number(weekIndex);
  const safeWorkoutIndex = Number(workoutIndex);
  const week = getWeek(safeWeekIndex);
  const workout = week.workouts[safeWorkoutIndex] || week.workouts[0];
  const completion = getWorkoutCompletion(safeWeekIndex, safeWorkoutIndex);
  setText('detail-week', `${week.label} / ${workout.day}`);
  setText('detail-title', workout.type);
  setText('detail-desc', workout.description);
  setText('detail-warmup', workout.warmup || 'As assigned');
  setText('detail-zone', workout.targetZone || '--');
  const targetBPM = getWorkoutTargetBPM(workout);
  setText('detail-bpm', targetBPM ? String(targetBPM) : '--');
  const actionType = ['sprint', 'mile-test'].includes(workout.action) ? workout.action : 'complete-workout';
  setDetailWorkoutLog(actionType === 'complete-workout', completion, workout);
  const action = document.getElementById('detail-action-btn');
  if (action) {
    const isCompleted = !!completion;
    const isLoggedWorkout = actionType === 'complete-workout';
    action.textContent = isLoggedWorkout ? (isCompleted ? 'SAVE CHANGES' : 'COMPLETE WORKOUT') : (isCompleted ? 'WORKOUT COMPLETE' : getActionCopy(workout));
    action.disabled = isLoggedWorkout ? !readDetailWorkoutLog({ silent: true }) : isCompleted;
    action.classList.toggle('completed', isCompleted && !isLoggedWorkout);
    action.dataset.action = actionType;
    action.dataset.weekIndex = String(safeWeekIndex);
    action.dataset.workoutIndex = String(safeWorkoutIndex);
  }
  const clearBtn = document.getElementById('detail-clear-completion-btn');
  if (clearBtn) {
    clearBtn.hidden = !(actionType === 'complete-workout' && completion);
    clearBtn.dataset.weekIndex = String(safeWeekIndex);
    clearBtn.dataset.workoutIndex = String(safeWorkoutIndex);
  }
  shellHooks?.showScreen('workout-detail');
  setActiveNavigation('');
}
function bindShellEvents() {
  document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
  document.getElementById('auth-mode-toggle-btn')?.addEventListener('click', toggleAuthMode);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('week-prev-btn')?.addEventListener('click', () => { saveWeek(activeWeekIndex - 1); scWeek = activeWeekIndex + 1; renderShell(); renderSCPage(); });
  document.getElementById('week-next-btn')?.addEventListener('click', () => { saveWeek(activeWeekIndex + 1); scWeek = activeWeekIndex + 1; renderShell(); renderSCPage(); });
  document.addEventListener('click', (event) => { const pageBtn = event.target.closest('[data-page-target]'); if (!pageBtn) return; event.preventDefault(); navigateTo(pageBtn.dataset.pageTarget); });
  document.querySelectorAll('[data-open-menu]').forEach((btn) => btn.addEventListener('click', openWeekDrawer));
  document.getElementById('close-week-menu-btn')?.addEventListener('click', closeWeekDrawer);
  document.getElementById('week-drawer-backdrop')?.addEventListener('click', closeWeekDrawer);
  document.getElementById('open-sprint-setup-btn')?.addEventListener('click', () => { shellHooks?.setWorkoutContext?.(null); shellHooks?.showScreen('setup'); setActiveNavigation(''); });
  document.getElementById('setup-back-btn')?.addEventListener('click', () => navigateTo('home'));
  document.getElementById('detail-back-btn')?.addEventListener('click', () => navigateTo('home'));
  document.querySelectorAll('#detail-log-card input').forEach((input) => input.addEventListener('input', handleDetailLogInput));
  document.getElementById('detail-total-minutes-input')?.addEventListener('blur', normalizeDetailDurationInput);
  document.getElementById('detail-clear-completion-btn')?.addEventListener('click', (event) => clearCompletionFromDetail(event.currentTarget.dataset.weekIndex, event.currentTarget.dataset.workoutIndex));
  document.getElementById('detail-action-btn')?.addEventListener('click', (event) => {
    if (event.currentTarget.dataset.action === 'sprint') {
      const weekIndex = Number(event.currentTarget.dataset.weekIndex || activeWeekIndex);
      const workoutIndex = Number(event.currentTarget.dataset.workoutIndex || 0);
      const week = getWeek(weekIndex);
      const workout = week.workouts[workoutIndex] || week.workouts[0];
      shellHooks?.setWorkoutContext?.(buildWorkoutContext(week, workout, weekIndex, workoutIndex));
      shellHooks?.showScreen('setup');
      setActiveNavigation('');
    } else if (event.currentTarget.dataset.action === 'mile-test') {
      navigateTo('mile-test-page');
    } else if (event.currentTarget.dataset.action === 'complete-workout') {
      completeWorkoutFromDetail(event.currentTarget.dataset.weekIndex, event.currentTarget.dataset.workoutIndex);
    }
  });
  document.getElementById('week-workouts')?.addEventListener('click', (event) => {
    const card = event.target.closest('.week-workout-card');
    if (!card) return;
    const completion = getWorkoutCompletion(card.dataset.weekIndex, card.dataset.workoutIndex);
    if (completion && hasSessionResults(completion)) { shellHooks?.showSavedWorkoutResult?.(completion); setActiveNavigation(''); return; }
    openWorkoutDetail(card.dataset.weekIndex, card.dataset.workoutIndex);
  });
  document.getElementById('drawer-week-list')?.addEventListener('click', (event) => { const btn = event.target.closest('.drawer-week-btn'); if (!btn) return; saveWeek(Number(btn.dataset.weekIndex)); scWeek = activeWeekIndex + 1; renderShell(); renderSCPage(); navigateTo('home'); });
  document.getElementById('save-athlete-profile-btn')?.addEventListener('click', saveAthleteProfileFromInputs);
  document.getElementById('clear-test-data-btn')?.addEventListener('click', clearLocalTestData);
  document.getElementById('profile-form-toggle-btn')?.addEventListener('click', () => setProfileFormCollapsed(!isProfileFormCollapsed()));
  document.getElementById('save-hr-info-btn')?.addEventListener('click', saveHRInfoFromInputs);
  document.querySelectorAll('[data-sc-mode]').forEach((btn) => btn.addEventListener('click', () => { scMode = btn.dataset.scMode; renderSCPage(); }));
  document.getElementById('sc-week-tabs')?.addEventListener('click', (event) => { const btn = event.target.closest('[data-sc-week]'); if (!btn) return; scWeek = clampSCWeek(btn.dataset.scWeek); renderSCPage(); });
  document.getElementById('save-mile-test-btn')?.addEventListener('click', saveMileTestResult);
  document.getElementById('onboarding-close-btn')?.addEventListener('click', dismissOnboarding);
  document.getElementById('onboarding-profile-btn')?.addEventListener('click', () => { dismissOnboarding(); navigateTo('athlete-profile'); setProfileFormCollapsed(false); });
  document.getElementById('onboarding-hr-btn')?.addEventListener('click', () => { dismissOnboarding(); navigateTo('hr-info'); });
  document.getElementById('onboarding-home-btn')?.addEventListener('click', () => { dismissOnboarding(); navigateTo('home'); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeWeekDrawer(); });
}
export async function initAthleteShell(hooks) {
  shellHooks = hooks;
  saveWeek(activeWeekIndex);
  scWeek = clampSCWeek(scWeek);
  bindShellEvents();
  window.addEventListener('ringready:workout-completed', (event) => {
    renderShell();
    renderAthleteProfileDashboard();
    if (event.detail) saveWorkoutCompletionToCloud(event.detail);
  });
  window.addEventListener('ringready:workout-completion-cleared', (event) => {
    renderShell();
    renderAthleteProfileDashboard();
    if (event.detail) deleteWorkoutCompletionFromCloud(event.detail.weekIndex, event.detail.workoutIndex);
  });
  window.addEventListener('ringready:sprint-session-saved', (event) => {
    if (event.detail) saveSprintSessionToCloud(event.detail);
  });

  renderAllPages();
  renderAuthUI();

  if (!isSupabaseConfigured) {
    enterAppHome();
    return;
  }

  try {
    const session = await initSupabaseAuth(handleAuthStateChange);
    if (!session) {
      showAuthScreen();
      return;
    }
    await hydrateCloudData();
    enterAppHome();
  } catch (error) {
    console.warn('Supabase auth init failed', error);
    showAuthScreen('Could not connect to accounts. Try refreshing in a moment.');
  }
}