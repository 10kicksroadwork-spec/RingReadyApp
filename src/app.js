import {
  AUTO_START_NEXT_SPRINT,
  AUTO_START_DELAY_MS,
  REST_CAPTURE_SEC,
  REST_LOG_ALERT_REMAINING_SEC,
} from './constants.js';
import { HR_INFO_DEFAULTS, HR_INFO_STORAGE_KEY } from './app-content.js';
import {
  validateSprintHR,
  validateRestHR,
  calculateAvgDrop,
  calculatePeakHR,
  getRestDuration,
  getRestCaptureCopy,
} from './workout.js';
import { removeWorkoutCompletion, saveSessionToHistory, saveWorkoutCompletion } from './storage.js';
import {
  enqueueSessionForSync,
  enqueueWorkoutProofForSync,
  flushSyncQueue,
  getAthleteProfile,
  saveAthleteProfile,
} from './sync.js';
import {
  getAutoCapturedHR,
  isHRConnected,
  hasFreshHRSample,
  clearHRBufferForInterval,
} from './hr-service.js';
import {
  PROOF_POLICY_VERSION,
  buildProgramProofKey,
  ensureWorkoutProofUploaded,
  hasPendingWorkoutProof,
  hasWorkoutProof,
  initWorkoutProof,
  markWorkoutProofCleared,
} from './proof.js';
import {
  showScreen,
  setStatus,
  setTimerDisplay,
  setMainBtn,
  resetChips,
  setRing,
  showToast,
  showExportModal,
  closeExportModal,
  selectExportText,
  vibrate,
  unlockAudio,
  restCompleteAlert,
  startRestLogAlert,
  stopRestLogAlert,
  syncHoldToCancelLabels,
} from './ui.js';

export const cfg = { reps: 8, rest: 90, maxHR: 183, targetPct: 90, workoutContext: null };

export const state = {
  phase: 'idle',
  currentRep: 0,
  timer: null,
  seconds: 0,
  data: [],
  pendingRep: null,
  awaitingModal: false,
  capturedSprintHR: null,
  capturedRestHR: null,
};

let activeResultRecord = null;
const STRIDES_VIDEO_URL = 'https://www.youtube.com/watch?v=YA_u3F5aCdU';
const SKIPS_VIDEO_URL = 'https://www.youtube.com/watch?v=A7r6yCpmSrA';


export function clearSessionTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

export function adjust(key, delta) {
  if (key === 'reps') cfg.reps = Math.max(1, Math.min(20, cfg.reps + delta));
  if (key === 'rest') cfg.rest = Math.max(30, Math.min(300, cfg.rest + delta));
  syncConfigControls();
}

function readAthleteMaxHR() {
  try {
    const saved = JSON.parse(localStorage.getItem(HR_INFO_STORAGE_KEY) || '{}');
    const maxHr = Number(saved.maxHr);
    if (Number.isFinite(maxHr) && maxHr > 0) return Math.round(maxHr);
  } catch (err) {
    console.warn('Could not read stored max HR', err);
  }
  return Math.round(Number(HR_INFO_DEFAULTS.maxHr) || 181);
}

/** Coach sync still stores maxHR/targetPct. Athletes no longer set or see them in the timer. */
function applySessionHRConfig() {
  const contextMaxHR = Number(cfg.workoutContext?.maxHr);
  const contextTargetPct = Number(cfg.workoutContext?.targetPct);
  cfg.maxHR = Number.isFinite(contextMaxHR) && contextMaxHR > 0
    ? Math.round(contextMaxHR)
    : readAthleteMaxHR();
  if (Number.isFinite(contextTargetPct) && contextTargetPct > 0) {
    cfg.targetPct = contextTargetPct;
  }
}

function syncConfigControls() {
  const repsVal = document.getElementById('reps-val');
  const restVal = document.getElementById('rest-val');

  if (repsVal) repsVal.textContent = cfg.reps;
  if (restVal) restVal.textContent = cfg.rest;
}

function renderSprintWarmup(context) {
  const group = document.getElementById('sprint-warmup-group');
  const copy = document.getElementById('sprint-warmup-copy');
  const warmup = String(context?.warmup || '').trim();

  if (!group || !copy) return;
  group.hidden = !warmup;
  copy.replaceChildren();
  if (!warmup) return;

  const exercisePattern = /(strides?|A[- ]?skips?|B[- ]?skips?)/gi;
  let cursor = 0;

  for (const match of warmup.matchAll(exercisePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) copy.append(document.createTextNode(warmup.slice(cursor, index)));

    const exercise = match[0];
    const link = document.createElement('a');
    link.className = 'sprint-warmup-link';
    link.href = /^strides?$/i.test(exercise) ? STRIDES_VIDEO_URL : SKIPS_VIDEO_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = exercise;
    copy.append(link);
    cursor = index + exercise.length;
  }

  if (cursor < warmup.length) copy.append(document.createTextNode(warmup.slice(cursor)));
}

export function setWorkoutContext(context = null) {
  cfg.workoutContext = context ? { ...context } : null;
  renderSprintWarmup(cfg.workoutContext);

  if (context && Number.isFinite(Number(context.reps))) {
    cfg.reps = Math.max(1, Math.min(20, Number(context.reps)));
  }

  if (context && Number.isFinite(Number(context.restSeconds))) {
    cfg.rest = Math.max(30, Math.min(300, Number(context.restSeconds)));
  }

  applySessionHRConfig();
  syncConfigControls();
}
function runStartSession() {
  const profile = getAthleteProfile();
  const athleteName = String(profile.athleteName || '').trim();

  if (!athleteName) {
    showScreen('athlete-profile');
    showToast('ENTER ATHLETE NAME');
    const profileInput = document.getElementById('profile-athlete-name');
    if (profileInput) setTimeout(() => profileInput.focus(), 100);
    return;
  }

  saveAthleteProfile({ athleteName });
  activeResultRecord = null;
  clearSessionTimer();

  applySessionHRConfig();

  Object.assign(state, {
    phase: 'idle',
    currentRep: 0,
    timer: null,
    seconds: 0,
    data: [],
    pendingRep: null,
    awaitingModal: false,
    capturedSprintHR: null,
    capturedRestHR: null,
  });

  const dots = document.getElementById('dots-row');
  dots.innerHTML = '';
  for (let i = 0; i < cfg.reps; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i === 0 ? ' active' : '');
    d.id = `dot-${i}`;
    dots.appendChild(d);
  }

  document.getElementById('curr-interval').textContent = 1;
  document.getElementById('total-intervals').textContent = `of ${cfg.reps}`;
  document.getElementById('live-badge').style.display = hasFreshHRSample() ? 'flex' : 'none';

  setStatus('ready');
  setTimerDisplay('PRESS GO', 'GO', 'tap to begin');
  setMainBtn('go', 'GO');
  resetChips();
  setRing(1, false);
  showScreen('session');
  syncHoldToCancelLabels();
}

export function startSession() {
  try {
    runStartSession();
  } catch (err) {
    console.error('Start session failed', err);
    const message = String(err && err.message ? err.message : err).slice(0, 56).toUpperCase();
    showToast(`START FAILED: ${message}`);
  }
}
export function handleMainBtn() {
  if (state.awaitingModal) return;
  unlockAudio();
  if (state.phase === 'idle') beginSprint();
  else if (!AUTO_START_NEXT_SPRINT && state.phase === 'resting') beginSprint();
}

export function beginSprint() {
  clearSessionTimer();
  stopRestLogAlert();
  unlockAudio();

  state.currentRep++;
  state.phase = 'sprinting';
  state.capturedSprintHR = null;
  state.capturedRestHR = null;

  document.getElementById('curr-interval').textContent = state.currentRep;

  for (let i = 0; i < cfg.reps; i++) {
    const d = document.getElementById(`dot-${i}`);
    if (!d) continue;
    d.className =
      'dot' +
      (i < state.currentRep - 1 ? ' done' : i === state.currentRep - 1 ? ' active' : '');
  }

  clearHRBufferForInterval();
  setStatus('sprint');
  setMainBtn('sprint', 'SPRINT DONE');
  setTimerDisplay('SPRINTING', '--', 'hit done when finished');
  setRing(1, true);
  vibrate([100, 50, 100]);
  syncHoldToCancelLabels();
}

export function handleSprintDone() {
  if (state.phase !== 'sprinting') return;

  clearSessionTimer();
  resetChips();
  unlockAudio();
  vibrate([200]);

  const sprintHR = getAutoCapturedHR();

  state.pendingRep = {
    sprintHR,
    restHR: null,
    drop: null,
    suspicious: false,
    needsManualSprint: !sprintHR,
    needsManualRest: false,
  };

  state.capturedSprintHR = sprintHR;
  state.capturedRestHR = null;

  if (!sprintHR) {
    state.phase = 'manual-entry';
    openManualSprintHRModal();
    return;
  }

  document.getElementById('chip-sprint').textContent = sprintHR;
  document.getElementById('chip-sprint').classList.add('has-val');

  startAutoRest();
}

export function openManualSprintHRModal() {
  state.awaitingModal = true;

  const sprintInput = document.getElementById('modal-sprint-hr');
  const restInput = document.getElementById('modal-rest-hr');
  const wrapSprint = document.getElementById('wrap-sprint-hr');
  const wrapRest = document.getElementById('wrap-rest-hr');
  const restLabel = document.querySelector('label[for="modal-rest-hr"]');

  document.getElementById('modal-title').textContent =
    `Interval ${state.currentRep} -- Sprint HR Needed`;
  document.getElementById('modal-sub').textContent = isHRConnected()
    ? 'HR strap is connected, but no fresh sprint HR was available. Enter sprint HR to continue.'
    : 'Enter sprint HR to continue.';

  sprintInput.value = '';
  sprintInput.disabled = false;
  wrapSprint.style.opacity = '1';
  wrapSprint.classList.remove('auto-filled');

  restInput.value = '';
  restInput.disabled = true;
  wrapRest.style.opacity = '0.25';
  wrapRest.classList.remove('auto-filled');
  if (restLabel) restLabel.textContent = 'Recovery HR';

  setStatus('rest');
  setMainBtn('disabled', 'HR NEEDED');
  document.getElementById('hr-modal').classList.add('open');

  setTimeout(() => sprintInput.focus(), 200);
}

export function startAutoRest() {
  const totalRest = getRestDuration(cfg);
  const restCaptureAt = Math.min(REST_CAPTURE_SEC, totalRest);
  runAutoRestCountdown(totalRest, restCaptureAt, 0);
}

function resumeAutoRest() {
  const totalRest = getRestDuration(cfg);
  const restCaptureAt = Math.min(REST_CAPTURE_SEC, totalRest);
  const elapsed = Math.max(0, totalRest - state.seconds);
  runAutoRestCountdown(totalRest, restCaptureAt, elapsed);
}

function runAutoRestCountdown(totalRest, restCaptureAt, initialElapsed) {
  clearSessionTimer();

  let elapsed = Math.max(0, Math.min(totalRest, initialElapsed));
  let captureAttempted = !!(state.pendingRep && state.pendingRep.restHR !== null);
  const startedAt = Date.now() - elapsed * 1000;

  state.phase = 'resting';
  state.seconds = Math.max(0, totalRest - elapsed);

  setStatus('rest');
  setMainBtn('disabled', 'RECOVERING...');
  setTimerDisplay(
    'REST',
    String(state.seconds),
    getRestCaptureCopy(totalRest, restCaptureAt, captureAttempted)
  );
  setRing(state.seconds / totalRest, false);

  const tick = () => {
    elapsed = Math.min(totalRest, Math.floor((Date.now() - startedAt) / 1000));
    state.seconds = Math.max(0, totalRest - elapsed);

    const alreadyCaptured = !!(state.pendingRep && state.pendingRep.restHR !== null);
    const subText = getRestCaptureCopy(totalRest, restCaptureAt, alreadyCaptured || captureAttempted);

    setTimerDisplay('REST', String(state.seconds), subText);
    setRing(state.seconds / totalRest, false);

    const digits = document.getElementById('timer-digits');
    if (state.seconds <= REST_LOG_ALERT_REMAINING_SEC) digits.classList.add('urgent');
    else digits.classList.remove('urgent');

    // At 30s remaining, keep beeping until rest HR is logged. BLE capture
    // usually lands in this same tick, so the alert is only a short cue.
    if (state.seconds <= REST_LOG_ALERT_REMAINING_SEC && !alreadyCaptured) {
      startRestLogAlert();
    } else if (alreadyCaptured) {
      stopRestLogAlert();
    }

    // Fire at/after the checkpoint (60s into rest = 30s left on a 90s timer).
    // Use >= so a delayed/throttled tick cannot skip the exact second.
    if (!captureAttempted && elapsed >= restCaptureAt) {
      captureAttempted = true;
      if (!autoCaptureRestHR(restCaptureAt)) {
        return;
      }
    }

    if (state.seconds <= 0) {
      clearSessionTimer();

      if (state.pendingRep && state.pendingRep.restHR === null && !autoCaptureRestHR(restCaptureAt)) {
        return;
      }

      completeRestAndAdvance();
    }
  };

  state.timer = setInterval(tick, 250);
  tick();
}

export function autoCaptureRestHR(captureAt) {
  if (!state.pendingRep) return false;
  if (state.pendingRep.restHR !== null) return true;

  const restHR = getAutoCapturedHR();

  if (!restHR) {
    // Manual backup only when no BLE HR monitor is connected.
    if (!isHRConnected()) {
      state.pendingRep.needsManualRest = true;
      openManualRestHRModal(captureAt);
      return false;
    }

    showToast(`REST HR NOT CAPTURED @ ${captureAt}s`);
    return true;
  }

  state.pendingRep.restHR = restHR;
  state.pendingRep.needsManualRest = false;
  state.capturedRestHR = restHR;

  document.getElementById('chip-rest').textContent = restHR;
  document.getElementById('chip-rest').classList.add('has-val');

  showToast(`REST HR CAPTURED: ${restHR}`);
  stopRestLogAlert();
  return true;
}

export function openManualRestHRModal(captureAt) {
  clearSessionTimer();
  state.awaitingModal = true;
  state.phase = 'manual-entry';

  const sprintInput = document.getElementById('modal-sprint-hr');
  const restInput = document.getElementById('modal-rest-hr');
  const wrapSprint = document.getElementById('wrap-sprint-hr');
  const wrapRest = document.getElementById('wrap-rest-hr');
  const restLabel = document.querySelector('label[for="modal-rest-hr"]');

  document.getElementById('modal-title').textContent =
    `Interval ${state.currentRep} -- Recovery HR Needed`;
  document.getElementById('modal-sub').textContent =
    'Enter your heart rate at the recovery checkpoint to continue.';

  sprintInput.value = state.pendingRep?.sprintHR || '';
  sprintInput.disabled = true;
  wrapSprint.style.opacity = '0.35';
  wrapSprint.classList.remove('auto-filled');

  restInput.value = '';
  restInput.disabled = false;
  wrapRest.style.opacity = '1';
  wrapRest.classList.remove('auto-filled');
  if (restLabel) restLabel.textContent = `Recovery HR @ ${captureAt}s`;

  setStatus('rest');
  setMainBtn('disabled', 'HR NEEDED');
  document.getElementById('hr-modal').classList.add('open');
  showToast('ENTER RECOVERY HR TO CONTINUE');
  startRestLogAlert();

  setTimeout(() => restInput.focus(), 200);
}

export function completeRestAndAdvance() {
  if (!state.pendingRep) return;

  const sprintHR = state.pendingRep.sprintHR;
  if (!sprintHR) {
    state.phase = 'manual-entry';
    openManualSprintHRModal();
    showToast('ENTER SPRINT HR TO CONTINUE');
    return;
  }

  const restHR = state.pendingRep.restHR;
  const suspicious = restHR !== null && restHR > sprintHR;
  const drop = restHR !== null ? sprintHR - restHR : null;

  if (suspicious) {
    showToast('REST HR HIGHER THAN SPRINT HR');
  }

  state.data.push({ sprintHR, restHR, drop, suspicious });

  if (drop !== null) {
    const chipDrop = document.getElementById('chip-drop');
    chipDrop.textContent = drop;
    chipDrop.classList.add('has-val');
    if (suspicious) chipDrop.classList.add('suspicious');
  }

  state.pendingRep = null;
  state.capturedSprintHR = null;
  state.capturedRestHR = null;
  document.getElementById('timer-digits').classList.remove('urgent');

  stopRestLogAlert();
  restCompleteAlert();

  if (state.currentRep >= cfg.reps) {
    finishSession();
    return;
  }

  if (AUTO_START_NEXT_SPRINT) {
    startNextSprintCountdown();
  } else {
    state.phase = 'resting';
    setMainBtn('go', 'START NEXT SPRINT');
    setTimerDisplay('READY', 'GO', 'tap to sprint');
    setRing(1, false);
  }
}

export function startNextSprintCountdown() {
  const delaySec = Math.max(1, Math.round(AUTO_START_DELAY_MS / 1000));
  let remaining = delaySec;

  state.phase = 'resting';
  setMainBtn('disabled', 'GET READY...');
  setTimerDisplay('NEXT SPRINT', String(remaining), 'get ready');
  setRing(1, false);

  state.timer = setInterval(() => {
    remaining--;

    if (remaining > 0) {
      setTimerDisplay('NEXT SPRINT', String(remaining), 'get ready');
      return;
    }

    clearSessionTimer();
    beginSprint();
  }, 1000);
}

export function confirmHR() {
  if (!state.pendingRep) {
    showToast('NO ACTIVE REP TO UPDATE');
    return;
  }

  if (state.pendingRep.needsManualRest && state.pendingRep.restHR === null) {
    const restCheck = validateRestHR(document.getElementById('modal-rest-hr').value);

    if (!restCheck.valid) {
      showToast('ENTER A VALID RECOVERY HR');
      return;
    }

    state.pendingRep.restHR = restCheck.value;
    state.pendingRep.needsManualRest = false;
    state.capturedRestHR = restCheck.value;

    document.getElementById('chip-rest').textContent = restCheck.value;
    document.getElementById('chip-rest').classList.add('has-val');

    document.getElementById('hr-modal').classList.remove('open');
    document.getElementById('wrap-sprint-hr').classList.remove('auto-filled');
    document.getElementById('wrap-rest-hr').classList.remove('auto-filled');

    state.awaitingModal = false;
    state.phase = 'resting';
    showToast(`RECOVERY HR SAVED: ${restCheck.value}`);
    stopRestLogAlert();

    if (state.seconds <= 0) completeRestAndAdvance();
    else resumeAutoRest();
    return;
  }

  const sprintCheck = validateSprintHR(document.getElementById('modal-sprint-hr').value);

  if (!sprintCheck.valid) {
    showToast('ENTER A VALID SPRINT HR');
    return;
  }

  state.pendingRep.sprintHR = sprintCheck.value;
  state.pendingRep.needsManualSprint = false;
  state.capturedSprintHR = sprintCheck.value;

  document.getElementById('chip-sprint').textContent = sprintCheck.value;
  document.getElementById('chip-sprint').classList.add('has-val');

  document.getElementById('hr-modal').classList.remove('open');
  document.getElementById('wrap-sprint-hr').classList.remove('auto-filled');
  document.getElementById('wrap-rest-hr').classList.remove('auto-filled');

  state.awaitingModal = false;
  state.phase = 'resting';

  startAutoRest();
}

export function sessionCancelRequiresHold() {
  return state.phase !== 'idle' && state.phase !== 'done';
}

export function cancelSession() {
  if (state.phase === 'idle' || state.phase === 'done') return;

  resetSessionUI();

  Object.assign(state, {
    phase: 'idle',
    currentRep: 0,
    timer: null,
    seconds: 0,
    data: [],
    pendingRep: null,
    awaitingModal: false,
    capturedSprintHR: null,
    capturedRestHR: null,
  });

  showScreen('home');
  showToast('SESSION CANCELLED');
}

export function finishSession() {
  clearSessionTimer();
  stopRestLogAlert();
  state.phase = 'done';
  setStatus('done');
  setTimerDisplay('DONE', 'OK', 'session complete');
  setMainBtn('disabled', 'COMPLETE');
  syncHoldToCancelLabels();
  vibrate([100, 50, 100, 50, 200]);
  activeResultRecord = saveSessionToHistory(cfg, state.data);
  window.dispatchEvent(new CustomEvent('ringready:sprint-session-saved', { detail: activeResultRecord }));
  enqueueSessionForSync(cfg, state.data);
  flushSyncQueue().then((result) => {
    if (result.sent > 0) showToast('SESSION SYNCED');
    else if (result.status === 'not-configured') showToast('SESSION SAVED LOCALLY');
    else if (result.status === 'offline') showToast('OFFLINE - SAVED LOCALLY');
  });
  setTimeout(() => buildResults(activeResultRecord), 600);
  setTimeout(() => showScreen('results'), 1000);
}

function getRecordContext(record) {
  return record?.cfg?.workoutContext || record?.workoutContext || null;
}

function isProgramWorkoutRecord(record) {
  const context = getRecordContext(record);
  return Number.isFinite(Number(context?.weekIndex)) && Number.isFinite(Number(context?.workoutIndex));
}

function formatResultDate(record) {
  const rawDate = record?.completedAt || record?.date || new Date().toISOString();
  const date = new Date(rawDate);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function updateCompleteWorkoutButton(record) {
  const btn = document.getElementById('complete-workout-btn');
  const clearBtn = document.getElementById('clear-result-completion-btn');
  if (!btn) return;

  const canComplete = isProgramWorkoutRecord(record);
  btn.hidden = !canComplete;
  if (clearBtn) clearBtn.hidden = !canComplete || !record?.completedAt;
  if (!canComplete) return;

  const isCompleted = !!record?.completedAt;
  const canReplace = hasPendingWorkoutProof('sprint');
  btn.disabled = !hasWorkoutProof('sprint') || (isCompleted && !canReplace);
  btn.classList.toggle('completed', isCompleted);
  btn.textContent = isCompleted ? (canReplace ? 'SAVE REPLACEMENT PROOF' : 'WORKOUT COMPLETE') : 'COMPLETE WORKOUT';
  btn.setAttribute(
    'aria-label',
    isCompleted ? 'Workout already complete' : 'Mark workout complete'
  );
}
export function buildResults(record = activeResultRecord) {
  const resultRecord = record || { date: new Date().toISOString(), cfg: { ...cfg }, data: state.data };
  const data = Array.isArray(resultRecord.data) ? resultRecord.data : [];
  activeResultRecord = resultRecord;

  const body = document.getElementById('results-body');
  body.innerHTML = '';

  document.getElementById('results-date').textContent = formatResultDate(resultRecord);
  if (isProgramWorkoutRecord(resultRecord)) {
    const context = getRecordContext(resultRecord);
    const campLength = Number(getAthleteProfile().campLength) || 7;
    initWorkoutProof('sprint', {
      proofKey: buildProgramProofKey(campLength, context.weekIndex, context.workoutIndex),
      context: { ...context, campLength },
      existingAttachment: resultRecord.attachment || null,
      legacy: !!(resultRecord.completedAt && !resultRecord.proofPolicyVersion),
    });
  } else {
    const proofHost = document.querySelector('[data-proof-host="sprint"]');
    if (proofHost) proofHost.innerHTML = '';
  }

  const avgDrop = Number.isFinite(Number(resultRecord.avgDrop))
    ? Number(resultRecord.avgDrop)
    : calculateAvgDrop(data);
  const maxSprint = Number(resultRecord.peakHR) || calculatePeakHR(data);
  const maxForBars = maxSprint > 0 ? maxSprint : 1;
  const hasValidDrop = data.some((d) => d.drop !== null && !d.suspicious);
  const avgDropDisplay = hasValidDrop ? String(avgDrop) : '--';

  const summary = document.createElement('div');
  summary.className = 'summary-card';
  summary.innerHTML = `
    <div class="summary-stat"><div class="summary-val">${avgDropDisplay}</div><div class="summary-label">Avg Drop</div></div>
    <div class="summary-stat"><div class="summary-val">${maxSprint}</div><div class="summary-label">Peak HR</div></div>
    <div class="summary-stat"><div class="summary-val">${data.length}</div><div class="summary-label">Intervals</div></div>
  `;
  body.appendChild(summary);

  data.forEach((d, i) => {
    const sprintHR = Number(d.sprintHR) || 0;
    const restHR = Number(d.restHR) || 0;
    const sp = Math.min(100, Math.round((sprintHR / maxForBars) * 100));
    const rp = restHR ? Math.min(100, Math.round((restHR / maxForBars) * 100)) : 0;
    const dropStyle =
      d.suspicious || (d.drop !== null && d.drop < 0) ? ' style="color: var(--red)"' : '';
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-num">${i + 1}</div>
      <div class="result-bars">
        <div class="result-bar-row"><div class="result-bar-label">SPRINT</div><div class="result-bar-track"><div class="result-bar-fill sf" style="width:${sp}%"></div></div></div>
        <div class="result-bar-row"><div class="result-bar-label">REST</div><div class="result-bar-track"><div class="result-bar-fill rf" style="width:${rp}%"></div></div></div>
      </div>
      <div class="result-hr-vals">
        <div class="result-hr-val">${sprintHR || '--'} <span>bpm</span></div>
        <div class="result-hr-val">${restHR || '--'} <span>bpm</span></div>
      </div>
      <div class="result-drop">
        <div class="result-drop-val"${dropStyle}>${d.drop !== null ? d.drop : '--'}</div>
        <div class="result-drop-lbl">drop</div>
      </div>
    `;
    body.appendChild(card);
  });

  updateCompleteWorkoutButton(resultRecord);
}

export function buildResultsText(record = activeResultRecord) {
  const resultRecord = record || { date: new Date().toISOString(), cfg: { ...cfg }, data: state.data };
  const data = Array.isArray(resultRecord.data) ? resultRecord.data : [];
  const resultCfg = resultRecord.cfg || cfg;
  const now = new Date(resultRecord.date || Date.now()).toLocaleDateString();
  let text = `Sprint Session -- ${now}\nIntervals: ${data.length} | Rest: ${resultCfg.rest ?? cfg.rest}s\n\n`;

  data.forEach((d, i) => {
    const suspiciousNote = d.suspicious ? ' (suspicious)' : '';
    text += `Rep ${i + 1}: Sprint ${d.sprintHR} BPM -> Rest ${d.restHR || '?'} BPM | Drop: ${d.drop !== null ? d.drop : '?'} BPM${suspiciousNote}\n`;
  });

  const avgDrop = Number.isFinite(Number(resultRecord.avgDrop))
    ? Number(resultRecord.avgDrop)
    : calculateAvgDrop(data);
  if (data.some((d) => d.drop !== null && !d.suspicious)) {
    text += `\nAvg Drop: ${avgDrop} BPM`;
  }

  return text;
}

export async function completeWorkout() {
  if (!activeResultRecord || !Array.isArray(activeResultRecord.data)) {
    showToast('NO SESSION RESULTS TO SAVE');
    return;
  }
  if (!hasWorkoutProof('sprint')) {
    showToast(navigator.onLine ? 'ADD WORKOUT PROOF' : 'INTERNET REQUIRED FOR WORKOUT PROOF');
    return;
  }
  const isNewProof = hasPendingWorkoutProof('sprint');
  try {
    const attachment = await ensureWorkoutProofUploaded('sprint', activeResultRecord.id);
    if (attachment) {
      activeResultRecord = { ...activeResultRecord, proofPolicyVersion: PROOF_POLICY_VERSION, attachment };
      if (isNewProof) enqueueWorkoutProofForSync(attachment, { ...getRecordContext(activeResultRecord), campLength: Number(getAthleteProfile().campLength) || 7 }, activeResultRecord.id);
    }
  } catch (error) {
    console.warn('Sprint proof upload failed', error);
    showToast(String(error?.message || error).toUpperCase());
    return;
  }

  const completed = saveWorkoutCompletion(activeResultRecord);
  if (!completed) {
    showToast('OPEN WORKOUT FROM WEEK PLAN FIRST');
    return;
  }

  activeResultRecord = completed;
  updateCompleteWorkoutButton(completed);
  window.dispatchEvent(new CustomEvent('ringready:workout-completed', { detail: completed }));
  flushSyncQueue().catch((error) => console.warn('Workout proof sync failed', error));
  showToast('WORKOUT COMPLETE');
}

export function clearResultWorkoutCompletion() {
  const context = getRecordContext(activeResultRecord);
  if (!context) {
    showToast('NO WORKOUT TO CLEAR');
    return;
  }

  if (!window.confirm('Mark this workout incomplete on this device?')) return;

  const attachmentId = activeResultRecord?.attachment?.id;
  const removed = removeWorkoutCompletion(context.weekIndex, context.workoutIndex);
  if (!removed) {
    showToast('NO COMPLETION TO CLEAR');
    return;
  }

  activeResultRecord = { ...activeResultRecord };
  delete activeResultRecord.completedAt;
  delete activeResultRecord.completionKey;
  markWorkoutProofCleared(attachmentId, true).catch((error) => console.warn('Could not mark sprint proof cleared', error));
  updateCompleteWorkoutButton(activeResultRecord);
  window.dispatchEvent(new CustomEvent('ringready:workout-completion-cleared', { detail: { weekIndex: context.weekIndex, workoutIndex: context.workoutIndex } }));
  showToast('WORKOUT MARKED INCOMPLETE');
}
window.addEventListener('ringready:proof-state-changed', (event) => {
  if (event.detail?.surface === 'sprint' && activeResultRecord) updateCompleteWorkoutButton(activeResultRecord);
});

export function showSavedWorkoutResult(record) {
  if (!record) return;
  activeResultRecord = record;
  buildResults(record);
  showScreen('results');
}

export async function copyResults() {
  const text = buildResultsText();

  try {
    await navigator.clipboard.writeText(text);
    showToast('COPIED TO CLIPBOARD');
    return;
  } catch (err) {
    // fall through
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();

  try {
    if (document.execCommand('copy')) {
      showToast('COPIED TO CLIPBOARD');
      document.body.removeChild(ta);
      return;
    }
  } catch (err) {
    // fall through
  }

  document.body.removeChild(ta);
  showExportModal(text);
  showToast('COPY FAILED -- USE MANUAL SELECT');
}

export function resetSessionUI() {
  clearSessionTimer();
  stopRestLogAlert();

  document.getElementById('hr-modal').classList.remove('open');
  closeExportModal();
  document.getElementById('timer-digits').classList.remove('urgent');

  document.getElementById('wrap-sprint-hr').classList.remove('auto-filled');
  document.getElementById('wrap-rest-hr').classList.remove('auto-filled');

  document.getElementById('curr-interval').textContent = '1';
  document.getElementById('total-intervals').textContent = `of ${cfg.reps}`;

  const dots = document.getElementById('dots-row');
  if (dots) dots.innerHTML = '';

  resetChips();
  setStatus('ready');
  setTimerDisplay('PRESS GO', 'GO', 'tap to begin');
  setMainBtn('go', 'GO');
  setRing(1, false);

  const badge = document.getElementById('live-badge');
  if (badge) badge.style.display = hasFreshHRSample() ? 'flex' : 'none';

  state.awaitingModal = false;
  syncHoldToCancelLabels();
}

export function newSession() {
  resetSessionUI();
  activeResultRecord = null;

  Object.assign(state, {
    phase: 'idle',
    currentRep: 0,
    timer: null,
    seconds: 0,
    data: [],
    pendingRep: null,
    awaitingModal: false,
    capturedSprintHR: null,
    capturedRestHR: null,
  });

  showScreen('home');
}
