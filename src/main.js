import './style.css';
import { initPWAInstall, initBuildMetadata, registerServiceWorker } from './pwa.js';
import { initAthleteShell } from './shell.js';
import { enforceAthleteOnboarding, installSignupNameCapture } from './onboarding.js';
import { openCoachPreviewIfRequested } from './coach-preview.js';
import { MILE_TEST_STORAGE_KEY } from './app-content.js';
import { parseDurationMinutes, sanitizeDurationInput } from './workout.js';
import { getHRMonitorSetupCopy, getSprintHRMonitorDisclaimer } from './platform.js';
import { initSyncControls } from './sync.js';
import {
  initHRService,
  initHRTransport,
  applyPlatformBLEMode,
  connectHR,
  onHRDisconnectUI,
} from './hr-service.js';
import { checkRuntimeContract, CONTRACT_UPDATE_MESSAGE } from './contract-health.js';
import { captureRuntimeDiagnostic, installGlobalRuntimeDiagnostics } from './runtime-diagnostics.js';
import { registerMainHandlers, showToast, selectExportText, closeExportModal, showScreen, bindHoldToCancel } from './ui.js';
import {
  setWorkoutContext,
  startSession,
  handleMainBtn,
  handleSprintDone,
  confirmHR,
  cancelSession,
  sessionCancelRequiresHold,
  completeWorkout,
  clearResultWorkoutCompletion,
  newSession,
  showSavedWorkoutResult,
  initSessionPersistence,
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

function sanitizeDuration(value, previousValue = '') {
  return sanitizeDurationInput(value, previousValue);
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
  if (result.totalTimeDisplay) return parseDurationMinutes(result.totalTimeDisplay);

  if (Number.isFinite(Number(result.totalSeconds)) && Number(result.totalSeconds) > 0) {
    return parseDurationMinutes(Number(result.totalSeconds) / 60);
  }

  return parseDurationMinutes(result.totalMinutes);
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

      const previous = input.dataset.prevDuration || '';
      const next = sanitizeDuration(input.value, previous);
      input.dataset.prevDuration = next;
      if (input.value !== next) input.value = next;
    });

    input.addEventListener('blur', () => {
      if (mileSaveInProgress) return;

      const parsed = parseDurationMinutes(input.value);
      if (parsed) {
        input.value = parsed.display;
        input.dataset.prevDuration = parsed.display;
      }
    });
  }

  if (
    !mileSaveInProgress &&
    document.activeElement !== input &&
    input.value &&
    !input.value.includes(':')
  ) {
    const parsed = parseDurationMinutes(input.value);
    if (parsed) input.value = parsed.display;
  }

  refreshMileResultCopy();
}

function prepareMileValueForSave() {
  const input = document.getElementById('mile-time-input');
  if (!input) return;

  const parsed = parseDurationMinutes(input.value);
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
      window.setTimeout(() => {
        configureMileTimeInput();
        refreshMileResultCopy();
      }, 0);
    }
  });

  document.addEventListener('ringready:screen-changed', (event) => {
    if (event.detail?.screenId === 'mile-test-page') {
      configureMileTimeInput();
      refreshMileResultCopy();
    }
  });
}

function scheduleStartupContractHealthCheck() {
  void checkRuntimeContract().then((result) => {
    if (result.status === 'mismatch') {
      showToast(CONTRACT_UPDATE_MESSAGE, { readable: true });
      captureRuntimeDiagnostic({
        kind: 'contract_mismatch',
        stage: 'startup',
        detail: result.reason || 'mismatch',
        message: CONTRACT_UPDATE_MESSAGE,
      });
      return;
    }

    if (result.status === 'unavailable') {
      captureRuntimeDiagnostic({
        kind: 'contract_health_unavailable',
        stage: 'startup',
        detail: result.error || 'unavailable',
      });
    }
  });
}

async function init() {
  installGlobalRuntimeDiagnostics();
  registerServiceWorker({ showToast });
  initPWAInstall();
  initBuildMetadata();
  scheduleStartupContractHealthCheck();
  initSyncControls({ showToast });
  installSignupNameCapture();
  await initAthleteShell({ showToast, showScreen, setWorkoutContext, showSavedWorkoutResult });

  initReadabilityEnhancements();
  const openedCoachPreview = openCoachPreviewIfRequested();
  if (!openedCoachPreview) await enforceAthleteOnboarding({ showScreen });
  initSessionPersistence();
  registerMainHandlers({ handleMainBtn, handleSprintDone });

  initHRService({
    showToast,
    onDisconnect: onHRDisconnectUI,
  });

  await initHRTransport();
  applyPlatformBLEMode();

  const setupCopy = document.getElementById('hr-setup-copy');
  if (setupCopy) setupCopy.textContent = getHRMonitorSetupCopy();
  const setupDisclaimer = document.getElementById('hr-setup-disclaimer');
  if (setupDisclaimer) {
    setupDisclaimer.innerHTML = `<strong>Before connecting:</strong> ${getSprintHRMonitorDisclaimer()}`;
  }

  bindClick('ble-btn', () => connectHR());
  bindClick('start-session-btn', () => startSession());
  bindHoldToCancel(document.getElementById('cancel-session-btn'), () => cancelSession(), {
    requiresHold: sessionCancelRequiresHold,
  });
  bindClick('modal-confirm-btn', () => confirmHR());
  bindHoldToCancel(document.getElementById('modal-cancel-btn'), () => cancelSession(), {
    requiresHold: sessionCancelRequiresHold,
  });
  bindClick('complete-workout-btn', () => completeWorkout());
  bindClick('clear-result-completion-btn', () => clearResultWorkoutCompletion());
  bindClick('new-session-btn', () => newSession());
  bindClick('export-select-btn', () => selectExportText());
  bindClick('export-close-btn', () => closeExportModal());
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error('Init failed', err));
});
