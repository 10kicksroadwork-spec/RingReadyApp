import { renderBuildInfo } from './build-info.js';
import { captureRuntimeDiagnostic } from './runtime-diagnostics.js';
import { buildSkipWaitingMessage } from './pwa-activation-protocol.js';
import { createServiceWorkerUpdateLifecycle } from './pwa-update-lifecycle.js';

let deferredInstallPrompt = null;
let iosInstallInstructionsVisible = false;
let updateLifecycle = null;
let screenChangeListenerInstalled = false;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

export function isIOSInstallSurface() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function getInstallCopy(options = {}) {
  const standalone = options.standalone ?? isStandalone();
  const hasDeferredPrompt = options.hasDeferredPrompt ?? Boolean(deferredInstallPrompt);
  const isIOS = options.isIOS ?? isIOSInstallSurface();

  if (standalone) {
    return {
      title: 'Installed',
      copy: 'Runs from your home screen and keeps the workout shell available offline.',
      button: 'OPEN',
      actionable: false,
    };
  }

  if (hasDeferredPrompt) {
    return {
      title: 'Install Ready',
      copy: 'Add Ring Ready to this device for app-style access.',
      button: 'INSTALL',
      actionable: true,
    };
  }

  if (isIOS) {
    return {
      title: 'ADD TO HOME SCREEN',
      copy: 'Install Ring Ready for app-style access and the most reliable workout experience.',
      button: 'HOW TO INSTALL',
      actionable: true,
    };
  }

  return {
    title: 'Web App Ready',
    copy: 'This device can run Ring Ready from the browser or home screen.',
    button: 'READY',
    actionable: false,
  };
}

function getActiveScreenId() {
  return document.querySelector('.screen.active')?.id || '';
}

function recordUpdateDiagnostic(entry) {
  captureRuntimeDiagnostic({
    kind: entry.kind,
    stage: 'pwa_update',
    detail: entry.detail || '',
    screen: entry.screen || getActiveScreenId(),
  });
}

function notifyAppUpdate(showToast) {
  window.dispatchEvent(
    new CustomEvent('ringready:app-update-ready'),
  );

  if (typeof showToast === 'function') {
    showToast('APP UPDATED — REFRESHING');
  }
}

function ensureUpdateLifecycle(showToast) {
  if (updateLifecycle) return updateLifecycle;

  updateLifecycle = createServiceWorkerUpdateLifecycle({
    initialController: Boolean(navigator.serviceWorker?.controller),
    getScreen: getActiveScreenId,
    onDiagnostic: recordUpdateDiagnostic,
    onSkipWaiting: () => {
      navigator.serviceWorker?.ready
        ?.then((registration) => {
          registration.waiting?.postMessage(buildSkipWaitingMessage());
        })
        .catch((error) => {
          console.warn('Service worker activation request failed', error);
        });
    },
    onReload: () => {
      notifyAppUpdate(showToast);
      window.setTimeout(() => {
        window.location.reload();
      }, 300);
    },
  });

  return updateLifecycle;
}

function watchScreenChanges(showToast) {
  if (screenChangeListenerInstalled) return;

  const lifecycle = ensureUpdateLifecycle(showToast);

  document.addEventListener('ringready:screen-changed', (event) => {
    const screenId = event.detail?.screenId || getActiveScreenId();
    lifecycle.handleScreenChange(screenId);
  });

  screenChangeListenerInstalled = true;
}

function watchServiceWorkerUpdates(registration, showToast) {
  if (!registration) return;

  const lifecycle = ensureUpdateLifecycle(showToast);

  if (registration.waiting && registration.active) {
    lifecycle.handleInitialWaiting(getActiveScreenId());
  }

  registration.addEventListener('updatefound', () => {
    lifecycle.handleUpdateFound();

    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener('statechange', () => {
      if (
        installing.state === 'installed'
        && registration.waiting
      ) {
        lifecycle.handleInstallingInstalled(getActiveScreenId());
      }
    });
  });
}

function setInstallInstructionsVisible(visible) {
  iosInstallInstructionsVisible = visible;
  const instructions = document.getElementById('install-instructions');
  if (instructions) {
    instructions.hidden = !visible;
  }
}

export function updateInstallUI() {
  const title = document.getElementById('install-title');
  const copy = document.getElementById('install-copy');
  const btn = document.getElementById('install-btn');
  const panel = document.getElementById('install-panel');

  if (!title || !copy || !btn) return;

  const state = getInstallCopy();

  title.textContent = state.title;
  copy.textContent = state.copy;
  btn.textContent = state.button;

  const isIOSWeb = isIOSInstallSurface() && !isStandalone() && !deferredInstallPrompt;

  if (isIOSWeb) {
    btn.disabled = false;
    btn.style.opacity = '1';
    setInstallInstructionsVisible(iosInstallInstructionsVisible);
  } else {
    setInstallInstructionsVisible(false);
    btn.disabled = !state.actionable;
    btn.style.opacity = state.actionable ? '1' : '0.55';
  }

  if (panel) {
    panel.hidden = isStandalone();
  }
}

export function initPWAInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();

    deferredInstallPrompt = event;
    setInstallInstructionsVisible(false);
    updateInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstallInstructionsVisible(false);
    updateInstallUI();
  });

  const btn = document.getElementById('install-btn');

  if (btn) {
    btn.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;

        deferredInstallPrompt = null;
        updateInstallUI();
        return;
      }

      if (isIOSInstallSurface() && !isStandalone()) {
        iosInstallInstructionsVisible = !iosInstallInstructionsVisible;
        updateInstallUI();
      }
    });
  }

  updateInstallUI();
}

export function registerServiceWorker(options = {}) {
  if (!('serviceWorker' in navigator)) return;

  const isLocalDev = [
    'localhost',
    '127.0.0.1',
    '::1',
  ].includes(window.location.hostname);

  if (isLocalDev) {
    navigator.serviceWorker
      .getRegistrations?.()
      .then((registrations) => {
        registrations.forEach((registration) => {
          registration.unregister();
        });
      });

    return;
  }

  const showToast = options.showToast;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        watchServiceWorkerUpdates(registration, showToast);
        watchScreenChanges(showToast);

        registration.update().catch((error) => {
          console.warn(
            'Service worker update check failed',
            error,
          );
        });
      })
      .catch((error) => {
        console.warn(
          'Service worker registration failed',
          error,
        );
      });
  });

  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => {
      const lifecycle = ensureUpdateLifecycle(showToast);
      lifecycle.handleControllerChange(getActiveScreenId());

      watchScreenChanges(showToast);
    },
  );
}

export function initBuildMetadata() {
  renderBuildInfo();
}

export function __testCreateUpdateLifecycle(options) {
  return createServiceWorkerUpdateLifecycle(options);
}
