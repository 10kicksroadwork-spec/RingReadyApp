import './style.css';
import { initPWAInstall, registerServiceWorker } from './pwa.js';
import { initAthleteShell } from './shell.js';
import { enforceAthleteOnboarding, installSignupNameCapture } from './onboarding.js';
import { MILE_TEST_STORAGE_KEY } from './app-content.js';
import { getHRMonitorSetupCopy } from './platform.js';
import { initSyncControls } from './sync.js';
import {
  initHRService,
  initHRTransport,
  applyPlatformBLEMode,
  connectHR,
  onHRDisconnectUI,
} from './hr-service.js';
import { registerMainHandlers, showToast, selectExportText, closeExportModal, showScreen } from './ui.js';
import {
  adjust,
  setWorkoutContext,
  startSession,
  handleMainBtn,
  handleSprintDone,
  confirmHR,
  cancelSession,
  copyResults,
  completeWorkout,
  clearResultWorkoutCompletion,
  newSession,
  showSavedWorkoutResult,
} from './app.js';

const READABILITY_STYLES = `
  :root {
    --light-grey: #a3a3a3;
  }

  .app-input-wrap {
    background: #141414;
    border-color: #3d3d3d;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;
  }

  .app-input-wrap:focus-within {
    border-color: var(--gold);
    box-shadow: 0 0 0 1px rgba(245, 200, 66, 0.22);
  }

  .app-input-wrap span {
    color: #f4f4f4;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.7px;
    line-height: 1.35;
  }

  .app-input-wrap input,
  .app-input-wrap select {
    color: #ffffff;
    -webkit-text-fill-color: #ffffff;
    opacity: 1;
  }

  .app-input-wrap input::placeholder {
    color: #969696;
    -webkit-text-fill-color: #969696;
    opacity: 1;
  }

  .app-input-wrap input:disabled,
  .app-input-wrap select:disabled {
    color: #c8c8c8;
    -webkit-text-fill-color: #c8c8c8;
    opacity: 0.72;
  }

  .field-sublabel,
  .status-copy,
  .stepper-unit,
  .ble-status,
  .interval-total,
  .modal-sub,
  .last-result {
    color: var(--light-grey);
  }
`;

let mileSaveInProgress = false;

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function parseDuration(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const colonMatch = raw.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (colonMatch) {
    const minutes = Number(colonMatch[1]);
    const seconds = Number(colonMatch[2]);
    const totalSeconds = minutes * 60 + seconds;

    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;

    return {
      totalSeconds,
      totalMinutes: Number((totalSeconds / 60).toFixed(4)),
      display: `${minutes}:${String(seconds).padStart(2, '0')}`,
    };
  }

  const decimalMinutes = Number(raw);
  if (!Number.isFinite(decimalMinutes) || decimalMinutes <= 0) return null;

  const totalSeconds = Math.round(decimalMinutes * 60);

  return {
    totalSeconds,
    totalMinutes: Number((totalSeconds / 60).toFixed(4)),
    display: `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`,
  };
}

function sanitizeDuration(value) {
  const cleaned = String(value || '').replace(/[^\d:]/g, '');
  if (!cleaned.includes(':')) return cleaned.slice(0, 3);

  const [minutes, ...secondsParts] = cleaned.split(':');
  return `${minutes.slice(0, 3)}:${secondsParts.join('').slice(0, 2)}`;
}

function formatDistance(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '--';
  return num >= 10 ? num.toFixed(1) : num.toFixed(2);
}

function formatDate(value) {
  if (!value) return '--';

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? '--'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getSavedMileResult() {
  try {
    return JSON.parse(localStorage.getItem(MILE_TEST_STORAGE_KEY) || 'null');
  } catch (error) {
    console.warn('Could not read saved Mile Test result', error);
    return null;
  }
}

function getSavedMileDuration(result) {
  if (!result) return null;
  if (result.totalTimeDisplay) return parseDuration(result.totalTimeDisplay);

  if (Number.isFinite(Number(result.totalSeconds)) && Number(result.totalSeconds) > 0) {
    return parseDuration(Number(result.totalSeconds) / 60);
  }

  return parseDuration(result.totalMinutes);
}

function refreshMileResultCopy() {
  const result = getSavedMileResult();
  if (!result) return;

  const duration = getSavedMileDuration(result);
  const maxBpm = Number(result.maxBpm);
  const formattedMaxBpm =
    Number.isFinite(maxBpm) && maxBpm > 0 ? Math.round(maxBpm) : '--';

  const last = document.getElementById('mile-last-result');

  if (last) {
    last.textContent =
      `Last saved: ${formatDistance(result.distance)} mi / ` +
      `${duration?.display || '--'} / ${formattedMaxBpm} max bpm / ` +
      `${formatDate(result.savedAt)}`;
  }

  document.querySelectorAll('.dash-detail-card').forEach((card) => {
    const heading = card.querySelector('span');
    if (heading?.textContent?.trim() !== 'HR Profile') return;

    const copy = card.querySelector('p');
    if (copy) {
      copy.textContent =
        `Mile Test: ${duration?.display || '--'} / ${formattedMaxBpm} max bpm`;
    }
  });
}

function configureMileTimeInput() {
  const input = document.getElementById('mile-time-input');
  if (!input) return;

  const label = input.closest('.app-input-wrap')?.querySelector('span');
  if (label) label.textContent = 'Total Time (MM:SS)';

  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.placeholder = '6:30';
  input.setAttribute('aria-label', 'Mile time in minutes and seconds');

  if (!input.dataset.durationBound) {
    input.dataset.durationBound = 'true';

    input.addEventListener('input', () => {
      if (mileSaveInProgress) return;

      const next = sanitizeDuration(input.value);
      if (input.value !== next) input.value = next;
    });

    input.addEventListener('blur', () => {
      if (mileSaveInProgress) return;

      const parsed = parseDuration(input.value);
      if (parsed) input.value = parsed.display;
    });
  }

  if (
    !mileSaveInProgress &&
    document.activeElement !== input &&
    input.value &&
    !input.value.includes(':')
  ) {
    const parsed = parseDuration(input.value);
    if (parsed) input.value = parsed.display;
  }

  refreshMileResultCopy();
}

function prepareMileValueForSave() {
  const input = document.getElementById('mile-time-input');
  if (!input) return;

  const parsed = parseDuration(input.value);
  if (!parsed) return;

  /*
   * shell.js currently stores decimal minutes. Convert immediately before
   * its existing save handler runs, then restore the athlete-facing MM:SS
   * format immediately afterward.
   */
  mileSaveInProgress = true;
  input.value = String(parsed.totalMinutes);

  window.setTimeout(() => {
    mileSaveInProgress = false;
    configureMileTimeInput();
  }, 0);
}

function initReadabilityEnhancements() {
  if (!document.getElementById('ring-ready-readability-styles')) {
    const style = document.createElement('style');
    style.id = 'ring-ready-readability-styles';
    style.textContent = READABILITY_STYLES;
    document.head.appendChild(style);
  }

  configureMileTimeInput();

  document.getElementById('save-mile-test-btn')?.addEventListener(
    'click',
    prepareMileValueForSave,
    true
  );

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-page-target="mile-test-page"]')) {
      window.setTimeout(configureMileTimeInput, 0);
    }
  });

  window.setInterval(() => {
    const milePage = document.getElementById('mile-test-page');

    if (milePage?.classList.contains('active')) {
      configureMileTimeInput();
    }

    refreshMileResultCopy();
  }, 500);
}

async function init() {
  registerServiceWorker();
  initPWAInstall();
  initSyncControls({ showToast });
  installSignupNameCapture();
  await initAthleteShell({ showToast, showScreen, setWorkoutContext, showSavedWorkoutResult });

  initReadabilityEnhancements();
  await enforceAthleteOnboarding({ showScreen });
  registerMainHandlers({ handleMainBtn, handleSprintDone });

  initHRService({
    showToast,
    onDisconnect: onHRDisconnectUI,
  });

  await initHRTransport();
  applyPlatformBLEMode();

  const setupCopy = document.getElementById('hr-setup-copy');
  if (setupCopy) setupCopy.textContent = getHRMonitorSetupCopy();

  bindClick('ble-btn', () => connectHR());
  bindClick('start-session-btn', () => startSession());
  bindClick('cancel-session-btn', () => cancelSession());
  bindClick('modal-confirm-btn', () => confirmHR());
  bindClick('modal-cancel-btn', () => cancelSession());
  bindClick('copy-results-btn', () => copyResults());
  bindClick('complete-workout-btn', () => completeWorkout());
  bindClick('clear-result-completion-btn', () => clearResultWorkoutCompletion());
  bindClick('new-session-btn', () => newSession());
  bindClick('export-select-btn', () => selectExportText());
  bindClick('export-close-btn', () => closeExportModal());

  document.querySelectorAll('[data-adjust]').forEach((btn) => {
    btn.addEventListener('click', () => {
      adjust(btn.dataset.adjust, Number(btn.dataset.delta));
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error('Init failed', err));
});
