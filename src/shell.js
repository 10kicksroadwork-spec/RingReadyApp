import {
  PROFILE_STORAGE_KEY,
  STORAGE_KEY,
  WORKOUT_COMPLETIONS_STORAGE_KEY,
} from './constants.js';
import {
  clearSharedLocalState,
  shouldClearSharedStateOnSwitch,
  shouldFailClosedClearSharedCache,
} from './account-switch.js';
import { clearActiveSessionCheckpoint, clearActiveSessionCheckpointsForAllUsers } from './session-checkpoint.js';
import { getHRInfo, saveHRInfo } from './hr-local.js';
import {
  clearSyncQueueForUser,
  quarantineLegacySyncQueue,
} from './sync.js';
import { PROGRAM, getWeek, getSprintConfig } from './program.js';
import {
  HR_INFO_DEFAULTS,
  HR_INFO_STORAGE_KEY,
  HR_ZONES,
  MILE_TEST_INFO,
  MILE_TEST_STORAGE_KEY,
  SC_MODE_STORAGE_KEY,
  SC_SESSIONS,
  SC_WEEK_STORAGE_KEY,
  WELCOME_SECTIONS,
  SESSION_AVG_RANGE_BPM,
  THRESHOLD_GUIDANCE,
  FIGHT_PACE_GUIDANCE,
  ZONE2_GUIDANCE,
  BENCHMARK_GUIDANCE,
  TEMPO_GUIDANCE,
  SPRINT_GUIDANCE,
  SHADOWBOXING_GUIDANCE,
  MILE_TEST_GUIDANCE,
  BREATHING_VIDEO_URL,
} from './app-content.js';
import {
  enqueueDailyWorkoutForSync,
  enqueueHRInfoForSync,
  enqueueMileTestForSync,
  enqueueProfileForSync,
  enqueueWorkoutProofForSync,
  flushSyncQueue,
  getAthleteProfile,
  saveAthleteProfile,
} from './sync.js';
import { getWorkoutCompletion, getWorkoutCompletions, isWorkoutCompletionCleared, markWorkoutCompletionCleared, removeWorkoutCompletion, saveWorkoutCompletion, finalizeWorkoutCompletionRecord, persistWorkoutCompletion, clearWorkoutCompletionClearedMarker, getCloudPendingSprintSessions, clearSessionCloudPending } from './storage.js';
import { parseDurationMinutes, sanitizeDurationInput } from './workout.js';
import {
  calculateZoneBPM,
  getExpectedSessionAvgTarget,
  getIntervalPlan,
  getZone2BPM,
} from './hr-analytics.js';
import {
  applyCompletionActionState,
  buildHrChecklistItem,
  buildNumericChecklistItem,
  buildProofChecklistItem,
  renderCompletionHints,
} from './completion-hints.js';
import {
  buildWorkoutLogModalityFields,
  formatModalityLabel,
  getModalityMeta,
  MODALITY_RUNNING,
  normalizeModality,
  readOutputFromWorkoutLog,
} from './modality.js';
import {
  canAccessCoachScreens,
  initCoachPreview,
  isCoachScreen,
  openCoachPreviewIfRequested,
  refreshCoachPreview,
  renderCoachPage,
  setSelectedCoachAthlete,
  syncCoachPreviewChrome,
} from './coach-preview.js';
import {
  archiveAndResetCamp,
  clearAuthRedirectParams,
  clearCloudWorkoutCompletionWithProof,
  deleteCloudWorkoutCompletion,
  ensureCloudMileTestIdentity,
  ensureCloudWorkoutIdentity,
  getCurrentUser,
  initSupabaseAuth,
  isCoachUser,
  isPasswordRecoveryRedirect,
  loadCloudHRInfo,
  loadCloudMileTest,
  loadCloudProfile,
  loadCloudSprintSessions,
  loadCloudWorkoutCompletions,
  requestPasswordReset,
  saveCloudHRInfo,
  saveCloudMileTest,
  saveCloudProfile,
  saveCloudSprintSession,
  saveCloudWorkoutCompletion,
  rollbackCloudMileTestIdentity,
  rollbackCloudWorkoutIdentity,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  updatePassword,
} from './auth.js';
import { isSupabaseConfigured } from './supabase-client.js';
import {
  PROOF_POLICY_VERSION,
  buildProgramProofKey,
  ensureWorkoutProofUploaded,
  hasPendingWorkoutProof,
  hasWorkoutProof,
  initWorkoutProof,
} from './proof.js';
import { performSignOutCleanup } from './logout.js';
import { resolveCanonicalClientRecordId } from './proof-staging.js';
import { shouldRollbackProvisionalIdentity } from './proof-diagnostics.js';
import {
  athleteFacingWorkoutSaveError,
  doesCloudCompletionMatchRequestedSave,
  isReconcileableUniqueConflict,
} from './workout-completion-identity.js';
import { OPERATION_TIMEOUT_MS, withOperationTimeout } from './operation-timeout.js';
import { runSingleFlight } from './single-flight.js';
import { withSavingButton } from './ui.js';
import {
  getStorageItem,
  readJSONValue,
  removeStorageKey,
  setStorageItem,
  writeJSON,
} from './safe-storage.js';

const WEEK_INDEX_KEY = 'ringReadyActiveWeekIndex';
const PROFILE_FORM_COLLAPSED_KEY = 'ringReadyProfileFormCollapsed';
const PROGRAM_GUIDE_COLLAPSED_KEY = 'ringReadyProgramGuideCollapsed';
const ONBOARDING_DISMISSED_KEY = 'ringReadyOnboardingDismissed';
const AUTH_USER_STORAGE_KEY = 'ringReadyAuthUserId';
const WORKOUT_NOTES_STORAGE_KEY = 'ringReadyWorkoutNotes';
const CAMP_RESET_SEEN_KEY = 'ringReadyCampResetAtSeen';
const WORKOUT_NOTE_MAX_LENGTH = 200;
const DETAIL_MODALITY_NOTE_KEY = 'ringReadyModalitySwitchNoteSeen';

let hydrationGeneration = 0;
/** Bumped on athlete completion save/clear/recomplete so in-flight cloud reads cannot erase newer local state. */
let completionMutationEpoch = 0;

function noteCompletionMutation() {
  completionMutationEpoch += 1;
}

function shouldApplyCompletionHydration(completionEpochAtStart) {
  return Number(completionEpochAtStart) === completionMutationEpoch;
}

let activeWeekIndex = Number(getStorageItem(WEEK_INDEX_KEY).value || 0);
let scMode = getStorageItem(SC_MODE_STORAGE_KEY).value || 'Gym Machines';
let scWeek = Number(getStorageItem(SC_WEEK_STORAGE_KEY).value || activeWeekIndex + 1);
let shellHooks = null;
let authMode = 'sign-in';
let passwordRecoveryPending = false;
let activeMileTestContext = { testKey: 'mile-test:baseline', workoutContext: null };
let detailModality = MODALITY_RUNNING;
let detailModalityInitialized = false;

function readJSON(key, fallback) {
  return readJSONValue(key, fallback);
}

function persistJSON(key, value) {
  const result = writeJSON(key, value);
  if (!result.ok) {
    console.warn(`Could not write ${key}`, result.error);
    return false;
  }
  return result.persisted === true;
}
function escapeHTML(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function openExternalLink(url) {
  if (!url) return;
  try {
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (!popup) window.location.assign(url);
  } catch {
    window.location.assign(url);
  }
}
function renderWarmupCard(workout) {
  const warmupCard = document.getElementById('detail-warmup-card');
  const warmupValue = document.getElementById('detail-warmup');
  if (!warmupCard || !warmupValue) return;

  const warmupText = String(workout.warmup || '').trim();
  const videoUrl = workout.videoUrl || '';
  const hasVideo = Boolean(videoUrl);
  warmupCard.hidden = !warmupText && !hasVideo;
  if (!warmupText && !hasVideo) {
    warmupCard.classList.remove('warmup-card-link');
    warmupCard.removeAttribute('role');
    warmupCard.removeAttribute('tabindex');
    warmupCard.onclick = null;
    warmupCard.onkeydown = null;
    warmupValue.replaceChildren();
    return;
  }

  warmupValue.innerHTML = hasVideo
    ? `${escapeHTML(warmupText)}<a class="secondary-link warmup-video-link" href="${escapeHTML(videoUrl)}" target="_blank" rel="noopener noreferrer">WATCH WARMUP VIDEO</a>`
    : escapeHTML(warmupText);

  warmupCard.classList.toggle('warmup-card-link', hasVideo);
  warmupCard.setAttribute('role', hasVideo ? 'button' : 'group');
  warmupCard.setAttribute('tabindex', hasVideo ? '0' : '-1');

  if (hasVideo) {
    warmupCard.onclick = (event) => {
      if (event.target.closest('a')) return;
      event.preventDefault();
      openExternalLink(videoUrl);
    };
    warmupCard.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openExternalLink(videoUrl);
      }
    };
  } else {
    warmupCard.onclick = null;
    warmupCard.onkeydown = null;
  }
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
function parseMileTimeInput(fallback = NaN) {
  const parsed = parseDurationMinutes(readInputValue('mile-time-input'));
  return parsed ? parsed.totalMinutes : fallback;
}
function formatSavedMileDuration(result) {
  if (!result) return null;
  return parseDurationMinutes(result.totalTimeDisplay || result.totalMinutes || (Number(result.totalSeconds) > 0 ? Number(result.totalSeconds) / 60 : ''));
}
function formatWholeNumber(value, fallback = '--') { const num = Number(value); return Number.isFinite(num) && num > 0 ? String(Math.round(num)) : fallback; }
function cleanAuthError(error) {
  const message = String(error?.message || error || 'Account action failed.');
  if (/invalid login credentials/i.test(message)) return 'Email or password did not match.';
  if (/email not confirmed/i.test(message)) return 'Check your email to confirm this account, then sign in.';
  if (/user not found/i.test(message)) return 'No account found for that email.';
  if (/for security purposes/i.test(message)) return 'Please wait a moment before requesting another reset email.';
  if (/same password/i.test(message)) return 'Choose a password you have not used recently.';
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
import {
  getRecordUpdatedAt,
  mergeHRByTimestamp,
  mergeProfileByTimestamp,
  reconcileSprintSessionsFromCloud,
  reconcileWorkoutCompletionsFromCloud,
} from './shell-cloud-merge.js';

function clearAccountLocalData(explicitUserId = '') {
  const userId = String(explicitUserId || getCurrentUser()?.id || '').trim();
  if (userId) {
    clearSyncQueueForUser(userId);
    clearActiveSessionCheckpoint(userId);
  }
  clearSharedLocalState();
}
function clearLocalTrainingData({ markResetAt = '' } = {}) {
  const userId = getCurrentUser()?.id;
  if (userId) clearSyncQueueForUser(userId);
  clearActiveSessionCheckpointsForAllUsers();
  [STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY, MILE_TEST_STORAGE_KEY, WORKOUT_NOTES_STORAGE_KEY, WEEK_INDEX_KEY, SC_WEEK_STORAGE_KEY, 'ringReadyClearedWorkoutCompletions'].forEach((key) => removeStorageKey(key));
  activeWeekIndex = 0;
  scWeek = 1;
  saveWeek(0);
  setStorageItem(SC_WEEK_STORAGE_KEY, '1');
  if (markResetAt) setStorageItem(CAMP_RESET_SEEN_KEY, String(markResetAt));
}
function applyCampResetIfNeeded(cloudProfile) {
  const resetAt = String(cloudProfile?.campResetAt || '').trim();
  if (!resetAt) return false;
  const seen = String(getStorageItem(CAMP_RESET_SEEN_KEY).value || '').trim();
  if (seen === resetAt) return false;
  clearLocalTrainingData({ markResetAt: resetAt });
  return true;
}
function prepareCoachSession() {
  if (!isCoachUser()) return;
  clearAccountLocalData();
  const userId = getCurrentUser()?.id;
  if (userId) setStorageItem(AUTH_USER_STORAGE_KEY, userId);
}
async function boundedCloudWrite(label, writer) {
  try {
    await withOperationTimeout(writer(), {
      timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_HYDRATION,
      operation: `cloud_hydration_${label}`,
    });
    return { ok: true };
  } catch (error) {
    console.warn(`Cloud ${label} write failed`, error);
    return { ok: false, error };
  }
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
function setAuthStatus(message = '', isError = false) {
  const el = document.getElementById('auth-status');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
}
function renderAuthUI() {
  const isSignUp = authMode === 'sign-up';
  const isForgot = authMode === 'forgot';
  const isUpdate = authMode === 'update-password';

  if (isUpdate) {
    setText('auth-copy', 'Choose a new password for your Ring Ready account.');
    setText('auth-submit-btn', 'SAVE NEW PASSWORD');
    setText('auth-mode-toggle-btn', 'Back to sign in');
  } else if (isForgot) {
    setText('auth-copy', 'Enter your account email and we will send a reset link.');
    setText('auth-submit-btn', 'SEND RESET LINK');
    setText('auth-mode-toggle-btn', 'Back to sign in');
  } else {
    setText('auth-copy', isSignUp ? 'Create your Ring Ready account so your profile can follow you across devices.' : 'Sign in to save your profile and training history to your account.');
    setText('auth-submit-btn', isSignUp ? 'CREATE ACCOUNT' : 'SIGN IN');
    setText('auth-mode-toggle-btn', isSignUp ? 'Already have an account? Sign in' : 'Create an account instead');
  }

  const emailWrap = document.getElementById('auth-email-wrap');
  const emailInput = document.getElementById('auth-email-input');
  const passwordWrap = document.getElementById('auth-password-wrap');
  const password = document.getElementById('auth-password-input');
  const passwordLabel = document.getElementById('auth-password-label');
  const confirmWrap = document.getElementById('auth-password-confirm-wrap');
  const confirmInput = document.getElementById('auth-password-confirm-input');
  const forgotBtn = document.getElementById('auth-forgot-btn');

  if (emailWrap) emailWrap.hidden = isUpdate;
  if (emailInput) {
    emailInput.required = !isUpdate;
    emailInput.disabled = isUpdate;
  }
  if (passwordWrap) passwordWrap.hidden = isForgot;
  if (password) {
    password.required = !isForgot;
    password.disabled = isForgot;
    password.value = isForgot ? '' : password.value;
    password.autocomplete = isSignUp || isUpdate ? 'new-password' : 'current-password';
    password.placeholder = isUpdate ? 'New password (8+ characters)' : '8+ characters';
  }
  if (passwordLabel) passwordLabel.textContent = isUpdate ? 'New Password' : 'Password';
  if (confirmWrap) confirmWrap.hidden = !isUpdate;
  if (confirmInput) {
    confirmInput.required = isUpdate;
    confirmInput.disabled = !isUpdate;
    if (!isUpdate) confirmInput.value = '';
  }
  if (forgotBtn) forgotBtn.hidden = isSignUp || isForgot || isUpdate;
  window.dispatchEvent(new CustomEvent('ringready:auth-mode-changed', { detail: { mode: authMode } }));
}
function enterPasswordRecoveryMode(message = 'Choose a new password to finish resetting your account.') {
  passwordRecoveryPending = true;
  authMode = 'update-password';
  showAuthScreen(message);
}
function renderAllPages() {
  renderShell();
  renderAthleteProfilePage();
  renderWelcomePage();
  renderHRInfoPage();
  renderSCPage();
  renderMileTestPage();
  syncCoachPreviewChrome();
  syncSignOutControls();
}
function enterAppHome() {
  renderAllPages();
  if (openCoachPreviewIfRequested()) return;
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
function invalidateCloudHydration() {
  hydrationGeneration += 1;
}

function prepareAccountSwitchSafety() {
  if (!isSupabaseConfigured || !getCurrentUser()) return;
  invalidateCloudHydration();
  const user = getCurrentUser();
  const ownerResult = getStorageItem(AUTH_USER_STORAGE_KEY, null);
  if (!ownerResult.ok) {
    clearSharedLocalState();
  } else {
    const lastUserId = ownerResult.value;
    if (
      shouldClearSharedStateOnSwitch(lastUserId, user.id)
      || shouldFailClosedClearSharedCache(lastUserId, user.id)
    ) {
      clearSharedLocalState();
    }
  }
  setStorageItem(AUTH_USER_STORAGE_KEY, user.id);
  quarantineLegacySyncQueue();
}

function shouldApplyCloudHydration(userId, generation) {
  return String(getCurrentUser()?.id || '') === String(userId || '') && generation === hydrationGeneration;
}

function captureClientStateOwner() {
  return {
    userId: getCurrentUser()?.id || '',
    generation: hydrationGeneration,
  };
}

function shouldApplyClientStateMutation(owner) {
  return shouldApplyCloudHydration(owner?.userId, owner?.generation);
}

async function boundedCloudLoad(label, loader) {
  try {
    const value = await withOperationTimeout(loader(), {
      timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_HYDRATION,
      operation: `cloud_hydration_${label}`,
    });
    return { ok: true, value };
  } catch (error) {
    console.warn(`Cloud ${label} load failed`, error);
    return { ok: false, error };
  }
}

async function boundedTargetedRehydrate(owner, task) {
  if (!shouldApplyClientStateMutation(owner)) return false;
  try {
    await withOperationTimeout(task(), {
      timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_HYDRATION,
      operation: 'targeted_rehydrate',
    });
    return shouldApplyClientStateMutation(owner);
  } catch (error) {
    console.warn('Targeted rehydrate failed', error);
    return false;
  }
}

async function applyCloudHydrationResults(userId, generation, {
  profileResult,
  hrResult,
  completionsResult,
  sessionsResult,
  mileResult,
} = {}, completionEpochAtStart = completionMutationEpoch) {
  if (!shouldApplyCloudHydration(userId, generation)) return;

  if (profileResult?.ok) {
    const cloudProfile = profileResult.value;
    if (cloudProfile && hasProfileData(cloudProfile)) {
      applyCampResetIfNeeded(cloudProfile);
      saveAthleteProfile(
        mergeProfileByTimestamp(getAthleteProfile(), cloudProfile),
        { preserveUpdatedAt: true },
      );
    }
  }

  if (!shouldApplyCloudHydration(userId, generation)) return;

  if (hrResult?.ok) {
    const cloudHRInfo = hrResult.value;
    if (cloudHRInfo && hasCustomHRInfo(cloudHRInfo)) {
      saveHRInfo(
        mergeHRByTimestamp(getHRInfo(), cloudHRInfo, HR_INFO_DEFAULTS),
        { preserveUpdatedAt: true },
      );
    }
  }

  if (!shouldApplyCloudHydration(userId, generation)) return;

  const pendingSessions = getCloudPendingSprintSessions();

  if (completionsResult?.ok) {
    if (!shouldApplyCompletionHydration(completionEpochAtStart)) {
      // Athlete mutated completions while this cloud read was in flight — keep local authority.
    } else {
      const cloudCompletions = completionsResult.value || {};
      const mergedCompletions = reconcileWorkoutCompletionsFromCloud(
        cloudCompletions,
        isWorkoutCompletionCleared,
        (key) => {
          const [weekIndex, workoutIndex] = key.split(':').map(Number);
          clearWorkoutCompletionClearedMarker(weekIndex, workoutIndex);
        },
      );
      writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, mergedCompletions);
    }
  }

  if (!shouldApplyCloudHydration(userId, generation)) return;

  if (sessionsResult?.ok) {
    const cloudSessions = sessionsResult.value || [];
    const mergedSessions = reconcileSprintSessionsFromCloud(cloudSessions, pendingSessions);
    writeJSON(STORAGE_KEY, mergedSessions);
  }

  if (!shouldApplyCloudHydration(userId, generation)) return;

  if (mileResult?.ok) {
    const cloudMileTest = mileResult.value ?? null;
    if (cloudMileTest) writeJSON(MILE_TEST_STORAGE_KEY, cloudMileTest);
    else removeStorageKey(MILE_TEST_STORAGE_KEY);
  }

  if (!shouldApplyCloudHydration(userId, generation)) return;

  renderAllPages();

  void runCloudHydrationMaintenance(userId, generation, {
    profileResult,
    hrResult,
    completionsResult,
    sessionsResult,
    mileResult,
  }, completionEpochAtStart).catch((error) => {
    console.warn('Background cloud hydration maintenance failed', error);
  });
}

async function runCloudHydrationMaintenance(userId, generation, {
  profileResult,
  hrResult,
  completionsResult,
} = {}, completionEpochAtStart = completionMutationEpoch) {
  if (!shouldApplyCloudHydration(userId, generation)) return;

  const maintenanceTasks = [];

  if (profileResult?.ok) {
    const cloudProfile = profileResult.value;
    const localProfile = getAthleteProfile();
    if (cloudProfile && hasProfileData(cloudProfile) && getRecordUpdatedAt(localProfile) > getRecordUpdatedAt(cloudProfile) && hasProfileData(localProfile)) {
      maintenanceTasks.push(() => boundedCloudWrite('profile_backfill', () => saveCloudProfile(
        mergeProfileByTimestamp(localProfile, cloudProfile),
      )));
    } else if ((!cloudProfile || !hasProfileData(cloudProfile)) && hasProfileData(localProfile)) {
      maintenanceTasks.push(() => boundedCloudWrite('profile_backfill', () => saveCloudProfile(localProfile)));
    }
  }

  if (hrResult?.ok) {
    const cloudHRInfo = hrResult.value;
    const localHRInfo = getHRInfo();
    if (cloudHRInfo && hasCustomHRInfo(cloudHRInfo) && getRecordUpdatedAt(localHRInfo) > getRecordUpdatedAt(cloudHRInfo) && hasCustomHRInfo(localHRInfo)) {
      maintenanceTasks.push(() => boundedCloudWrite('hr_backfill', () => saveCloudHRInfo(
        mergeHRByTimestamp(localHRInfo, cloudHRInfo, HR_INFO_DEFAULTS),
      )));
    } else if ((!cloudHRInfo || !hasCustomHRInfo(cloudHRInfo)) && hasCustomHRInfo(localHRInfo)) {
      maintenanceTasks.push(() => boundedCloudWrite('hr_backfill', () => saveCloudHRInfo(localHRInfo)));
    }
  }

  if (completionsResult?.ok && shouldApplyCompletionHydration(completionEpochAtStart)) {
    const cloudCompletions = completionsResult.value || {};
    Object.keys(cloudCompletions).forEach((key) => {
      const cloudStamp = cloudCompletions[key]?.updatedAt || cloudCompletions[key]?.completedAt || '';
      if (!isWorkoutCompletionCleared(key, null, cloudStamp)) return;
      const [weekIndex, workoutIndex] = key.split(':').map(Number);
      maintenanceTasks.push(() => boundedCloudWrite(`stale_clear_${key}`, () => deleteCloudWorkoutCompletion(weekIndex, workoutIndex)));
    });
  }

  getCloudPendingSprintSessions().forEach((session) => {
    const sessionId = String(session?.id || '');
    if (!sessionId) return;
    maintenanceTasks.push(async () => {
      if (!shouldApplyCloudHydration(userId, generation)) return { ok: false };
      const result = await boundedCloudWrite(`sprint_pending_${sessionId}`, () => saveCloudSprintSession(session));
      if (result.ok && shouldApplyCloudHydration(userId, generation)) {
        const clearResult = clearSessionCloudPending(sessionId);
        if (clearResult.logicalOk && !clearResult.persisted) {
          console.warn('Sprint pending flag cleared only in volatile storage', sessionId);
        }
      }
      return result;
    });
  });

  await Promise.allSettled(maintenanceTasks.map((task) => task()));
}

async function hydrateCloudDataInBackground() {
  if (!isSupabaseConfigured || !getCurrentUser()) return;
  const userId = getCurrentUser().id;
  const generation = hydrationGeneration;
  const completionEpochAtStart = completionMutationEpoch;

  const [
    profileResult,
    hrResult,
    completionsResult,
    sessionsResult,
    mileResult,
  ] = await Promise.all([
    boundedCloudLoad('profile', loadCloudProfile),
    boundedCloudLoad('hr_info', loadCloudHRInfo),
    boundedCloudLoad('workout_completions', loadCloudWorkoutCompletions),
    boundedCloudLoad('sprint_sessions', loadCloudSprintSessions),
    boundedCloudLoad('mile_test', loadCloudMileTest),
  ]);

  await applyCloudHydrationResults(userId, generation, {
    profileResult,
    hrResult,
    completionsResult,
    sessionsResult,
    mileResult,
  }, completionEpochAtStart);
}

function enterSignedInAthleteHome() {
  prepareAccountSwitchSafety();
  enterAppHome();
  hydrateCloudDataInBackground().catch((error) => {
    console.warn('Background cloud hydration failed', error);
  });
}

function enterSignedInCoachHome() {
  prepareCoachSession();
  enterAppHome();
}

async function rehydrateWorkoutCompletionFromCloud(record, owner, completionEpochAtStart = completionMutationEpoch) {
  if (!shouldApplyClientStateMutation(owner)) return false;
  const context = record?.workoutContext || record?.cfg?.workoutContext || {};
  const weekIndex = Number(context.weekIndex);
  const workoutIndex = Number(context.workoutIndex);
  if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) return false;

  const cloudCompletions = await loadCloudWorkoutCompletions();
  // Fail closed: discard if account/generation changed OR an athlete completion
  // mutation landed after this targeted read started (same family as full hydration).
  if (
    !shouldApplyClientStateMutation(owner)
    || !shouldApplyCompletionHydration(completionEpochAtStart)
  ) {
    return false;
  }

  const key = `${weekIndex}:${workoutIndex}`;
  const cloudRecord = cloudCompletions?.[key];
  if (!cloudRecord) return false;

  const completions = getWorkoutCompletions();
  completions[key] = cloudRecord;
  writeJSON(WORKOUT_COMPLETIONS_STORAGE_KEY, completions);
  // Do not bump completionMutationEpoch here — applying a cloud cache refresh is
  // not an athlete completion mutation.
  return shouldApplyClientStateMutation(owner)
    && shouldApplyCompletionHydration(completionEpochAtStart);
}

async function rehydrateMileTestFromCloud(owner) {
  if (!shouldApplyClientStateMutation(owner)) return false;

  const cloudMileTest = await loadCloudMileTest();
  if (!shouldApplyClientStateMutation(owner)) return false;
  if (!cloudMileTest) return false;

  writeJSON(MILE_TEST_STORAGE_KEY, cloudMileTest);
  const cloudHR = await loadCloudHRInfo();
  if (!shouldApplyClientStateMutation(owner)) return false;
  if (cloudHR && hasCustomHRInfo(cloudHR)) {
    saveHRInfo(cloudHR, { preserveUpdatedAt: true });
  }
  return shouldApplyClientStateMutation(owner);
}

function scheduleTargetedWorkoutRehydrate(record) {
  const owner = captureClientStateOwner();
  const completionEpochAtStart = completionMutationEpoch;
  void boundedTargetedRehydrate(
    owner,
    () => rehydrateWorkoutCompletionFromCloud(record, owner, completionEpochAtStart),
  ).catch((error) => {
    console.warn('Background workout rehydrate failed', error);
  });
}

function scheduleTargetedMileRehydrate() {
  const owner = captureClientStateOwner();
  void boundedTargetedRehydrate(owner, () => rehydrateMileTestFromCloud(owner)).catch((error) => {
    console.warn('Background mile rehydrate failed', error);
  });
}

async function persistSignedInWorkoutCompletion(record, {
  existing = null,
  isNewProof = false,
  successToast = 'WORKOUT SAVED TO ACCOUNT',
  updateToast = 'WORKOUT UPDATED IN ACCOUNT',
} = {}) {
  const finalized = finalizeWorkoutCompletionRecord(record);
  if (!finalized) {
    return { success: false, record: null, cloudSaved: false, localCacheFailed: false };
  }

  const signedIn = isSupabaseConfigured && getCurrentUser();
  if (!signedIn) {
    const local = persistWorkoutCompletion(finalized);
    if (local.record) noteCompletionMutation();
    return {
      success: !!local.record,
      record: local.record,
      cloudSaved: false,
      localCacheFailed: !local.localCacheOk,
    };
  }

  try {
    await withOperationTimeout(
      saveCloudWorkoutCompletion(finalized),
      { timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_COMPLETION, operation: 'cloud_completion' },
    );
  } catch (error) {
    console.warn('Cloud workout completion save failed', error);
    if (isReconcileableUniqueConflict(error)) {
      // Soft-success only for position/completion_key conflicts when rehydrate
      // positively matches the requested logical save (Authority).
      const owner = captureClientStateOwner();
      const completionEpochAtStart = completionMutationEpoch;
      let rehydrated = false;
      try {
        rehydrated = await withOperationTimeout(
          rehydrateWorkoutCompletionFromCloud(finalized, owner, completionEpochAtStart),
          { timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_HYDRATION, operation: 'identity_conflict_rehydrate' },
        );
      } catch (rehydrateError) {
        console.warn('Identity-conflict rehydrate failed', rehydrateError);
        rehydrated = false;
      }
      shellHooks?.showToast?.(athleteFacingWorkoutSaveError(error));
      const context = finalized?.workoutContext || finalized?.cfg?.workoutContext || {};
      const restored = getWorkoutCompletion(context.weekIndex, context.workoutIndex);
      if (rehydrated && doesCloudCompletionMatchRequestedSave(restored, finalized)) {
        noteCompletionMutation();
        return {
          success: true,
          record: restored,
          cloudSaved: true,
          localCacheFailed: false,
          identityConflict: true,
        };
      }
      return {
        success: false,
        record: finalized,
        cloudSaved: false,
        localCacheFailed: false,
        error,
        identityConflict: true,
      };
    }
    shellHooks?.showToast?.(athleteFacingWorkoutSaveError(error));
    return { success: false, record: finalized, cloudSaved: false, localCacheFailed: false, error };
  }

  const local = persistWorkoutCompletion(finalized);
  const localCacheFailed = !local.localCacheOk;
  noteCompletionMutation();
  if (localCacheFailed) {
    scheduleTargetedWorkoutRehydrate(finalized);
    shellHooks?.showToast?.('SAVED TO ACCOUNT · LOCAL CACHE WILL REFRESH');
  } else {
    shellHooks?.showToast?.(existing ? updateToast : successToast);
  }

  const savedRecord = local.record || finalized;
  if (!existing && savedRecord?.workoutLog) {
    enqueueDailyWorkoutForSync(savedRecord.workoutLog, savedRecord.workoutContext, savedRecord.id);
  }
  if (isNewProof && savedRecord?.attachment) {
    enqueueWorkoutProofForSync(savedRecord.attachment);
  }
  if (savedRecord) flushQueuedEvent('CLOUD SAVED');

  return {
    success: true,
    record: savedRecord,
    cloudSaved: true,
    localCacheFailed,
  };
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!isSupabaseConfigured) {
    enterAppHome();
    openCoachPreviewIfRequested();
    return;
  }

  const email = readInputValue('auth-email-input');
  const password = readInputValue('auth-password-input');
  const confirmPassword = readInputValue('auth-password-confirm-input');
  const submit = document.getElementById('auth-submit-btn');

  if (authMode === 'forgot') {
    if (!email) {
      setAuthStatus('Enter the email for your account.', true);
      return;
    }
    if (submit) submit.disabled = true;
    setAuthStatus('Sending reset link...');
    try {
      await requestPasswordReset(email);
      authMode = 'sign-in';
      renderAuthUI();
      setAuthStatus('Reset link sent. Check your email, then open the link on this device.');
      shellHooks?.showToast?.('RESET LINK SENT');
    } catch (error) {
      setAuthStatus(cleanAuthError(error), true);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }

  if (authMode === 'update-password') {
    if (password.length < 8) {
      setAuthStatus('Enter a new password with at least 8 characters.', true);
      return;
    }
    if (password !== confirmPassword) {
      setAuthStatus('New password and confirmation did not match.', true);
      return;
    }
    if (submit) submit.disabled = true;
    setAuthStatus('Saving new password...');
    try {
      await updatePassword(password);
      passwordRecoveryPending = false;
      clearAuthRedirectParams();
      if (!isCoachUser()) enterSignedInAthleteHome();
      else enterSignedInCoachHome();
      shellHooks?.showToast?.('PASSWORD UPDATED');
    } catch (error) {
      setAuthStatus(cleanAuthError(error), true);
    } finally {
      if (submit) submit.disabled = false;
    }
    return;
  }

  if (!email || password.length < 8) {
    setAuthStatus('Enter an email and password with at least 8 characters.', true);
    return;
  }

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
    if (!isCoachUser()) enterSignedInAthleteHome();
    else enterSignedInCoachHome();
    shellHooks?.showToast?.(authMode === 'sign-up' ? 'ACCOUNT CREATED' : 'SIGNED IN');
  } catch (error) {
    setAuthStatus(cleanAuthError(error), true);
  } finally {
    if (submit) submit.disabled = false;
  }
}
function toggleAuthMode() {
  if (authMode === 'forgot' || authMode === 'update-password') {
    passwordRecoveryPending = false;
    authMode = 'sign-in';
  } else {
    authMode = authMode === 'sign-up' ? 'sign-in' : 'sign-up';
  }
  renderAuthUI();
  setAuthStatus('');
}
function openForgotPassword() {
  authMode = 'forgot';
  renderAuthUI();
  setAuthStatus('');
  document.getElementById('auth-email-input')?.focus();
}
async function handleLogout() {
  try {
    closeWeekDrawer();
    invalidateCloudHydration();

    const pendingSessions = getCloudPendingSprintSessions();
    if (pendingSessions.length > 0 && isSupabaseConfigured && getCurrentUser()) {
      await Promise.allSettled(pendingSessions.map(async (session) => {
        try {
          await withOperationTimeout(
            saveCloudSprintSession(session),
            { timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_COMPLETION, operation: 'logout_pending_flush' },
          );
          clearSessionCloudPending(String(session?.id || ''));
        } catch (error) {
          console.warn('Logout pending sprint flush failed', error);
        }
      }));

      const stillPending = getCloudPendingSprintSessions();
      if (stillPending.length > 0) {
        const message = stillPending.length === 1
          ? '1 WORKOUT HASN\'T SYNCED YET. SIGN OUT ANYWAY?'
          : `${stillPending.length} WORKOUTS HAVEN'T SYNCED YET. SIGN OUT ANYWAY?`;
        if (!window.confirm(message)) return;
      }
    }

    await performSignOutCleanup({
      getCurrentUser,
      signOut,
      clearAccountLocalData,
    });
    passwordRecoveryPending = false;
    authMode = 'sign-in';
    syncSignOutControls();
    await refreshCoachPreview();
    renderAllPages();
    showAuthScreen('Signed out.');
  } catch (error) {
    shellHooks?.showToast?.(cleanAuthError(error).toUpperCase());
  }
}
function syncSignOutControls() {
  const signedIn = !!(isSupabaseConfigured && getCurrentUser());
  document.querySelectorAll('[data-logout]').forEach((btn) => {
    btn.hidden = !signedIn;
  });
  const drawerAccount = document.getElementById('drawer-account');
  if (drawerAccount) drawerAccount.hidden = !signedIn;
}
function handleAuthStateChange(session, event) {
  if (event === 'PASSWORD_RECOVERY') {
    enterPasswordRecoveryMode();
    return;
  }
  if (event === 'SIGNED_OUT' && isSupabaseConfigured) {
    invalidateCloudHydration();
    passwordRecoveryPending = false;
    authMode = 'sign-in';
    showAuthScreen();
  }
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
function saveWeek(index) { activeWeekIndex = clampWeek(index); setStorageItem(WEEK_INDEX_KEY, String(activeWeekIndex)); }

function calculateZoneBPMFromZone(zone, hrInfo) { return calculateZoneBPM(zone, hrInfo); }
function getWorkoutTargetPcts(workout) {
  const matches = String(workout.targetZone || '').match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return [];
  return matches.map(Number).filter(Number.isFinite);
}
function getWorkoutTargetPct(workout) {
  const values = getWorkoutTargetPcts(workout);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function getWorkoutZoneBounds(workout, hrInfo = getHRInfo()) {
  const values = getWorkoutTargetPcts(workout);
  if (!values.length) return null;
  const lowPct = Math.min(...values);
  const highPct = Math.max(...values);
  const low = calculateZoneBPMFromZone({ pct: lowPct }, hrInfo);
  const high = calculateZoneBPMFromZone({ pct: highPct }, hrInfo);
  return { low, high, lowPct, highPct };
}
function getWorkoutTargetBPM(workout, hrInfo = getHRInfo()) {
  const pct = getWorkoutTargetPct(workout);
  return Number.isFinite(pct) ? calculateZoneBPMFromZone({ pct }, hrInfo) : Number(workout.targetBPM) || null;
}
function getExpectedSessionAvg(workout, hrInfo = getHRInfo()) {
  const plan = getIntervalPlan(workout);
  const targetBPM = getWorkoutTargetBPM(workout, hrInfo);
  const easyBPM = getZone2BPM(hrInfo);
  const expectedAvg = getExpectedSessionAvgTarget({ ...workout, targetBPM, targetPct: getWorkoutTargetPct(workout) }, hrInfo);
  if (!plan || !Number.isFinite(targetBPM) || !Number.isFinite(expectedAvg) || plan.totalMinutes <= 0) return null;
  const range = SESSION_AVG_RANGE_BPM;
  return {
    mode: 'session-avg',
    expectedAvg,
    low: expectedAvg - range,
    high: expectedAvg + range,
    targetBPM,
    easyBPM,
    plan,
    label: 'Expected Session Avg',
    displayValue: String(expectedAvg),
    meta: `Aim ~${expectedAvg - range}–${expectedAvg + range}`,
    bpmNote: 'Hard intervals only',
    kind: 'session-avg',
  };
}
function isZoneCheckWorkout(workout) {
  const type = String(workout?.type || '');
  if (/sprint|mile|fight-?pace|threshold/i.test(type)) return false;
  if (/stride/i.test(type)) return false;
  const bounds = getWorkoutZoneBounds(workout);
  if (!bounds) return false;
  const isZone2 = bounds.lowPct >= 60 && bounds.highPct <= 70;
  const isTempo = bounds.lowPct >= 75 && bounds.highPct <= 80;
  return isZone2 || isTempo || /tempo|benchmark|easy|long run|shake-out|fight-day/i.test(type);
}
function getZoneHrFeedback(workout, hrInfo = getHRInfo()) {
  const bounds = getWorkoutZoneBounds(workout, hrInfo);
  if (!bounds || !isZoneCheckWorkout(workout)) return null;
  return {
    mode: 'zone',
    expectedAvg: null,
    low: bounds.low,
    high: bounds.high,
    label: 'Target Zone BPM',
    displayValue: bounds.low === bounds.high ? String(bounds.low) : `${bounds.low}–${bounds.high}`,
    meta: 'Stay in this range',
    bpmNote: '',
    kind: bounds.lowPct >= 75 && bounds.highPct <= 80 ? 'tempo' : 'zone2',
  };
}
function getHrFeedback(workout, hrInfo = getHRInfo()) {
  return getExpectedSessionAvg(workout, hrInfo) || getZoneHrFeedback(workout, hrInfo);
}
function isSprintWorkout(workout) {
  return workout?.action === 'sprint' || /sprint/i.test(String(workout?.type || ''));
}
function getWorkoutGuidance(workout) {
  const type = String(workout?.type || '');
  if (workout?.action === 'mile-test' || /mile/i.test(type)) return MILE_TEST_GUIDANCE;
  if (/threshold/i.test(type)) return THRESHOLD_GUIDANCE;
  if (/fight-?pace/i.test(type)) return FIGHT_PACE_GUIDANCE;
  if (/tempo/i.test(type)) return TEMPO_GUIDANCE;
  if (/benchmark/i.test(type)) return BENCHMARK_GUIDANCE;
  if (/sprint/i.test(type)) return SPRINT_GUIDANCE;
  if (/shadowbox/i.test(type)) return SHADOWBOXING_GUIDANCE;
  if (isZoneCheckWorkout(workout)) {
    const zone = workout.targetZone || '60-70%';
    return [
      `Stay conversational. Average HR should land in Zone 2 (${zone}).`,
      ...ZONE2_GUIDANCE.slice(1),
    ];
  }
  return null;
}
const HR_FEEDBACK_MILD_MAX = 8;
const HR_FEEDBACK_HARD_MAX = 18;

function getHrMissSeverity(deltaBpm) {
  if (deltaBpm <= HR_FEEDBACK_MILD_MAX) return 'mild';
  if (deltaBpm <= HR_FEEDBACK_HARD_MAX) return 'hard';
  return 'way';
}

function compareHrFeedback(avgBpm, feedback) {
  if (!feedback || !Number.isFinite(avgBpm)) return null;
  const low = Number(feedback.low);
  const high = Number(feedback.high);
  const range = `${low}–${high} bpm`;
  const kind = feedback.kind || (feedback.mode === 'zone' ? 'zone2' : 'session-avg');

  if (avgBpm >= low && avgBpm <= high) {
    const detail = kind === 'session-avg'
      ? `Within expected session average (${range}).`
      : kind === 'tempo'
        ? `Within Tempo range (${range}).`
        : `Within Zone 2 (${range}).`;
    return { tone: 'on-track', severity: 'ok', label: 'On track', detail };
  }

  const isHigh = avgBpm > high;
  const delta = isHigh ? avgBpm - high : low - avgBpm;
  const severity = getHrMissSeverity(delta);
  const copy = getHrMissCopy(kind, isHigh ? 'high' : 'low', severity, range);
  return {
    tone: isHigh ? 'high' : 'low',
    severity,
    label: copy.label,
    detail: copy.detail,
  };
}

function getHrMissCopy(kind, direction, severity, range) {
  if (kind === 'tempo') {
    if (direction === 'high') {
      if (severity === 'mild') return { label: 'A bit high', detail: `Above the Tempo range (${range}). Don’t turn this into Threshold.` };
      if (severity === 'hard') return { label: 'Too hard', detail: 'This was closer to Threshold than Tempo. Back off the pace.' };
      return { label: 'Way too hard', detail: 'This wasn’t Tempo. Save that effort for Threshold / Fight-Pace.' };
    }
    if (severity === 'mild') return { label: 'A bit low', detail: `Below Tempo (${range}). It should feel comfortably hard.` };
    if (severity === 'hard') return { label: 'Too easy', detail: 'This sat in Zone 2. Push a bit so it actually counts as Tempo.' };
    return { label: 'Way too easy', detail: `This wasn’t a Tempo run. Average HR needs to land in ${range}.` };
  }

  if (kind === 'session-avg') {
    if (direction === 'high') {
      if (severity === 'mild') return { label: 'A bit high', detail: `Above expected session average (${range}). Recoveries were probably a bit hard, or the intervals ran hot.` };
      if (severity === 'hard') return { label: 'Session average is high', detail: `Well above expected (${range}). Keep recoveries in Zone 2.` };
      return { label: 'Session average is way high', detail: 'This session average is far above expected. Recoveries likely weren’t easy enough.' };
    }
    if (severity === 'mild') return { label: 'A bit low', detail: `Below expected session average (${range}). Intervals may have been under target.` };
    if (severity === 'hard') return { label: 'Session average is low', detail: `Well below expected (${range}). The hard work likely sat under target.` };
    return { label: 'Session average is way low', detail: 'This session average is far below expected. Check that the intervals actually hit the zone.' };
  }

  if (direction === 'high') {
    if (severity === 'mild') return { label: 'A bit high', detail: `Above Zone 2 (${range}). Keep the next one conversational.` };
    if (severity === 'hard') return { label: 'Too hard', detail: 'This was more Tempo than Zone 2. Slow down so easy days stay easy.' };
    return { label: 'Way too hard', detail: 'This wasn’t a Zone 2 run. Recovery days can’t live up here.' };
  }
  if (severity === 'mild') return { label: 'A bit low', detail: `Below Zone 2 (${range}). Fine if you needed it; otherwise pick the jog up a little.` };
  if (severity === 'hard') return { label: 'Too easy', detail: 'Well under Zone 2. It should still be easy jogging, not a stroll.' };
  return { label: 'Way too easy', detail: 'This looks more like a walk. Get Average HR back into the zone.' };
}
let detailHrFeedback = null;
function buildGuidanceListHTML(bullets, { includeBreathing = true } = {}) {
  const breathingLine = `Remember to <a class="guidance-video-link" href="${escapeHTML(BREATHING_VIDEO_URL)}" target="_blank" rel="noopener noreferrer">breath properly</a> during your run.`;
  return [
    ...bullets.map((line) => `<li>${escapeHTML(line)}</li>`),
    ...(includeBreathing ? [`<li>${breathingLine}</li>`] : []),
  ].join('');
}
function renderDetailGuidance(workout) {
  const card = document.getElementById('detail-guidance-card');
  const list = document.getElementById('detail-guidance-list');
  if (!card || !list) return;
  const bullets = getWorkoutGuidance(workout);
  if (!bullets?.length) {
    card.hidden = true;
    list.innerHTML = '';
    return;
  }
  card.hidden = false;
  const isShadowboxing = /shadowbox/i.test(workout?.type || '');
  list.innerHTML = buildGuidanceListHTML(bullets, { includeBreathing: !isShadowboxing });
}
function setDetailZoneCardVisible(visible) {
  const zoneCard = document.getElementById('detail-zone-card');
  const grid = document.querySelector('#workout-detail .detail-grid');
  if (zoneCard) zoneCard.hidden = !visible;
  grid?.classList.toggle('is-zone-swap', !visible);
}
function syncDetailSprintLayout(workout) {
  const isSprint = isSprintWorkout(workout);
  const grid = document.querySelector('#workout-detail .detail-grid');
  const zoneCard = document.getElementById('detail-zone-card');
  const bpmLabel = document.querySelector('#detail-bpm-card .summary-label');
  const bpmValue = document.getElementById('detail-bpm');
  const bpmNote = document.getElementById('detail-bpm-note');
  grid?.classList.toggle('is-sprint', isSprint);
  if (isSprint) {
    if (zoneCard) zoneCard.hidden = true;
    if (bpmLabel) bpmLabel.textContent = 'Sprint Effort';
    if (bpmValue) {
      bpmValue.classList.remove('big', 'is-range');
      bpmValue.classList.add('is-copy');
    }
    setText('detail-bpm', 'Go all out during each sprint rep.');
    if (bpmNote) {
      bpmNote.hidden = false;
      bpmNote.textContent = 'Recover strong in the rest.';
    }
    return;
  }
  if (bpmLabel) bpmLabel.textContent = 'Target BPM';
  if (bpmValue) {
    bpmValue.classList.add('big');
    bpmValue.classList.remove('is-copy');
  }
  if (zoneCard && !grid?.classList.contains('is-zone-swap')) zoneCard.hidden = false;
}
function hideDetailHrFeedback() {
  const card = document.getElementById('detail-expected-avg-card');
  const bpmNote = document.getElementById('detail-bpm-note');
  const status = document.getElementById('detail-expected-status');
  const valueEl = document.getElementById('detail-expected-avg');
  detailHrFeedback = null;
  if (card) card.hidden = true;
  if (bpmNote) bpmNote.hidden = true;
  if (status) { status.hidden = true; status.textContent = ''; status.className = 'detail-expected-status'; }
  if (valueEl) valueEl.classList.remove('is-range');
  setDetailZoneCardVisible(true);
  setText('detail-expected-avg', '--');
  setText('detail-expected-label', 'Expected Session Avg');
  setText('detail-expected-meta', 'Hard work + recoveries');
}
function renderDetailExpectedAvg(workout) {
  const card = document.getElementById('detail-expected-avg-card');
  const bpmNote = document.getElementById('detail-bpm-note');
  const valueEl = document.getElementById('detail-expected-avg');
  detailHrFeedback = getHrFeedback(workout);
  if (!card) return;
  if (!detailHrFeedback) {
    hideDetailHrFeedback();
    return;
  }
  card.hidden = false;
  setDetailZoneCardVisible(detailHrFeedback.mode !== 'zone');
  if (bpmNote) {
    bpmNote.hidden = !detailHrFeedback.bpmNote;
    bpmNote.textContent = detailHrFeedback.bpmNote || '';
  }
  if (valueEl) valueEl.classList.toggle('is-range', detailHrFeedback.mode === 'zone');
  setText('detail-expected-label', detailHrFeedback.label);
  setText('detail-expected-avg', detailHrFeedback.displayValue);
  setText('detail-expected-meta', detailHrFeedback.meta);
  updateDetailExpectedStatus();
}
function updateDetailExpectedStatus() {
  const status = document.getElementById('detail-expected-status');
  if (!status) return;
  if (!detailHrFeedback) {
    status.hidden = true;
    status.textContent = '';
    status.className = 'detail-expected-status';
    return;
  }
  const avgBpm = parseThreeDigitHR('detail-avg-bpm-input');
  const comparison = compareHrFeedback(avgBpm, detailHrFeedback);
  if (!comparison) {
    status.hidden = true;
    status.textContent = '';
    status.className = 'detail-expected-status';
    return;
  }
  status.hidden = false;
  status.className = `detail-expected-status is-${comparison.tone} is-${comparison.severity}`;
  status.textContent = `${comparison.label} — ${comparison.detail}`;
}
function buildWorkoutContext(week, workout, weekIndex, workoutIndex) {
  const sprintConfig = getSprintConfig(workout);
  const targetPct = getWorkoutTargetPct(workout);
  return {
    weekIndex, workoutIndex, weekLabel: week.label, weekTitle: week.title, weekTab: week.title ? `${week.label} (${week.title})` : week.label,
    dayOfWeek: workout.day, workoutType: workout.type, description: workout.description, warmup: workout.warmup || '', targetZone: workout.targetZone || '',
    targetBPM: getWorkoutTargetBPM(workout), targetPct, maxHr: getHRInfo().maxHr,
    sprintConfig: sprintConfig ? { ...sprintConfig } : null,
    reps: sprintConfig?.reps ?? null,
    restSeconds: sprintConfig?.restSeconds ?? null,
    distanceMeters: sprintConfig?.distanceMeters ?? null,
    restCaptureSeconds: sprintConfig?.restCaptureSeconds ?? null,
  };
}
function makeWorkoutCompletionId() { return window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : `workout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function hasSessionResults(completion) { return Array.isArray(completion?.data) && completion.data.length > 0; }
function isSkippedCompletion(completion) {
  if (!completion) return false;
  return completion.status === 'skipped'
    || completion.workoutLog?.status === 'skipped'
    || completion.type === 'daily-workout-skip';
}
function buildBasicWorkoutCompletion(week, workout, weekIndex, workoutIndex, workoutLog = null) {
  const context = buildWorkoutContext(week, workout, weekIndex, workoutIndex);
  const note = sanitizeWorkoutNote(workoutLog?.note || getStoredWorkoutNote(weekIndex, workoutIndex));
  return { id: makeWorkoutCompletionId(), date: new Date().toISOString(), type: 'daily-workout-completion', status: 'completed', cfg: { workoutContext: context }, workoutContext: context, workoutLog, note, data: [], avgDrop: null, peakHR: workoutLog ? workoutLog.maxBpm : null };
}
function buildSkippedWorkoutCompletion(week, workout, weekIndex, workoutIndex, skipMeta) {
  const context = buildWorkoutContext(week, workout, weekIndex, workoutIndex);
  const detail = sanitizeWorkoutNote(skipMeta.detail || '');
  const note = detail || `Skipped: ${skipMeta.reasonLabel}`;
  return {
    id: makeWorkoutCompletionId(),
    date: new Date().toISOString(),
    type: 'daily-workout-skip',
    status: 'skipped',
    cfg: { workoutContext: context },
    workoutContext: context,
    workoutLog: {
      status: 'skipped',
      skipReason: skipMeta.reason,
      skipReasonLabel: skipMeta.reasonLabel,
      skipDetail: detail,
      coachApproved: true,
      note,
      completedAt: new Date().toISOString(),
    },
    note,
    data: [],
    avgDrop: null,
    peakHR: null,
  };
}
function getWorkoutNoteKey(weekIndex, workoutIndex) {
  return `${Number(weekIndex)}:${Number(workoutIndex)}`;
}
function sanitizeWorkoutNote(value) {
  return String(value || '').slice(0, WORKOUT_NOTE_MAX_LENGTH);
}
function getStoredWorkoutNote(weekIndex, workoutIndex) {
  const notes = readJSON(WORKOUT_NOTES_STORAGE_KEY, {});
  return sanitizeWorkoutNote(notes[getWorkoutNoteKey(weekIndex, workoutIndex)] || '');
}
function setStoredWorkoutNote(weekIndex, workoutIndex, value) {
  const notes = readJSON(WORKOUT_NOTES_STORAGE_KEY, {});
  const key = getWorkoutNoteKey(weekIndex, workoutIndex);
  const note = sanitizeWorkoutNote(value);
  if (note) notes[key] = note;
  else delete notes[key];
  persistJSON(WORKOUT_NOTES_STORAGE_KEY, notes);
  return note;
}
function getCompletionWorkoutNote(completion) {
  return sanitizeWorkoutNote(completion?.note || completion?.workoutLog?.note || '');
}
function updateDetailNoteCounter() {
  const input = document.getElementById('detail-note-input');
  const counter = document.getElementById('detail-note-counter');
  if (!input || !counter) return;
  const length = sanitizeWorkoutNote(input.value).length;
  counter.textContent = `${length} / ${WORKOUT_NOTE_MAX_LENGTH}`;
  counter.classList.toggle('near-limit', length >= 160 && length < WORKOUT_NOTE_MAX_LENGTH);
  counter.classList.toggle('at-limit', length >= WORKOUT_NOTE_MAX_LENGTH);
}
function setDetailNoteStatus(message) {
  setText('detail-note-status', message);
}
function setDetailWorkoutNote(completion, weekIndex, workoutIndex) {
  const input = document.getElementById('detail-note-input');
  const saveButton = document.getElementById('detail-save-note-btn');
  const completionNote = getCompletionWorkoutNote(completion);
  const note = completionNote || getStoredWorkoutNote(weekIndex, workoutIndex);
  if (input) {
    input.value = note;
    input.dataset.weekIndex = String(weekIndex);
    input.dataset.workoutIndex = String(workoutIndex);
  }
  if (saveButton) {
    saveButton.dataset.weekIndex = String(weekIndex);
    saveButton.dataset.workoutIndex = String(workoutIndex);
  }
  setDetailNoteStatus(completionNote ? 'Saved with this workout.' : 'Saved on this device as you type.');
  updateDetailNoteCounter();
}
function handleDetailNoteInput(event) {
  const input = event.currentTarget;
  if (!(input instanceof HTMLTextAreaElement)) return;
  const note = sanitizeWorkoutNote(input.value);
  if (input.value !== note) input.value = note;
  setStoredWorkoutNote(input.dataset.weekIndex, input.dataset.workoutIndex, note);
  setDetailNoteStatus('Saved on this device as you type.');
  updateDetailNoteCounter();
}
async function saveWorkoutNoteFromDetail(event) {
  const button = event.currentTarget;
  const weekIndex = Number(button.dataset.weekIndex);
  const workoutIndex = Number(button.dataset.workoutIndex);
  if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) return;
  const input = document.getElementById('detail-note-input');
  const note = setStoredWorkoutNote(weekIndex, workoutIndex, sanitizeWorkoutNote(input?.value || ''));
  const completion = getWorkoutCompletion(weekIndex, workoutIndex);

  button.disabled = true;
  try {
    if (!completion) {
      setDetailNoteStatus(note ? 'Saved on this device. It will attach when the workout is completed.' : 'Note cleared on this device.');
      shellHooks?.showToast?.(note ? 'NOTE SAVED' : 'NOTE CLEARED');
      return;
    }

    const updated = { ...completion, note };
    if (completion.workoutLog) {
      updated.workoutLog = { ...completion.workoutLog, note };
    }

    const saved = saveWorkoutCompletion(updated) || updated;
    const cloudSaved = await saveWorkoutCompletionToCloud(saved);
    setDetailNoteStatus(cloudSaved ? 'Saved with this workout and synced to your account.' : 'Saved with this workout on this device.');
    shellHooks?.showToast?.(note ? 'NOTE SAVED' : 'NOTE CLEARED');
  } finally {
    button.disabled = false;
  }
}
function getRecordContext(record) {
  return record?.cfg?.workoutContext || record?.workoutContext || null;
}
function attachStoredNoteToCompletion(record) {
  if (!record) return record;
  const context = getRecordContext(record);
  const weekIndex = Number(context.weekIndex);
  const workoutIndex = Number(context.workoutIndex);
  if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) return record;
  const note = getStoredWorkoutNote(weekIndex, workoutIndex);
  if (!note) return record;
  const updated = { ...record, note };
  if (record.workoutLog) updated.workoutLog = { ...record.workoutLog, note };
  return updated;
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

function hideCompletionHints(id) {
  renderCompletionHints(document.getElementById(id), []);
}

function getDetailCompletionItems() {
  const duration = parseWorkoutDuration(readInputValue('detail-total-minutes-input'));
  const avgBpm = parseThreeDigitHR('detail-avg-bpm-input');
  const maxBpm = parseThreeDigitHR('detail-max-bpm-input');
  const outputValue = parseNumberInput('detail-output-input', NaN);
  const outputMeta = getModalityMeta(detailModality);
  const items = [
    { label: 'Total time', done: !!duration },
    buildHrChecklistItem('Average HR', avgBpm),
    buildHrChecklistItem('Max HR', maxBpm),
    buildNumericChecklistItem(outputMeta.outputLabel, outputValue),
    buildProofChecklistItem(hasWorkoutProof('detail')),
  ];
  if (Number.isFinite(avgBpm) && avgBpm > 0 && Number.isFinite(maxBpm) && maxBpm > 0 && maxBpm < avgBpm) {
    items.push({ label: 'Max HR must be at least average HR', done: false });
  }
  return items;
}

function getMileCompletionItems() {
  const distance = parseNumberInput('mile-distance-input', NaN);
  const totalMinutes = parseMileTimeInput(NaN);
  const avgBpm = parseNumberInput('mile-avg-bpm-input', NaN);
  const maxBpm = parseNumberInput('mile-max-bpm-input', NaN);
  const items = [
    buildNumericChecklistItem('Distance (mi)', distance),
    buildNumericChecklistItem('Total time', totalMinutes),
    buildHrChecklistItem('Average HR', avgBpm),
    buildHrChecklistItem('Max BPM', maxBpm),
    buildProofChecklistItem(hasWorkoutProof('mile')),
  ];
  if (Number.isFinite(avgBpm) && avgBpm > 0 && Number.isFinite(maxBpm) && maxBpm > 0 && maxBpm < avgBpm) {
    items.push({ label: 'Max HR must be at least average HR', done: false });
  }
  return items;
}

function syncDetailModalityChrome(options = {}) {
  const clearOutput = !!options.clearOutput;
  const meta = getModalityMeta(detailModality);
  document.querySelectorAll('[data-detail-modality]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.detailModality === meta.id);
  });
  const label = document.getElementById('detail-output-label');
  const input = document.getElementById('detail-output-input');
  if (label) label.textContent = meta.outputLabel;
  if (input) {
    input.step = meta.outputType === 'watts' ? '1' : '0.01';
    input.placeholder = meta.outputType === 'watts' ? '184' : '3.35';
    input.inputMode = meta.outputInputMode || 'decimal';
    if (clearOutput) input.value = '';
  }
}

function showDetailModalitySwitchNote(modality) {
  const note = document.getElementById('detail-modality-note');
  if (!note) return;
  if (normalizeModality(modality) === MODALITY_RUNNING) {
    note.hidden = true;
    return;
  }
  const seen = readJSON(DETAIL_MODALITY_NOTE_KEY, {});
  if (seen[modality]) {
    note.hidden = true;
    return;
  }
  note.textContent = `Modality changed to ${formatModalityLabel(modality)}. Ring Ready will establish a new performance baseline so your camp progress continues without resetting.`;
  note.hidden = false;
  persistJSON(DETAIL_MODALITY_NOTE_KEY, { ...seen, [modality]: true });
}

function setDetailModality(nextModality, options = {}) {
  const modality = normalizeModality(nextModality);
  const changed = modality !== detailModality;
  detailModality = modality;
  syncDetailModalityChrome({ clearOutput: !!options.clearOutput && changed });
  if (changed && options.announce) showDetailModalitySwitchNote(modality);
  else if (!options.keepNote) {
    const note = document.getElementById('detail-modality-note');
    if (note && modality === MODALITY_RUNNING) note.hidden = true;
  }
  updateDetailCompletionState();
}

function readDetailWorkoutLog(options = {}) {
  const silent = !!options.silent;
  const duration = parseWorkoutDuration(readInputValue('detail-total-minutes-input'));
  const avgBpm = parseThreeDigitHR('detail-avg-bpm-input');
  const maxBpm = parseThreeDigitHR('detail-max-bpm-input');
  const outputValue = parseNumberInput('detail-output-input', NaN);
  const modalityFields = buildWorkoutLogModalityFields(detailModality, outputValue);
  if (!duration || ![avgBpm, maxBpm, modalityFields.outputValue].every((value) => Number.isFinite(value) && value > 0)) {
    if (!silent) shellHooks?.showToast?.('FILL OUT WORKOUT LOG');
    return null;
  }
  if (avgBpm > 999 || maxBpm > 999) { if (!silent) shellHooks?.showToast?.('HR MUST BE 3 DIGITS OR LESS'); return null; }
  if (maxBpm < avgBpm) { if (!silent) shellHooks?.showToast?.('MAX HR SHOULD BE AVG OR HIGHER'); return null; }
  const note = sanitizeWorkoutNote(readInputValue('detail-note-input'));
  return {
    totalMinutes: duration.totalMinutes,
    totalSeconds: duration.totalSeconds,
    totalTimeDisplay: duration.totalTimeDisplay,
    avgBpm,
    maxBpm,
    note,
    completedAt: new Date().toISOString(),
    ...modalityFields,
  };
}
function sanitizeWorkoutDurationInput(value, previousValue = '') {
  return sanitizeDurationInput(value, previousValue);
}
function sanitizeThreeDigitInput(value) { return String(value || '').replace(/\D/g, '').slice(0, 3); }
function updateDetailCompletionState() {
  const action = document.getElementById('detail-action-btn');
  const hints = document.getElementById('detail-completion-hints');
  if (!action || action.dataset.action !== 'complete-workout') {
    hideCompletionHints('detail-completion-hints');
    return;
  }
  const completion = getWorkoutCompletion(action.dataset.weekIndex, action.dataset.workoutIndex);
  if (isSkippedCompletion(completion) || action.hidden) {
    hideCompletionHints('detail-completion-hints');
    return;
  }
  action.textContent = completion ? 'SAVE CHANGES' : 'COMPLETE WORKOUT';
  const items = getDetailCompletionItems();
  applyCompletionActionState(action, items, {
    hintsRoot: hints,
    hintsId: 'detail-completion-hints',
  });
  action.classList.toggle('completed', false);
  const clearBtn = document.getElementById('detail-clear-completion-btn');
  if (clearBtn) {
    clearBtn.hidden = !completion;
    clearBtn.textContent = 'Clear Log';
  }
}
function normalizeDetailDurationInput() {
  const input = document.getElementById('detail-total-minutes-input');
  if (!input) return;
  const duration = parseWorkoutDuration(input.value);
  if (duration) {
    input.value = duration.totalTimeDisplay;
    input.dataset.prevDuration = duration.totalTimeDisplay;
  }
  updateDetailCompletionState();
}
function handleDetailLogInput(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  if (input.id === 'detail-total-minutes-input') {
    const previous = input.dataset.prevDuration || '';
    const next = sanitizeWorkoutDurationInput(input.value, previous);
    input.dataset.prevDuration = next;
    if (input.value !== next) input.value = next;
  }
  if (input.id === 'detail-avg-bpm-input' || input.id === 'detail-max-bpm-input') {
    const next = sanitizeThreeDigitInput(input.value);
    if (input.value !== next) input.value = next;
  }
  if (input.id === 'detail-avg-bpm-input') updateDetailExpectedStatus();
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
  const timeValue = readInputValue('detail-total-minutes-input');
  if (timeInput) timeInput.dataset.prevDuration = timeValue;
  setInputValue('detail-avg-bpm-input', log.avgBpm ?? '');
  setInputValue('detail-max-bpm-input', log.maxBpm ?? '');
  const output = readOutputFromWorkoutLog(log);
  const hasSavedOutput = Number.isFinite(Number(output.outputValue)) && Number(output.outputValue) > 0;
  const profileDefault = normalizeModality(getAthleteProfile().defaultModality || MODALITY_RUNNING);
  const modality = hasSavedOutput || completion
    ? (output.modality || profileDefault || MODALITY_RUNNING)
    : profileDefault;
  setDetailModality(modality, { clearOutput: false, announce: false, keepNote: true });
  setInputValue('detail-output-input', output.outputValue ?? '');
  card.querySelectorAll('input').forEach((input) => { input.disabled = false; });
  const note = document.getElementById('detail-modality-note');
  if (note) note.hidden = true;
  updateDetailExpectedStatus();
}
function flushQueuedEvent(cloudMessage) {
  flushSyncQueue().then((result) => {
    if (result.dispatched > 0) shellHooks?.showToast?.('SHEETS REQUEST DISPATCHED');
    else if (result.status === 'offline') shellHooks?.showToast?.('SAVED LOCALLY');
    if (cloudMessage) shellHooks?.showToast?.(cloudMessage);
  });
}
async function completeWorkoutFromDetail(weekIndex, workoutIndex) {
  const safeWeekIndex = Number(weekIndex);
  const safeWorkoutIndex = Number(workoutIndex);
  const action = document.getElementById('detail-action-btn');

  if (!hasWorkoutProof('detail')) {
    shellHooks?.showToast?.('ADD WORKOUT PROOF');
    return;
  }

  return runSingleFlight(`completion:detail:${safeWeekIndex}:${safeWorkoutIndex}`, async () => withSavingButton(action, async () => {
    const week = getWeek(safeWeekIndex);
    const workout = week.workouts[safeWorkoutIndex] || week.workouts[0];
    const workoutLog = readDetailWorkoutLog();
    if (!workoutLog) return;
    setStoredWorkoutNote(safeWeekIndex, safeWorkoutIndex, workoutLog.note);
    const existing = getWorkoutCompletion(safeWeekIndex, safeWorkoutIndex);
    const record = buildBasicWorkoutCompletion(week, workout, safeWeekIndex, safeWorkoutIndex, workoutLog);
    if (existing?.id) record.id = existing.id;
    const isNewProof = hasPendingWorkoutProof('detail');
    let identityStaging = null;
    try {
      if (isSupabaseConfigured && getCurrentUser()) {
        identityStaging = await withOperationTimeout(
          ensureCloudWorkoutIdentity(record),
          { timeoutMs: OPERATION_TIMEOUT_MS.IDENTITY_STAGING, operation: 'identity_staging' },
        );
        record.id = resolveCanonicalClientRecordId(identityStaging, record.id);
      }
      const attachment = await ensureWorkoutProofUploaded('detail', record.id);
      if (attachment) {
        record.proofPolicyVersion = PROOF_POLICY_VERSION;
        record.attachment = attachment;
        record.workoutLog = { ...record.workoutLog, proofPolicyVersion: PROOF_POLICY_VERSION, attachment };
      }
    } catch (error) {
      if ((identityStaging?.rollbackOwned || identityStaging?.insertedThisAttempt)
        && shouldRollbackProvisionalIdentity(error)) {
        await rollbackCloudWorkoutIdentity(record, identityStaging).catch((rollbackError) => {
          console.warn('Could not roll back provisional workout identity', rollbackError);
        });
      }
      console.warn('Workout proof upload failed', error);
      if (isReconcileableUniqueConflict(error)) {
        scheduleTargetedWorkoutRehydrate(record);
      }
      shellHooks?.showToast?.(athleteFacingWorkoutSaveError(error).toUpperCase());
      return;
    }
    const result = await persistSignedInWorkoutCompletion(record, {
      existing,
      isNewProof,
      successToast: 'WORKOUT SAVED TO ACCOUNT',
      updateToast: 'WORKOUT UPDATED IN ACCOUNT',
    });
    renderShell();
    renderAthleteProfileDashboard();
    openWorkoutDetail(safeWeekIndex, safeWorkoutIndex);
    if (!result.success) {
      // persistSignedInWorkoutCompletion already showed an athlete-safe toast when
      // it classified the cloud error; only fall back when no error object exists.
      if (!result.error && !result.identityConflict) {
        shellHooks?.showToast?.('COULD NOT SAVE WORKOUT');
      }
    } else if (result.identityConflict) {
      // Already toasted the refresh message; skip the normal save toast.
    } else if (!result.cloudSaved) {
      shellHooks?.showToast?.(existing ? 'WORKOUT UPDATED' : 'WORKOUT COMPLETE');
    }
  })).finally(() => updateDetailCompletionState());
}
async function clearCompletionFromDetail(weekIndex, workoutIndex) {
  const safeWeekIndex = Number(weekIndex);
  const safeWorkoutIndex = Number(workoutIndex);
  if (!Number.isFinite(safeWeekIndex) || !Number.isFinite(safeWorkoutIndex)) return;
  const existing = getWorkoutCompletion(safeWeekIndex, safeWorkoutIndex);
  const label = isSkippedCompletion(existing)
    ? 'Clear this skipped workout from this device and your account?'
    : 'Clear this workout log from this device and your account?';
  if (!window.confirm(label)) return;

  const attachmentId = existing?.attachment?.id || null;
  if (isSupabaseConfigured && getCurrentUser()) {
    try {
      await clearCloudWorkoutCompletionWithProof(safeWeekIndex, safeWorkoutIndex, attachmentId);
    } catch (error) {
      console.warn('Could not clear workout from cloud', error);
      shellHooks?.showToast?.(athleteFacingWorkoutSaveError(error).toUpperCase());
      return;
    }
  }

  markWorkoutCompletionCleared(safeWeekIndex, safeWorkoutIndex);
  const removed = removeWorkoutCompletion(safeWeekIndex, safeWorkoutIndex);
  if (!removed.logicalOk) { shellHooks?.showToast?.('NO COMPLETION TO CLEAR'); return; }
  noteCompletionMutation();

  setDetailSkipCard(false);
  renderShell();
  renderAthleteProfileDashboard();
  openWorkoutDetail(safeWeekIndex, safeWorkoutIndex);
  shellHooks?.showToast?.(removed.persisted
    ? (isSkippedCompletion(existing) ? 'SKIP CLEARED' : 'WORKOUT CLEARED')
    : 'CLEARED FROM ACCOUNT · LOCAL CACHE WILL REFRESH');
}

const SKIP_REASON_LABELS = {
  injury: 'Injury / recovery',
  travel: 'Travel',
  coach_call: 'Coach call',
  other: 'Other',
};

function setDetailSkipCard(isVisible) {
  const card = document.getElementById('detail-skip-card');
  if (!card) return;
  card.hidden = !isVisible;
  if (!isVisible) return;
  const reason = document.getElementById('detail-skip-reason-select');
  const detail = document.getElementById('detail-skip-reason-detail');
  const approved = document.getElementById('detail-skip-approved-check');
  if (reason) reason.value = '';
  if (detail) detail.value = '';
  if (approved) approved.checked = false;
}

function openDetailSkipCard() {
  setDetailSkipCard(true);
  document.getElementById('detail-skip-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function confirmSkipWorkoutFromDetail() {
  const action = document.getElementById('detail-action-btn');
  const weekIndex = Number(action?.dataset.weekIndex);
  const workoutIndex = Number(action?.dataset.workoutIndex);
  if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) return;

  const reason = readInputValue('detail-skip-reason-select');
  const detail = sanitizeWorkoutNote(readInputValue('detail-skip-reason-detail'));
  const approved = !!document.getElementById('detail-skip-approved-check')?.checked;
  if (!reason) {
    shellHooks?.showToast?.('PICK A SKIP REASON');
    return;
  }
  if (!approved) {
    shellHooks?.showToast?.('CONFIRM COACH APPROVAL FIRST');
    return;
  }

  const week = getWeek(weekIndex);
  const workout = week.workouts[workoutIndex] || week.workouts[0];
  const existing = getWorkoutCompletion(weekIndex, workoutIndex);
  const record = buildSkippedWorkoutCompletion(week, workout, weekIndex, workoutIndex, {
    reason,
    reasonLabel: SKIP_REASON_LABELS[reason] || reason,
    detail,
  });
  if (existing?.id) record.id = existing.id;

  const result = await persistSignedInWorkoutCompletion(record, {
    existing,
    isNewProof: false,
    successToast: 'WORKOUT SKIPPED IN ACCOUNT',
    updateToast: 'WORKOUT SKIPPED IN ACCOUNT',
  });
  setDetailSkipCard(false);
  renderShell();
  renderAthleteProfileDashboard();
  openWorkoutDetail(weekIndex, workoutIndex);
  if (!result.success) shellHooks?.showToast?.('COULD NOT SAVE SKIP');
  else if (!result.cloudSaved) shellHooks?.showToast?.('WORKOUT SKIPPED');
}
function renderHeaderProfile() {
  const chip = document.getElementById('header-athlete-name');
  if (!chip) return;
  if (isCoachUser()) {
    chip.textContent = 'Coach';
    chip.classList.remove('empty');
    return;
  }
  const profile = getAthleteProfile();
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
  const dailyLogs = completions
    .map((row) => ({ ...row, log: row.completion.workoutLog || null }))
    .filter((row) => row.log && !isSkippedCompletion(row.completion))
    .sort((a, b) => getRecordDate(b.completion) - getRecordDate(a.completion));
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
  const latestRunCopy = latestRun
    ? `${latestRun.week.label} / ${latestRun.workout.type} / ${
      normalizeModality(latestRun.log.modality) !== MODALITY_RUNNING && Number(latestRun.log.avgWatts || latestRun.log.outputValue) > 0
        ? `${formatWholeNumber(latestRun.log.avgWatts || latestRun.log.outputValue)} W · ${formatModalityLabel(latestRun.log.modality)}`
        : `${formatDistance(latestRun.log.distance ?? latestRun.log.outputValue)} mi`
    }`
    : 'No run logged yet';
  const mileCopy = mileTest ? `${formatWholeNumber(mileTest.totalMinutes)} min / ${formatWholeNumber(mileTest.maxBpm)} max bpm` : 'No Mile Test saved yet';
  root.innerHTML = `
    <article class="dash-card dash-progress-card"><div><div class="info-kicker">Progress Dashboard</div><h3>${escapeHTML(profile.athleteName || 'Fighter')} is ${completionPct}% through camp.</h3><p>${completedWorkouts} of ${totalWorkouts} roadwork sessions completed across the ${getCampWeekLimit()} week plan.</p></div><div class="dash-ring" style="--progress:${completionPct * 3.6}deg" aria-label="${completionPct}% complete"><strong>${completionPct}%</strong><span>${completedWorkouts}/${totalWorkouts}</span></div></article>
    <div class="dash-stat-grid"><article class="dash-card dash-stat-card"><span>Distance</span><strong>${formatDistance(totalMiles)}</strong><em>miles logged</em></article><article class="dash-card dash-stat-card"><span>Total Time</span><strong>${formatWholeNumber(totalMinutes)}</strong><em>minutes logged</em></article><article class="dash-card dash-stat-card"><span>Avg Run HR</span><strong>${formatWholeNumber(averageRunHR)}</strong><em>bpm</em></article><article class="dash-card dash-stat-card"><span>Sprint Drop</span><strong>${formatWholeNumber(sprintDrop)}</strong><em>avg bpm</em></article></div>
    <article class="dash-card dash-chart-card"><div class="dash-card-head"><div><span>Weekly Completion</span><strong>Camp work by week</strong></div><em>${completedWorkouts}/${totalWorkouts}</em></div><div class="week-bar-list">${weeklyRows.map((row, index) => `<div class="week-bar-row"><span>W${index + 1}</span><div class="week-bar-track"><i style="width:${row.pct}%"></i></div><em>${row.done}/${row.total}</em></div>`).join('')}</div></article>
    <div class="dash-detail-grid"><article class="dash-card dash-detail-card"><span>Latest Run</span><strong>${escapeHTML(latestRunCopy)}</strong><p>${latestRun ? `${formatWholeNumber(latestRun.log.totalMinutes)} min / ${formatWholeNumber(latestRun.log.avgBpm)} avg bpm / ${formatDashboardDate(latestRun.completion.completedAt)}` : 'Complete a non-sprint workout to fill this in.'}</p></article><article class="dash-card dash-detail-card"><span>HR Profile</span><strong>${formatWholeNumber(hrInfo.maxHr)} max / ${formatWholeNumber(hrInfo.restingHr)} resting</strong><p>Mile Test: ${escapeHTML(mileCopy)}</p></article><article class="dash-card dash-detail-card"><span>Next Up</span><strong>${escapeHTML(nextCopy)}</strong><p>${nextWorkout ? 'Open the week plan when you are ready to complete it.' : 'Everything currently visible in this camp is marked complete.'}</p></article><article class="dash-card dash-detail-card"><span>Sprint Work</span><strong>${sprintRecords.length ? `${sprintRecords.length} session${sprintRecords.length === 1 ? '' : 's'}` : 'No sprint data yet'}</strong><p>${sprintRecords.length ? `${formatWholeNumber(sprintPeak)} peak bpm across saved sprint work.` : 'Finish a sprint timer session to see recovery stats.'}</p></article></div>`;
}
function isProfileFormCollapsed(profile = getAthleteProfile()) {
  if (!profile.athleteName) return false;
  const stored = getStorageItem(PROFILE_FORM_COLLAPSED_KEY).value;
  return stored === null ? true : stored === '1';
}
function setProfileFormCollapsed(isCollapsed) { setStorageItem(PROFILE_FORM_COLLAPSED_KEY, isCollapsed ? '1' : '0'); renderAthleteProfilePage(); }
function syncProfileModalityNote() {
  const note = document.getElementById('profile-modality-note');
  const select = document.getElementById('profile-default-modality-select');
  if (!note || !select) return;
  const modality = normalizeModality(select.value || MODALITY_RUNNING);
  note.textContent = modality === MODALITY_RUNNING
    ? 'Running is the default. Anything other than running must be approved by Gene or Daniel before camp starts.'
    : `${formatModalityLabel(modality)} selected. Anything other than running must be approved by Gene or Daniel before camp starts.`;
  note.classList.toggle('is-non-running', modality !== MODALITY_RUNNING);
}
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
  setInputValue('profile-default-modality-select', normalizeModality(profile.defaultModality || MODALITY_RUNNING));
  syncProfileModalityNote();
  renderHeaderProfile();
  renderAthleteProfileDashboard();
  syncProfileFormCollapse(profile);
}
function clearLocalTestData() {
  if (!window.confirm('Clear local test data on this device? This resets profile, HR info, mile test, completed workouts, sprint history, pending sync, and onboarding.')) return;
  clearActiveSessionCheckpointsForAllUsers();
  quarantineLegacySyncQueue();
  const userId = getCurrentUser()?.id;
  if (userId) clearSyncQueueForUser(userId);
  [PROFILE_STORAGE_KEY, STORAGE_KEY, WORKOUT_COMPLETIONS_STORAGE_KEY, HR_INFO_STORAGE_KEY, MILE_TEST_STORAGE_KEY, AUTH_USER_STORAGE_KEY, SC_MODE_STORAGE_KEY, SC_WEEK_STORAGE_KEY, WEEK_INDEX_KEY, PROFILE_FORM_COLLAPSED_KEY, PROGRAM_GUIDE_COLLAPSED_KEY, ONBOARDING_DISMISSED_KEY, WORKOUT_NOTES_STORAGE_KEY, CAMP_RESET_SEEN_KEY, 'ringReadyClearedWorkoutCompletions'].forEach((key) => removeStorageKey(key));
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

async function startCleanSlateCamp() {
  const signedIn = !!(isSupabaseConfigured && getCurrentUser());
  const message = signedIn
    ? 'Start a clean slate?\n\nThis saves the current camp to archives, then clears workouts, sprints, mile test, and camp start date.\n\nProfile name and HR info stay. Update Fight Date before the next camp.'
    : 'Start a clean slate on this device?\n\nThis clears workouts, sprints, and mile test locally. Sign in to also archive the camp in your account.';
  if (!window.confirm(message)) return;
  if (!window.confirm('Confirm clean slate. This cannot be undone from the app.')) return;

  const btn = document.getElementById('clean-slate-btn');
  if (btn) btn.disabled = true;
  try {
    let resetAt = new Date().toISOString();
    if (signedIn) {
      const profile = getAthleteProfile();
      const label = [profile.athleteName, profile.fightDate ? `Fight ${profile.fightDate}` : '', new Date().toLocaleDateString('en-US')].filter(Boolean).join(' · ');
      await archiveAndResetCamp({ label });
      try {
        const cloudProfile = await loadCloudProfile();
        if (cloudProfile?.campResetAt) resetAt = cloudProfile.campResetAt;
        if (cloudProfile && hasProfileData(cloudProfile)) saveAthleteProfile(cloudProfile);
      } catch (error) {
        console.warn('Could not reload profile after clean slate', error);
      }
    }
    clearLocalTrainingData({ markResetAt: resetAt });
    renderAllPages();
    shellHooks?.showToast?.(signedIn ? 'CAMP ARCHIVED · CLEAN SLATE READY' : 'LOCAL CLEAN SLATE READY');
  } catch (error) {
    console.warn('Clean slate failed', error);
    shellHooks?.showToast?.(String(error?.message || error || 'CLEAN SLATE FAILED').toUpperCase());
  } finally {
    if (btn) btn.disabled = false;
  }
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
    defaultModality: normalizeModality(readInputValue('profile-default-modality-select') || MODALITY_RUNNING),
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
    setStorageItem(PROFILE_FORM_COLLAPSED_KEY, '1');
    enqueueProfileForSync(profile);
    flushQueuedEvent('CLOUD SAVED');
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
  if (isSkippedCompletion(completion)) return 'SKIPPED';
  if (completion) return hasSessionResults(completion) ? 'RESULTS' : 'EDIT';
  if (workout.action === 'sprint') return 'OPEN TIMER';
  if (workout.action === 'mile-test') return 'OPEN MILE TEST';
  return 'VIEW';
}
function isProgramGuideCollapsed() {
  return getStorageItem(PROGRAM_GUIDE_COLLAPSED_KEY).value === '1';
}
function setProgramGuideCollapsed(isCollapsed) {
  setStorageItem(PROGRAM_GUIDE_COLLAPSED_KEY, isCollapsed ? '1' : '0');
  syncProgramGuideCollapse();
}
function syncProgramGuideCollapse() {
  const card = document.getElementById('program-guide-card');
  const content = document.getElementById('program-guide-content');
  const btn = document.getElementById('program-guide-toggle-btn');
  if (!content || !btn) return;
  const isCollapsed = isProgramGuideCollapsed();
  content.hidden = isCollapsed;
  card?.classList.toggle('collapsed', isCollapsed);
  btn.textContent = isCollapsed ? 'SHOW' : 'HIDE';
  btn.setAttribute('aria-expanded', String(!isCollapsed));
}
function renderShell() {
  activeWeekIndex = clampWeek(activeWeekIndex);
  const week = getWeek(activeWeekIndex);
  setText('current-week-label', `${week.label}: ${week.title}`);
  setText('current-week-focus', week.focus || '');
  renderHeaderProfile();
  syncProgramGuideCollapse();
  const prevBtn = document.getElementById('week-prev-btn');
  const nextBtn = document.getElementById('week-next-btn');
  if (prevBtn) prevBtn.disabled = activeWeekIndex === 0;
  if (nextBtn) nextBtn.disabled = activeWeekIndex >= getCampWeekLimit() - 1;
  const root = document.getElementById('week-workouts');
  if (!root) return;
  root.innerHTML = week.workouts.map((workout, index) => {
    const completion = getWorkoutCompletion(activeWeekIndex, index);
    const skipped = isSkippedCompletion(completion);
    const targetBPM = getWorkoutTargetBPM(workout);
    const targetCopy = isSprintWorkout(workout) ? 'All out' : (targetBPM ? `${targetBPM} bpm` : '--');
    const cardState = skipped ? 'skipped' : (completion ? 'completed' : '');
    const tag = skipped ? 'Skipped' : (completion ? 'Done' : workoutTag(workout));
    return `<button type="button" class="week-workout-card ${cardState}" data-week-index="${activeWeekIndex}" data-workout-index="${index}"><div><div class="field-label week-card-day">${escapeHTML(workout.day)}</div><div class="week-card-title">${escapeHTML(workout.type)}</div><div class="week-card-desc">${escapeHTML(workout.description)}</div></div><div class="week-card-side"><div class="workout-tag">${escapeHTML(tag)}</div><div class="workout-target">${targetCopy}</div><div class="workout-action">${escapeHTML(getActionCopy(workout, completion))}</div></div></button>`;
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
  flushQueuedEvent('CLOUD SAVED');
  renderHRInfoPage();
  renderShell();
  renderAthleteProfileDashboard();
  shellHooks?.showToast?.(cloudSaved ? 'HR INFO SAVED TO ACCOUNT' : 'HR INFO SAVED');
}
function renderSCPage() {
  scWeek = clampSCWeek(scWeek);
  setStorageItem(SC_MODE_STORAGE_KEY, scMode);
  setStorageItem(SC_WEEK_STORAGE_KEY, String(scWeek));
  document.querySelectorAll('[data-sc-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.scMode === scMode));
  const tabs = document.getElementById('sc-week-tabs');
  if (tabs) tabs.innerHTML = Array.from({ length: getCampWeekLimit() }, (_, index) => `<button type="button" class="sc-week-btn ${index + 1 === scWeek ? 'active' : ''}" data-sc-week="${index + 1}">W${index + 1}</button>`).join('');
  const list = document.getElementById('sc-session-list');
  if (!list) return;
  const sessions = SC_SESSIONS.filter((session) => session.week === scWeek && session.modality === scMode);
  list.innerHTML = sessions.length ? sessions.map((session) => `<article class="page-panel sc-session-card"><div class="sc-card-head"><div><div class="info-kicker">${escapeHTML(session.day)}</div><h3>${escapeHTML(session.sessionType)}</h3></div><span class="workout-tag">${escapeHTML(session.modality)}</span></div><ul class="exercise-list">${session.exercises.split('|').map((exercise) => `<li>${escapeHTML(exercise.trim())}</li>`).join('')}</ul><div class="sc-metrics"><div><span>Sets x Reps</span><strong>${escapeHTML(session.setsReps)}</strong></div><div><span>Intensity</span><strong>${escapeHTML(session.intensity)}</strong></div><div><span>Rest</span><strong>${escapeHTML(session.rest)}</strong></div></div><p>${escapeHTML(session.notes)}</p></article>`).join('') : '<article class="page-panel"><p>No S&C sessions listed for this week.</p></article>';
}
function getActiveMileProofContext() {
  const profile = getAthleteProfile();
  const workoutContext = activeMileTestContext.workoutContext;
  return {
    testKey: activeMileTestContext.testKey || 'mile-test:baseline',
    campLength: Number(profile.campLength) || 7,
    weekIndex: workoutContext?.weekIndex,
    workoutIndex: workoutContext?.workoutIndex,
    workoutType: workoutContext?.workoutType || MILE_TEST_INFO.workout,
    dayOfWeek: workoutContext?.dayOfWeek || MILE_TEST_INFO.day,
  };
}
function renderMileTestPage() {
  setText('mile-test-title', MILE_TEST_INFO.workout);
  setText('mile-test-desc', MILE_TEST_INFO.description);
  setText('mile-test-day', MILE_TEST_INFO.day);
  setText('mile-test-warmup', MILE_TEST_INFO.warmup);
  const link = document.getElementById('mile-warmup-link');
  if (link) link.href = MILE_TEST_INFO.warmupLink;
  const result = getMileTestResult();
  const proofContext = getActiveMileProofContext();
  const matchesActiveTest = result && String(result.testKey || 'mile-test:baseline') === proofContext.testKey;
  initWorkoutProof('mile', {
    proofKey: proofContext.testKey,
    context: proofContext,
    existingAttachment: matchesActiveTest ? result.attachment : null,
    legacy: !!(matchesActiveTest && !result.proofPolicyVersion),
  });
  if (result) {
    const savedDuration = formatSavedMileDuration(result);
    setInputValue('mile-distance-input', result.distance);
    setInputValue('mile-time-input', savedDuration?.display || result.totalMinutes);
    setInputValue('mile-avg-bpm-input', result.avgBpm);
    setInputValue('mile-max-bpm-input', result.maxBpm);
  }
  const last = document.getElementById('mile-last-result');
  const savedDuration = formatSavedMileDuration(result);
  if (last) last.textContent = result ? `Last saved: ${formatDistance(result.distance)} mi / ${savedDuration?.display || '--'} / ${formatWholeNumber(result.maxBpm)} max bpm / ${formatDashboardDate(result.savedAt)}` : 'No Mile Test saved yet.';
  const locations = document.getElementById('mile-location-list');
  if (locations) locations.innerHTML = MILE_TEST_INFO.locations.map((location) => `<div>${escapeHTML(location)}</div>`).join('');
  const guidanceList = document.getElementById('mile-test-guidance-list');
  if (guidanceList) guidanceList.innerHTML = buildGuidanceListHTML(MILE_TEST_GUIDANCE);
  updateMileCompletionState();
}
function updateMileCompletionState() {
  const button = document.getElementById('save-mile-test-btn');
  const hints = document.getElementById('mile-completion-hints');
  if (!button) return;
  const items = getMileCompletionItems();
  applyCompletionActionState(button, items, {
    hintsRoot: hints,
    hintsId: 'mile-completion-hints',
  });
}
async function saveMileTestResult() {
  const button = document.getElementById('save-mile-test-btn');
  const distance = parseNumberInput('mile-distance-input', NaN);
  const duration = parseDurationMinutes(readInputValue('mile-time-input'));
  const totalMinutes = duration?.totalMinutes ?? NaN;
  const avgBpm = parseNumberInput('mile-avg-bpm-input', 0);
  const maxBpm = parseNumberInput('mile-max-bpm-input', 0);
  if (![distance, totalMinutes, avgBpm, maxBpm].every((value) => Number.isFinite(value) && value > 0)) { shellHooks?.showToast?.('FILL OUT MILE TEST RESULTS'); return; }
  if (avgBpm > 999 || maxBpm > 999) { shellHooks?.showToast?.('HR MUST BE 3 DIGITS OR LESS'); return; }
  if (maxBpm < avgBpm) { shellHooks?.showToast?.('MAX HR SHOULD BE AVG OR HIGHER'); return; }
  const proofContext = getActiveMileProofContext();
  const testKey = proofContext.testKey || 'mile';

  return runSingleFlight(`completion:mile:${testKey}`, async () => withSavingButton(button, async () => {
    const existingMile = getMileTestResult();
    const result = { id: makeWorkoutCompletionId(), testKey: proofContext.testKey, distance, totalMinutes, totalSeconds: duration?.totalSeconds ?? Math.round(totalMinutes * 60), totalTimeDisplay: duration?.display || '', avgBpm, maxBpm, paceMinPerMile: distance > 0 ? totalMinutes / distance : '', savedAt: new Date().toISOString() };
    if (existingMile?.id && existingMile.testKey === proofContext.testKey) {
      result.id = existingMile.id;
    }
    const testContext = { ...proofContext, weekTab: proofContext.weekIndex == null ? 'Mile Test' : `Week ${Number(proofContext.weekIndex) + 1}`, workoutType: proofContext.workoutType, dayOfWeek: proofContext.dayOfWeek, description: activeMileTestContext.workoutContext?.description || MILE_TEST_INFO.description, warmup: activeMileTestContext.workoutContext?.warmup || MILE_TEST_INFO.warmup };
    const isNewProof = hasPendingWorkoutProof('mile');
    let identityStaging = null;
    try {
      if (isSupabaseConfigured && getCurrentUser()) {
        identityStaging = await withOperationTimeout(
          ensureCloudMileTestIdentity(result, getHRInfo(), testContext),
          { timeoutMs: OPERATION_TIMEOUT_MS.IDENTITY_STAGING, operation: 'identity_staging' },
        );
        result.id = resolveCanonicalClientRecordId(identityStaging, result.id);
      }
      result.attachment = await ensureWorkoutProofUploaded('mile', result.id);
      if (result.attachment) result.proofPolicyVersion = PROOF_POLICY_VERSION;
    } catch (error) {
      if ((identityStaging?.rollbackOwned || identityStaging?.insertedThisAttempt)
        && shouldRollbackProvisionalIdentity(error)) {
        await rollbackCloudMileTestIdentity(result, testContext, identityStaging).catch((rollbackError) => {
          console.warn('Could not roll back provisional mile test identity', rollbackError);
        });
      }
      console.warn('Mile Test proof upload failed', error);
      shellHooks?.showToast?.(athleteFacingWorkoutSaveError(error).toUpperCase());
      return;
    }
    let cloudSaved = false;
    let localMileCacheFailed = false;
    let localHrCacheFailed = false;
    if (isSupabaseConfigured && getCurrentUser()) {
      try {
        await withOperationTimeout((async () => {
          await saveCloudMileTest(result, getHRInfo(), testContext);
          if (maxBpm > 0) await saveCloudHRInfo({ ...getHRInfo(), maxHr: maxBpm });
        })(), { timeoutMs: OPERATION_TIMEOUT_MS.CLOUD_COMPLETION, operation: 'cloud_completion' });
        cloudSaved = true;
      } catch (error) {
        console.warn('Cloud mile test save failed', error);
        shellHooks?.showToast?.('COULD NOT SAVE MILE TEST TO ACCOUNT');
        return;
      }
    }

    localMileCacheFailed = !persistJSON(MILE_TEST_STORAGE_KEY, result);
    if (maxBpm > 0) {
      const hrResult = writeJSON(HR_INFO_STORAGE_KEY, { ...getHRInfo(), maxHr: maxBpm, updatedAt: new Date().toISOString() });
      localHrCacheFailed = !hrResult.ok || hrResult.persisted !== true;
    }

    if (cloudSaved && (localMileCacheFailed || localHrCacheFailed)) {
      scheduleTargetedMileRehydrate();
    }

    if (getAthleteProfile().athleteName) {
      enqueueMileTestForSync(result, getHRInfo(), testContext);
      if (isNewProof && result.attachment) enqueueWorkoutProofForSync(result.attachment);
      flushQueuedEvent('CLOUD SAVED');
    }
    renderMileTestPage();
    renderHRInfoPage();
    renderShell();
    renderAthleteProfileDashboard();
    if (cloudSaved && (localMileCacheFailed || localHrCacheFailed)) {
      shellHooks?.showToast?.('MILE TEST SAVED TO ACCOUNT · LOCAL CACHE WILL REFRESH');
    } else if (cloudSaved) {
      shellHooks?.showToast?.(maxBpm > 0 ? 'MILE TEST SAVED TO ACCOUNT + MAX HR UPDATED' : 'MILE TEST SAVED TO ACCOUNT');
    } else {
      shellHooks?.showToast?.(maxBpm > 0 ? 'MILE TEST SAVED + MAX HR UPDATED' : 'MILE TEST SAVED');
    }
  })).finally(() => updateMileCompletionState());
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
  if (isCoachScreen(screenId)) {
    if (!canAccessCoachScreens()) return;
    renderCoachPage(screenId);
  }
}
function setActiveNavigation(screenId) {
  document.querySelectorAll('[data-page-target]').forEach((btn) => btn.classList.toggle('active', btn.dataset.pageTarget === screenId));
}
function dismissOnboarding() {
  setStorageItem(ONBOARDING_DISMISSED_KEY, '1');
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}
function maybeShowOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  if (isCoachUser()) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    return;
  }
  const hasProfile = !!getAthleteProfile().athleteName;
  const dismissed = getStorageItem(ONBOARDING_DISMISSED_KEY).value === '1';
  modal.hidden = hasProfile || dismissed;
  modal.setAttribute('aria-hidden', String(hasProfile || dismissed));
}
function navigateTo(screenId) {
  closeWeekDrawer();
  if (isCoachScreen(screenId) && !canAccessCoachScreens()) screenId = 'home';
  if (isCoachUser() && !isCoachScreen(screenId)) screenId = 'coach-dashboard';
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
  const skipped = isSkippedCompletion(completion);
  setText('detail-week', `${week.label} / ${workout.day}`);
  setText('detail-title', workout.type);
  setText('detail-desc', workout.description);
  renderWarmupCard(workout);
  renderDetailGuidance(workout);
  setText('detail-zone', workout.targetZone || '--');
  const targetBPM = getWorkoutTargetBPM(workout);
  setText('detail-bpm', targetBPM ? String(targetBPM) : '--');
  renderDetailExpectedAvg(workout);
  syncDetailSprintLayout(workout);
  const baseActionType = ['sprint', 'mile-test'].includes(workout.action) ? workout.action : 'complete-workout';
  const actionType = !skipped && completion && hasSessionResults(completion) ? 'view-results' : baseActionType;
  setDetailWorkoutLog(baseActionType === 'complete-workout' && !skipped, skipped ? null : completion, workout);
  if (baseActionType === 'complete-workout' && !skipped) {
    const proofContext = { ...buildWorkoutContext(week, workout, safeWeekIndex, safeWorkoutIndex), campLength: Number(getAthleteProfile().campLength) || 7 };
    initWorkoutProof('detail', {
      proofKey: buildProgramProofKey(proofContext.campLength, safeWeekIndex, safeWorkoutIndex),
      context: proofContext,
      existingAttachment: completion?.attachment || null,
      legacy: !!(completion && !completion.proofPolicyVersion),
    });
  }
  const proofHost = document.querySelector('[data-proof-host="detail"]');
  if (proofHost) proofHost.hidden = skipped || baseActionType !== 'complete-workout';
  setDetailWorkoutNote(completion, safeWeekIndex, safeWorkoutIndex);
  setDetailSkipCard(false);

  const skippedCard = document.getElementById('detail-skipped-card');
  if (skippedCard) {
    skippedCard.hidden = !skipped;
    if (skipped) {
      const reasonEl = document.getElementById('detail-skipped-reason');
      const detailEl = document.getElementById('detail-skipped-detail');
      const reasonLabel = String(completion?.workoutLog?.skipReasonLabel || completion?.skipReasonLabel || '').trim();
      const reasonCode = String(completion?.workoutLog?.skipReason || completion?.skipReason || '').trim();
      const detail = String(completion?.workoutLog?.skipDetail || completion?.skipDetail || '').trim();
      if (reasonEl) reasonEl.textContent = reasonLabel || SKIP_REASON_LABELS[reasonCode] || 'Coach-approved skip.';
      if (detailEl) {
        detailEl.hidden = !detail;
        detailEl.textContent = detail;
      }
    }
  }

  const noteCard = document.getElementById('detail-note-card');
  if (noteCard) noteCard.hidden = skipped;

  const action = document.getElementById('detail-action-btn');
  if (action) {
    const isCompleted = !!completion && !skipped;
    const isLoggedWorkout = baseActionType === 'complete-workout';
    action.hidden = skipped;
    action.textContent = actionType === 'view-results'
      ? 'VIEW RESULTS'
      : isLoggedWorkout
        ? (isCompleted ? 'SAVE CHANGES' : 'COMPLETE WORKOUT')
        : (isCompleted ? 'WORKOUT COMPLETE' : getActionCopy(workout));
    action.disabled = skipped
      ? true
      : actionType === 'view-results'
        ? false
        : isLoggedWorkout
          ? false
          : isCompleted;
    action.classList.toggle('completed', isCompleted && !isLoggedWorkout && actionType !== 'view-results');
    action.dataset.action = actionType;
    action.dataset.weekIndex = String(safeWeekIndex);
    action.dataset.workoutIndex = String(safeWorkoutIndex);
    if (isLoggedWorkout && actionType === 'complete-workout' && !skipped) {
      updateDetailCompletionState();
    } else {
      hideCompletionHints('detail-completion-hints');
      if (!skipped && actionType !== 'view-results' && !isLoggedWorkout) {
        action.disabled = isCompleted;
      }
    }
  }

  const skipBtn = document.getElementById('detail-skip-workout-btn');
  if (skipBtn) {
    skipBtn.hidden = !!completion;
    skipBtn.dataset.weekIndex = String(safeWeekIndex);
    skipBtn.dataset.workoutIndex = String(safeWorkoutIndex);
  }

  const clearBtn = document.getElementById('detail-clear-completion-btn');
  if (clearBtn) {
    clearBtn.hidden = !(completion && (skipped || baseActionType === 'complete-workout'));
    clearBtn.textContent = skipped ? 'Clear Skip' : 'Clear Log';
    clearBtn.dataset.weekIndex = String(safeWeekIndex);
    clearBtn.dataset.workoutIndex = String(safeWorkoutIndex);
  }
  shellHooks?.showScreen('workout-detail');
  setActiveNavigation('');
}
function bindShellEvents() {
  document.getElementById('auth-form')?.addEventListener('submit', handleAuthSubmit);
  document.getElementById('auth-mode-toggle-btn')?.addEventListener('click', toggleAuthMode);
  document.getElementById('auth-forgot-btn')?.addEventListener('click', openForgotPassword);
  document.querySelectorAll('[data-logout]').forEach((btn) => btn.addEventListener('click', handleLogout));
  document.getElementById('week-prev-btn')?.addEventListener('click', () => { saveWeek(activeWeekIndex - 1); scWeek = activeWeekIndex + 1; renderShell(); renderSCPage(); });
  document.getElementById('week-next-btn')?.addEventListener('click', () => { saveWeek(activeWeekIndex + 1); scWeek = activeWeekIndex + 1; renderShell(); renderSCPage(); });
  document.addEventListener('click', (event) => {
    const athleteBtn = event.target.closest('[data-coach-athlete]');
    if (athleteBtn) setSelectedCoachAthlete(athleteBtn.dataset.coachAthlete);
    const pageBtn = event.target.closest('[data-page-target]');
    if (!pageBtn) return;
    event.preventDefault();
    if (pageBtn.dataset.pageTarget === 'mile-test-page') activeMileTestContext = { testKey: 'mile-test:baseline', workoutContext: null };
    navigateTo(pageBtn.dataset.pageTarget);
  });
  document.querySelectorAll('[data-open-menu]').forEach((btn) => btn.addEventListener('click', openWeekDrawer));
  document.getElementById('close-week-menu-btn')?.addEventListener('click', closeWeekDrawer);
  document.getElementById('week-drawer-backdrop')?.addEventListener('click', closeWeekDrawer);
  document.getElementById('setup-back-btn')?.addEventListener('click', () => navigateTo('home'));
  document.getElementById('detail-back-btn')?.addEventListener('click', () => navigateTo('home'));
  document.querySelectorAll('#detail-log-card input').forEach((input) => input.addEventListener('input', handleDetailLogInput));
  if (!detailModalityInitialized) {
    detailModalityInitialized = true;
    document.getElementById('detail-modality-row')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-detail-modality]');
      if (!btn) return;
      event.preventDefault();
      setDetailModality(btn.dataset.detailModality, { clearOutput: true, announce: true });
    });
  }
  window.addEventListener('ringready:proof-state-changed', (event) => {
    if (event.detail?.surface === 'detail') updateDetailCompletionState();
    if (event.detail?.surface === 'mile') updateMileCompletionState();
  });
  document.getElementById('detail-note-input')?.addEventListener('input', handleDetailNoteInput);
  document.getElementById('detail-save-note-btn')?.addEventListener('click', saveWorkoutNoteFromDetail);
  document.getElementById('detail-total-minutes-input')?.addEventListener('blur', normalizeDetailDurationInput);
  document.getElementById('detail-clear-completion-btn')?.addEventListener('click', (event) => clearCompletionFromDetail(event.currentTarget.dataset.weekIndex, event.currentTarget.dataset.workoutIndex));
  document.getElementById('detail-skip-workout-btn')?.addEventListener('click', openDetailSkipCard);
  document.getElementById('detail-skip-cancel-btn')?.addEventListener('click', () => setDetailSkipCard(false));
  document.getElementById('detail-skip-confirm-btn')?.addEventListener('click', confirmSkipWorkoutFromDetail);
  document.getElementById('detail-action-btn')?.addEventListener('click', (event) => {
    if (event.currentTarget.dataset.action === 'view-results') {
      const completion = getWorkoutCompletion(event.currentTarget.dataset.weekIndex, event.currentTarget.dataset.workoutIndex);
      if (completion) shellHooks?.showSavedWorkoutResult?.(completion);
      setActiveNavigation('');
    } else if (event.currentTarget.dataset.action === 'sprint') {
      const weekIndex = Number(event.currentTarget.dataset.weekIndex || activeWeekIndex);
      const workoutIndex = Number(event.currentTarget.dataset.workoutIndex || 0);
      const week = getWeek(weekIndex);
      const workout = week.workouts[workoutIndex] || week.workouts[0];
      shellHooks?.setWorkoutContext?.(buildWorkoutContext(week, workout, weekIndex, workoutIndex));
      shellHooks?.showScreen('setup');
      setActiveNavigation('');
    } else if (event.currentTarget.dataset.action === 'mile-test') {
      const weekIndex = Number(event.currentTarget.dataset.weekIndex || activeWeekIndex);
      const workoutIndex = Number(event.currentTarget.dataset.workoutIndex || 0);
      const week = getWeek(weekIndex);
      const workout = week.workouts[workoutIndex] || week.workouts[0];
      const context = buildWorkoutContext(week, workout, weekIndex, workoutIndex);
      activeMileTestContext = { testKey: buildProgramProofKey(getAthleteProfile().campLength, weekIndex, workoutIndex), workoutContext: context };
      navigateTo('mile-test-page');
    } else if (event.currentTarget.dataset.action === 'complete-workout') {
      completeWorkoutFromDetail(event.currentTarget.dataset.weekIndex, event.currentTarget.dataset.workoutIndex);
    }
  });
  document.getElementById('week-workouts')?.addEventListener('click', (event) => {
    const card = event.target.closest('.week-workout-card');
    if (!card) return;
    openWorkoutDetail(card.dataset.weekIndex, card.dataset.workoutIndex);
  });
  document.querySelectorAll('#mile-test-page input').forEach((input) => input.addEventListener('input', updateMileCompletionState));
  document.getElementById('drawer-week-list')?.addEventListener('click', (event) => { const btn = event.target.closest('.drawer-week-btn'); if (!btn) return; saveWeek(Number(btn.dataset.weekIndex)); scWeek = activeWeekIndex + 1; renderShell(); renderSCPage(); navigateTo('home'); });
  document.getElementById('save-athlete-profile-btn')?.addEventListener('click', saveAthleteProfileFromInputs);
  document.getElementById('profile-default-modality-select')?.addEventListener('change', syncProfileModalityNote);
  document.getElementById('clear-test-data-btn')?.addEventListener('click', clearLocalTestData);
  document.getElementById('clean-slate-btn')?.addEventListener('click', startCleanSlateCamp);
  document.getElementById('profile-form-toggle-btn')?.addEventListener('click', () => setProfileFormCollapsed(!isProfileFormCollapsed()));
  document.getElementById('program-guide-toggle-btn')?.addEventListener('click', () => setProgramGuideCollapsed(!isProgramGuideCollapsed()));
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
  initCoachPreview({
    navigateTo,
    showToast: (message) => shellHooks?.showToast?.(message),
  });
  window.addEventListener('ringready:workout-completed', (event) => {
    renderShell();
    renderAthleteProfileDashboard();
    if (event.detail) {
      const completedWithNote = attachStoredNoteToCompletion(event.detail);
      saveWorkoutCompletion(completedWithNote);
      noteCompletionMutation();
    }
  });
  window.addEventListener('ringready:workout-completion-cleared', (event) => {
    renderShell();
    renderAthleteProfileDashboard();
    if (!event.detail) return;
    if (event.detail.cloudAlreadyCleared) return;
    const weekIndex = Number(event.detail.weekIndex);
    const workoutIndex = Number(event.detail.workoutIndex);
    if (!Number.isFinite(weekIndex) || !Number.isFinite(workoutIndex)) return;
    markWorkoutCompletionCleared(weekIndex, workoutIndex);
    noteCompletionMutation();
    deleteWorkoutCompletionFromCloud(weekIndex, workoutIndex).then((ok) => {
      if (!ok && isSupabaseConfigured && getCurrentUser()) {
        shellHooks?.showToast?.('CLEARED HERE · CLOUD DELETE FAILED');
      }
    });
  });
  window.addEventListener('ringready:sprint-session-saved', () => {
    // Cloud sprint save is awaited in finishSession before proof can be submitted.
  });

  renderAllPages();
  renderAuthUI();

  if (!isSupabaseConfigured) {
    enterAppHome();
    openCoachPreviewIfRequested();
    return;
  }

  try {
    const recovering = isPasswordRecoveryRedirect();
    const session = await initSupabaseAuth(handleAuthStateChange);
    if (recovering || passwordRecoveryPending) {
      enterPasswordRecoveryMode();
      openCoachPreviewIfRequested();
      return;
    }
    if (!session) {
      showAuthScreen();
      openCoachPreviewIfRequested();
      return;
    }
    if (!isCoachUser()) enterSignedInAthleteHome();
    else enterSignedInCoachHome();
    openCoachPreviewIfRequested();
  } catch (error) {
    console.warn('Supabase auth init failed', error);
    showAuthScreen('Could not connect to accounts. Try refreshing in a moment.');
    openCoachPreviewIfRequested();
  }
}

export { completeWorkoutFromDetail, saveMileTestResult };

export const cloudHydrationTestHooks = {
  shouldApplyCloudHydration,
  shouldApplyClientStateMutation,
  shouldApplyCompletionHydration,
  captureClientStateOwner,
  invalidateCloudHydration,
  getHydrationGeneration: () => hydrationGeneration,
  getCompletionMutationEpoch: () => completionMutationEpoch,
  noteCompletionMutation,
  boundedCloudLoad,
  applyCloudHydrationResults,
  runCloudHydrationMaintenance,
  hydrateCloudDataInBackground,
  enterSignedInAthleteHome,
  rehydrateWorkoutCompletionFromCloud,
  scheduleTargetedWorkoutRehydrate,
  prepareAccountSwitchSafety,
};
