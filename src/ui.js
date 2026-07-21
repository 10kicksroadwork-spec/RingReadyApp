import {
  CIRCUMFERENCE,
  AUTO_START_NEXT_SPRINT,
  AUTO_START_DELAY_MS,
  REST_CAPTURE_SEC,
  REST_COMPLETE_BEEP_HZ,
  REST_COMPLETE_BEEP_MS,
} from './constants.js';

let audioCtx = null;

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

export function beep(freq = REST_COMPLETE_BEEP_HZ, duration = REST_COMPLETE_BEEP_MS) {
  try {
    unlockAudio();
    const ctx = audioCtx;
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = freq;

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
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
