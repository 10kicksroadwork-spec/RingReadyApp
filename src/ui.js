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
let gestureReprimeBound = false;
let gestureReprimeHandler = null;
let tapForSoundShown = false;
let htmlUnlockEl = null;
let keepAliveOsc = null;
let keepAliveGain = null;
const holdActionSyncers = [];
const WAV_SAMPLE_RATE = 22050;

export function vibrate(p) {
  if (navigator.vibrate) navigator.vibrate(p);
}

/** Current Web Audio state for diagnostics / tests (`none` when unset). */
export function getAudioContextState() {
  return audioCtx ? audioCtx.state : 'none';
}

function logAudioState(reason) {
  console.info('[ringready:audio]', reason, getAudioContextState());
}

function getAudioContextCtor() {
  return window.AudioContext || window.webkitAudioContext || null;
}

/** Prefer playback session so iOS is less likely to keep alerts muted. */
function setAudioSessionPlayback() {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = 'playback';
    }
  } catch {
    /* older WebKit */
  }
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Short mono WAV data-URI for HTMLAudio fallback (more reliable on iOS than oscillators alone). */
function buildBeepWavDataUri(freq, durationMs, volume) {
  const hz = Math.max(80, Number(freq) || REST_COMPLETE_BEEP_HZ);
  const ms = Math.max(20, Number(durationMs) || REST_COMPLETE_BEEP_MS);
  const peak = Math.max(0.05, Math.min(0.4, Number(volume) || 0.2));
  const sampleCount = Math.max(1, Math.floor((WAV_SAMPLE_RATE * ms) / 1000));
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  const attack = Math.floor(WAV_SAMPLE_RATE * 0.01);
  const release = Math.floor(WAV_SAMPLE_RATE * 0.02);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / WAV_SAMPLE_RATE;
    const aEnv = attack > 0 ? Math.min(1, i / attack) : 1;
    const rEnv = release > 0 ? Math.min(1, (sampleCount - i) / release) : 1;
    const sample = Math.sin(2 * Math.PI * hz * t) * peak * aEnv * rEnv;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

async function playHtmlBeep(freq, durationMs, volume) {
  try {
    if (typeof Audio === 'undefined') return false;
    const audio = new Audio(buildBeepWavDataUri(freq, durationMs, volume));
    audio.setAttribute('playsinline', 'true');
    audio.playsInline = true;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

async function unlockHtmlAudio() {
  try {
    if (typeof Audio === 'undefined') return false;
    if (!htmlUnlockEl) {
      htmlUnlockEl = new Audio(buildBeepWavDataUri(440, 24, 0.001));
      htmlUnlockEl.setAttribute('playsinline', 'true');
      htmlUnlockEl.playsInline = true;
    }
    htmlUnlockEl.currentTime = 0;
    await htmlUnlockEl.play();
    htmlUnlockEl.pause();
    htmlUnlockEl.currentTime = 0;
    return true;
  } catch {
    return false;
  }
}

function stopKeepAlive() {
  try {
    keepAliveOsc?.stop();
  } catch {
    /* already stopped */
  }
  keepAliveOsc = null;
  keepAliveGain = null;
}

/** Near-silent tone keeps the iOS audio route warm while the session is active. */
function startKeepAlive(ctx) {
  stopKeepAlive();
  if (!ctx || ctx.state !== 'running') return;
  try {
    keepAliveOsc = ctx.createOscillator();
    keepAliveGain = ctx.createGain();
    keepAliveGain.gain.value = 0.0001;
    keepAliveOsc.frequency.value = 40;
    keepAliveOsc.connect(keepAliveGain);
    keepAliveGain.connect(ctx.destination);
    keepAliveOsc.start();
  } catch {
    stopKeepAlive();
  }
}

/** One-sample silent buffer — keeps iOS Web Audio routed after resume. */
function primeSilentBuffer(ctx) {
  if (!ctx || ctx.state !== 'running') return;
  try {
    const sampleRate = ctx.sampleRate || WAV_SAMPLE_RATE;
    const buffer = ctx.createBuffer(1, 1, sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Silent prime is best-effort; beep path still attempts playback.
  }
}

function bindContextStateWatch(ctx) {
  if (!ctx) return;
  ctx.onstatechange = () => {
    logAudioState('statechange');
    if (ctx.state !== 'running') {
      stopKeepAlive();
      armGestureReprime();
    }
  };
}

async function createFreshAudioContext(reason) {
  const AudioContext = getAudioContextCtor();
  if (!AudioContext) return null;
  if (audioCtx) {
    try {
      audioCtx.onstatechange = null;
      if (audioCtx.state !== 'closed') await audioCtx.close();
    } catch {
      /* ignore close errors */
    }
  }
  stopKeepAlive();
  audioCtx = new AudioContext();
  bindContextStateWatch(audioCtx);
  logAudioState(`${reason}:created`);
  return audioCtx;
}

/**
 * Ensure AudioContext exists and is running.
 * On iOS, pass `{ fromGesture: true }` from a real tap — interrupted contexts
 * often need a fresh AudioContext created inside that gesture.
 * @returns {Promise<boolean>}
 */
export async function unlockAudio(reason = 'unlock', options = {}) {
  const fromGesture = Boolean(options && options.fromGesture);
  setAudioSessionPlayback();

  try {
    const AudioContext = getAudioContextCtor();
    if (!AudioContext) {
      if (fromGesture) await unlockHtmlAudio();
      return false;
    }

    const prior = getAudioContextState();
    const needsFreshGestureCtx = fromGesture
      && audioCtx
      && prior !== 'running'
      && prior !== 'none';

    if (!audioCtx || audioCtx.state === 'closed' || needsFreshGestureCtx) {
      await createFreshAudioContext(reason);
    }

    if (audioCtx.state !== 'running') {
      logAudioState(`${reason}:before-resume`);
      try {
        await audioCtx.resume();
      } catch (err) {
        console.warn('Audio resume failed', err);
        await createFreshAudioContext(`${reason}:recreate`);
        await audioCtx.resume();
      }

      // Gesture path: if resume left us interrupted/suspended, force a brand-new context.
      if (audioCtx.state !== 'running' && fromGesture) {
        await createFreshAudioContext(`${reason}:gesture-fresh`);
        await audioCtx.resume();
      }
      logAudioState(`${reason}:after-resume`);
    }

    if (fromGesture) {
      await unlockHtmlAudio();
    }

    if (audioCtx.state === 'running') {
      primeSilentBuffer(audioCtx);
      startKeepAlive(audioCtx);
      tapForSoundShown = false;
      disarmGestureReprime();
      return true;
    }

    logAudioState(`${reason}:not-running`);
    armGestureReprime();
    return false;
  } catch (err) {
    console.warn('Audio unlock failed', err);
    armGestureReprime();
    return false;
  }
}

function disarmGestureReprime() {
  if (!gestureReprimeBound) return;
  gestureReprimeBound = false;
  if (!gestureReprimeHandler || typeof document === 'undefined') {
    gestureReprimeHandler = null;
    return;
  }
  document.removeEventListener('pointerdown', gestureReprimeHandler, true);
  document.removeEventListener('touchstart', gestureReprimeHandler, true);
  document.removeEventListener('keydown', gestureReprimeHandler, true);
  gestureReprimeHandler = null;
}

/** Stay armed until a gesture successfully reaches running — iOS needs a real tap after lock. */
function armGestureReprime() {
  if (typeof document === 'undefined') return;
  if (gestureReprimeBound) return;
  gestureReprimeBound = true;

  gestureReprimeHandler = () => {
    logAudioState('gesture-reprime:fire');
    void unlockAudio('gesture-reprime', { fromGesture: true });
  };

  document.addEventListener('pointerdown', gestureReprimeHandler, true);
  document.addEventListener('keydown', gestureReprimeHandler, true);
  // Older iOS without Pointer Events still needs touchstart; avoid double-firing when both exist.
  if (typeof window.PointerEvent !== 'function') {
    document.addEventListener('touchstart', gestureReprimeHandler, true);
  }
  logAudioState('gesture-reprime:armed');
}

/**
 * After background/lock, attempt resume and keep gesture re-prime armed until audio runs.
 */
export function recoverAudioAfterBackground() {
  logAudioState('foreground');
  void unlockAudio('foreground');
  armGestureReprime();
}

export function beep(freq = REST_COMPLETE_BEEP_HZ, duration = REST_COMPLETE_BEEP_MS, volume = 0.2) {
  void playBeep(freq, duration, volume);
}

async function playBeep(freq, duration, volume) {
  const peak = Math.max(0.05, Math.min(0.4, Number(volume) || 0.2));
  let webOk = false;

  try {
    const ready = await unlockAudio('beep');
    const ctx = audioCtx;
    if (ready && ctx && ctx.state === 'running') {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const durSec = Math.max(0.05, (Number(duration) || REST_COMPLETE_BEEP_MS) / 1000);

      oscillator.type = 'sine';
      oscillator.frequency.value = freq;

      // Linear ramps — Safari can choke on near-zero exponential ramps.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, now + durSec);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(now);
      oscillator.stop(now + durSec + 0.02);
      webOk = true;
    } else {
      logAudioState('beep:web-skipped');
    }
  } catch (err) {
    console.warn('Beep failed', err);
  }

  const htmlOk = await playHtmlBeep(freq, duration, peak);
  if (htmlOk) logAudioState('beep:html');

  if (!webOk && !htmlOk) {
    armGestureReprime();
    if (!tapForSoundShown) {
      tapForSoundShown = true;
      showToast('TAP FOR SOUND');
    }
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
  void unlockAudio('rest-log-alert');
  armGestureReprime();
  pulseRestLogAlert();
  restLogAlertTimer = setInterval(pulseRestLogAlert, REST_LOG_ALERT_INTERVAL_MS);
}

export function stopRestLogAlert() {
  if (!restLogAlertTimer) return;
  clearInterval(restLogAlertTimer);
  restLogAlertTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

/** Test/helper: drop gesture locks and keep-alive without closing the page. */
export function releaseAudioLocks() {
  disarmGestureReprime();
  stopKeepAlive();
  tapForSoundShown = false;
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

export async function withSavingButton(button, task, { savingLabel = 'SAVING...' } = {}) {
  if (!button) return task();
  const previousText = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.textContent = savingLabel;
  button.setAttribute('aria-busy', 'true');
  try {
    return await task();
  } finally {
    button.removeAttribute('aria-busy');
    button.textContent = previousText;
    button.disabled = wasDisabled;
  }
}

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
