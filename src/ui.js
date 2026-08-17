import {
  CIRCUMFERENCE,
  REST_LOG_ALERT_HZ,
  REST_LOG_ALERT_MS,
  REST_LOG_ALERT_INTERVAL_MS,
  REST_COMPLETE_BEEP_HZ,
  REST_COMPLETE_BEEP_MS,
  CANCEL_HOLD_MS,
} from './constants.js';

let audioCtx = null;
let restLogAlertTimer = null;
const holdCancelSyncers = [];

export function vibrate(p) {
  if (navigator.vibrate) navigator.vibrate(p);
}

export function unlockAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (err) {
    console.warn('Audio unlock failed', err);
  }
}

export function beep(freq = REST_COMPLETE_BEEP_HZ, duration = REST_COMPLETE_BEEP_MS, volume = 0.2) {
  try {
    unlockAudio();
    const ctx = audioCtx;
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const peak = Math.max(0.05, Math.min(0.4, Number(volume) || 0.2));

    oscillator.type = 'sine';
    oscillator.frequency.value = freq;

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + duration / 1000);
  } catch (err) {
    console.warn('Beep failed', err);
  }
}

export function restCompleteAlert() {
  vibrate([300, 100, 300]);
  beep();
}

function pulseRestLogAlert() {
  vibrate([160]);
  beep(REST_LOG_ALERT_HZ, REST_LOG_ALERT_MS, 0.28);
}

/** Repeat until rest HR is logged. BLE capture stops it quickly; manual entry keeps it going. */
export function startRestLogAlert() {
  if (restLogAlertTimer) return;
  unlockAudio();
  pulseRestLogAlert();
  restLogAlertTimer = setInterval(pulseRestLogAlert, REST_LOG_ALERT_INTERVAL_MS);
}

export function stopRestLogAlert() {
  if (!restLogAlertTimer) return;
  clearInterval(restLogAlertTimer);
  restLogAlertTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

function setHoldCancelLabel(el, text) {
  const label = el.querySelector('.cancel-session-label');
  if (label) label.textContent = text;
  else el.textContent = text;
  el.setAttribute('aria-label', text);
}

/**
 * Require a 5-second hold to cancel once a sprint has started.
 * Before the first GO, a tap still cancels so they can leave the setup screen.
 */
export function bindHoldToCancel(el, onCancel, options = {}) {
  if (!el) return;

  const holdMs = Number(options.holdMs) || CANCEL_HOLD_MS;
  const holdSeconds = Math.max(1, Math.round(holdMs / 1000));
  const requiresHold = typeof options.requiresHold === 'function'
    ? options.requiresHold
    : () => true;
  const idleLabel = options.idleLabel || 'CANCEL SESSION';
  const holdLabel = options.holdLabel || `HOLD ${holdSeconds}S TO CANCEL`;
  const hint = options.hint || `HOLD ${holdSeconds} SECONDS TO CANCEL`;

  let holding = false;
  let holdTimer = null;
  let tickTimer = null;
  let startedAt = 0;
  let ignoreNextClick = false;
  let ignoreClickTimer = null;

  const clearHoldTimers = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const syncIdleLabel = () => {
    setHoldCancelLabel(el, requiresHold() ? holdLabel : idleLabel);
  };

  const stopHold = (showHint = false) => {
    const wasHolding = holding;
    const heldMs = Date.now() - startedAt;
    holding = false;
    el.classList.remove('is-holding');
    clearHoldTimers();
    syncIdleLabel();
    if (showHint && wasHolding && !ignoreNextClick && heldMs < holdMs && requiresHold()) {
      showToast(hint);
    }
  };

  const startHold = (event) => {
    if (holding) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!requiresHold()) return;

    holding = true;
    ignoreNextClick = false;
    startedAt = Date.now();
    el.classList.add('is-holding');
    el.style.setProperty('--cancel-hold-ms', String(holdMs));

    const remainingSeconds = () => Math.max(1, Math.ceil((holdMs - (Date.now() - startedAt)) / 1000));
    setHoldCancelLabel(el, `KEEP HOLDING ${remainingSeconds()}`);
    tickTimer = setInterval(() => {
      setHoldCancelLabel(el, `KEEP HOLDING ${remainingSeconds()}`);
    }, 200);

    holdTimer = setTimeout(() => {
      ignoreNextClick = true;
      stopHold(false);
      onCancel();
      if (ignoreClickTimer) clearTimeout(ignoreClickTimer);
      ignoreClickTimer = setTimeout(() => {
        ignoreNextClick = false;
        ignoreClickTimer = null;
      }, 400);
    }, holdMs);

    if (typeof event.pointerId === 'number') {
      try { el.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    event.preventDefault();
  };

  el.style.setProperty('--cancel-hold-ms', String(holdMs));
  holdCancelSyncers.push(syncIdleLabel);
  syncIdleLabel();

  el.addEventListener('pointerdown', startHold, { passive: false });
  el.addEventListener('pointerup', () => stopHold(true));
  el.addEventListener('pointercancel', () => stopHold(true));
  el.addEventListener('click', (event) => {
    if (ignoreNextClick || requiresHold()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onCancel();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    if (event.repeat) return;
    event.preventDefault();
    if (!requiresHold()) {
      onCancel();
      return;
    }
    startHold(event);
  });
  el.addEventListener('keyup', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    stopHold(true);
  });
  el.addEventListener('blur', () => stopHold(false));
  el.addEventListener('contextmenu', (event) => event.preventDefault());
}

export function syncHoldToCancelLabels() {
  holdCancelSyncers.forEach((sync) => sync());
}

export function showScreen(id) {
  const screen = document.getElementById(id);
  if (!screen) {
    console.warn(`Screen not found: ${id}`);
    showToast(`SCREEN NOT FOUND: ${String(id).toUpperCase()}`);
    return false;
  }

  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  screen.classList.add('active');
  return true;
}
export function setStatus(s) {
  const pill = document.getElementById('status-pill');
  pill.className = 'status-pill ' + s;
  pill.textContent = { sprint: 'SPRINT', rest: 'REST', ready: 'READY', done: 'DONE' }[s] || s.toUpperCase();
}

export function setTimerDisplay(phase, digits, sub) {
  document.getElementById('timer-phase').textContent = phase;
  document.getElementById('timer-digits').textContent = digits;
  document.getElementById('timer-sub').textContent = sub;
}

let mainHandlers = {
  handleMainBtn: () => {},
  handleSprintDone: () => {},
};

export function registerMainHandlers(handlers) {
  mainHandlers = { ...mainHandlers, ...handlers };
}

export function setMainBtn(type, label) {
  const btn = document.getElementById('main-btn');
  btn.className = 'main-btn';
  if (type === 'sprint') {
    btn.classList.add('btn-sprint');
    btn.onclick = mainHandlers.handleSprintDone;
    btn.setAttribute('aria-label', 'Mark sprint done');
  } else if (type === 'go') {
    btn.classList.add('btn-go');
    btn.onclick = mainHandlers.handleMainBtn;
    btn.setAttribute('aria-label', 'Start sprint or go');
  } else {
    btn.classList.add('btn-disabled');
    btn.onclick = null;
    btn.removeAttribute('aria-label');
  }
  btn.textContent = label;
}

export function resetChips() {
  ['chip-sprint', 'chip-rest', 'chip-drop'].forEach((id) => {
    const el = document.getElementById(id);
    el.textContent = '--';
    el.classList.remove('has-val', 'suspicious');
  });
}

export function setRing(progress, isSprint) {
  const ring = document.getElementById('ring');
  ring.style.strokeDashoffset = CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress)));
  ring.setAttribute('class', 'ring-progress ' + (isSprint ? 'sprint-ring' : 'rest-ring'));
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

export function showExportModal(text) {
  document.getElementById('export-text').value = text;
  document.getElementById('export-modal').classList.add('open');
}

export function closeExportModal() {
  document.getElementById('export-modal').classList.remove('open');
}

export function selectExportText() {
  const ta = document.getElementById('export-text');
  ta.focus();
  ta.select();
  showToast('TEXT SELECTED -- COPY MANUALLY');
}
