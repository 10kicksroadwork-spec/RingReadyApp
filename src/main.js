import './style.css';
import { initPWAInstall, registerServiceWorker } from './pwa.js';
import { initAthleteShell } from './shell.js';
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

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

async function init() {
  registerServiceWorker();
  initPWAInstall();
  initSyncControls({ showToast });
  await initAthleteShell({ showToast, showScreen, setWorkoutContext, showSavedWorkoutResult });

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
