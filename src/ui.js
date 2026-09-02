import {
  CIRCUMFERENCE,
  REST_LOG_ALERT_HZ,
  REST_LOG_ALERT_MS,
  REST_LOG_ALERT_INTERVAL_MS,
  REST_COMPLETE_BEEP_HZ,
  REST_COMPLETE_BEEP_MS,
  CANCEL_HOLD_MS,
  SPRINT_DONE_HOLD_MS,
} from './constants.js';

let audioCtx = null;
let restLogAlertTimer = null;
const holdActionSyncers = [];

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

function setHoldActionLabel(el, text) {
  const label = el.querySelector('.hold-action-label, .cancel-session-label, .main-btn-label');
  if (label) label.textContent = text;
  else el.textContent = text;
  el.setAttribute('aria-label', text);
}

/**
 * Hold-to-confirm control. Use requiresHold() to gate when a press must be held.
 * Optional onTap runs for a normal click when hold is not required.
 */
export function bindHoldAction(el, onComplete, options = {}) {
  if (!el) return;

  const holdMs = Number(options.holdMs) || CANCEL_HOLD_MS;
  const holdSeconds = Math.max(1, Math.round(holdMs / 1000));
  const requiresHold = typeof options.requiresHold === 'function'
    ? options.requiresHold
    : () => true;
  const getIdleLabel = typeof options.getIdleLabel === 'function'
    ? options.getIdleLabel
    : () => options.idleLabel || 'HOLD TO CONFIRM';
  const getHoldLabel = typeof options.getHoldLabel === 'function'
    ? options.getHoldLabel
    : () => options.holdLabel || `HOLD ${holdSeconds}S`;
  const getHoldingLabel = typeof options.getHoldingLabel === 'function'
    ? options.getHoldingLabel
    : (remaining) => options.holdingLabel
      ? String(options.holdingLabel).replace('{n}', String(remaining))
      : `KEEP HOLDING ${remaining}`;
  const hint = options.hint || `HOLD ${holdSeconds} SECONDS`;
  const onTap = typeof options.onTap === 'function' ? options.onTap : null;

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
    setHoldActionLabel(el, requiresHold() ? getHoldLabel() : getIdleLabel());
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
    el.style.setProperty('--hold-ms', String(holdMs));

    const remainingSeconds = () => Math.max(1, Math.ceil((holdMs - (Date.now() - startedAt)) / 1000));
    setHoldActionLabel(el, getHoldingLabel(remainingSeconds()));
    tickTimer = setInterval(() => {
      setHoldActionLabel(el, getHoldingLabel(remainingSeconds()));
    }, 200);

    holdTimer = setTimeout(() => {
      ignoreNextClick = true;
      stopHold(false);
      onComplete();
      if (ignoreClickTimer) clearTimeout(ignoreClickTimer);
      ignoreClickTimer = setTimeout(() => {
        ignoreNextClick = false;
        ignoreClickTimer = null;
      }, 400);
    }, holdMs);

    if (typeof event.pointerId === 'number') {
      try { el.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    event.preventDefault();
  };

  el.style.setProperty('--hold-ms', String(holdMs));
  holdActionSyncers.push(syncIdleLabel);
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
    if (onTap) onTap();
    else onComplete();
  });
  el.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    if (event.repeat) return;
    event.preventDefault();
    if (!requiresHold()) {
      if (onTap) onTap();
      else onComplete();
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

/**
 * Require a 5-second hold to cancel once a sprint has started.
 * Before the first GO, a tap still cancels so they can leave the setup screen.
 */
export function bindHoldToCancel(el, onCancel, options = {}) {
  const holdMs = Number(options.holdMs) || CANCEL_HOLD_MS;
  const holdSeconds = Math.max(1, Math.round(holdMs / 1000));
  bindHoldAction(el, onCancel, {
    ...options,
    holdMs,
    idleLabel: options.idleLabel || 'CANCEL SESSION',
    holdLabel: options.holdLabel || `HOLD ${holdSeconds}S TO CANCEL`,
    hint: options.hint || `HOLD ${holdSeconds} SECONDS TO CANCEL`,
  });
}

export function syncHoldToCancelLabels() {
  holdActionSyncers.forEach((sync) => sync());
}

function ensureMainBtnStructure(btn) {
  if (!btn || btn.querySelector('.main-btn-label')) return btn;
  const fill = document.createElement('span');
  fill.className = 'hold-action-fill';
  fill.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'main-btn-label hold-action-label';
  label.textContent = btn.textContent || 'GO';
  btn.textContent = '';
  btn.append(fill, label);
  return btn;
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
  document.dispatchEvent(new CustomEvent('ringready:screen-changed', { detail: { screenId: id } }));
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
let mainBtnHoldBound = false;

export function registerMainHandlers(handlers) {
  mainHandlers = { ...mainHandlers, ...handlers };
  ensureMainBtnHoldBinding();
}

function ensureMainBtnHoldBinding() {
  const btn = document.getElementById('main-btn');
  if (!btn || mainBtnHoldBound) return;
  ensureMainBtnStructure(btn);
  mainBtnHoldBound = true;

  const holdSeconds = Math.max(1, Math.round(SPRINT_DONE_HOLD_MS / 1000));
  bindHoldAction(btn, () => mainHandlers.handleSprintDone(), {
    holdMs: SPRINT_DONE_HOLD_MS,
    requiresHold: () => btn.classList.contains('btn-sprint'),
    getIdleLabel: () => btn.dataset.idleLabel || 'GO',
    getHoldLabel: () => btn.dataset.holdLabel || `HOLD ${holdSeconds}S`,
    getHoldingLabel: (remaining) => `HOLD ${remaining}`,
    hint: `HOLD ${holdSeconds} SECONDS TO FINISH`,
    onTap: () => mainHandlers.handleMainBtn(),
  });
}

export function setMainBtn(type, label) {
  const btn = ensureMainBtnStructure(document.getElementById('main-btn'));
  ensureMainBtnHoldBinding();
  btn.className = 'main-btn';
  btn.classList.remove('is-holding');

  if (type === 'sprint') {
    const holdSeconds = Math.max(1, Math.round(SPRINT_DONE_HOLD_MS / 1000));
    btn.classList.add('btn-sprint');
    btn.dataset.idleLabel = label || 'SPRINT DONE';
    btn.dataset.holdLabel = `HOLD ${holdSeconds}S`;
    btn.style.setProperty('--hold-ms', String(SPRINT_DONE_HOLD_MS));
    btn.setAttribute('aria-label', `Hold ${holdSeconds} seconds to mark sprint done`);
  } else if (type === 'go') {
    btn.classList.add('btn-go');
    btn.dataset.idleLabel = label || 'GO';
    btn.dataset.holdLabel = label || 'GO';
    btn.setAttribute('aria-label', 'Start sprint or go');
  } else {
    btn.classList.add('btn-disabled');
    btn.dataset.idleLabel = label || '';
    btn.dataset.holdLabel = label || '';
    btn.removeAttribute('aria-label');
  }

  setHoldActionLabel(btn, type === 'sprint' ? btn.dataset.holdLabel : btn.dataset.idleLabel);
  syncHoldToCancelLabels();
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

let toastTimer = null;

export function showToast(msg, options = {}) {
  const t = document.getElementById('toast');
  const readable = Boolean(options.readable) || String(msg).length > 48;
  t.textContent = msg;
  t.classList.toggle('toast-readable', readable);
  t.classList.add('show');
  const duration = readable ? 4500 : 2500;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
    t.classList.remove('toast-readable');
    toastTimer = null;
  }, duration);
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
