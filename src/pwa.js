import { renderBuildInfo } from './build-info.js';

let deferredInstallPrompt = null;

let hasSeenServiceWorkerController = false;
let serviceWorkerReloadPending = false;
let serviceWorkerReloadStarted = false;
let deferredReloadObserver = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function getInstallCopy() {
  if (isStandalone()) {
    return {
      title: 'Installed',
      copy: 'Runs from your home screen and keeps the workout shell available offline.',
      button: 'OPEN',
    };
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (deferredInstallPrompt) {
    return {
      title: 'Install Ready',
      copy: 'Add Ring Ready to this device for app-style access.',
      button: 'INSTALL',
    };
  }

  if (isIOS) {
    return {
      title: 'Home Screen Ready',
      copy: 'Use the browser share menu to add Ring Ready to your home screen.',
      button: 'READY',
    };
  }

  return {
    title: 'Web App Ready',
    copy: 'This device can run Ring Ready from the browser or home screen.',
    button: 'READY',
  };
}

export function updateInstallUI() {
  const title = document.getElementById('install-title');
  const copy = document.getElementById('install-copy');
  const btn = document.getElementById('install-btn');

  if (!title || !copy || !btn) return;

  const state = getInstallCopy();

  title.textContent = state.title;
  copy.textContent = state.copy;
  btn.textContent = state.button;

  btn.disabled = !deferredInstallPrompt || isStandalone();
  btn.style.opacity = deferredInstallPrompt && !isStandalone()
    ? '1'
    : '0.55';
}

function shouldAutoReloadForUpdate() {
  const activeScreen = document.querySelector('.screen.active');
  const screenId = activeScreen?.id || '';

  return !['session', 'results', 'setup'].includes(screenId);
}

function notifyAppUpdate(showToast) {
  window.dispatchEvent(
    new CustomEvent('ringready:app-update-ready'),
  );

  if (typeof showToast === 'function') {
    showToast('APP UPDATED — REFRESHING');
  }
}

function performSafeUpdateReload(showToast) {
  if (!serviceWorkerReloadPending) return;
  if (serviceWorkerReloadStarted) return;
  if (!shouldAutoReloadForUpdate()) return;

  serviceWorkerReloadPending = false;
  serviceWorkerReloadStarted = true;

  notifyAppUpdate(showToast);

  window.setTimeout(() => {
    window.location.reload();
  }, 300);
}

function watchForSafeReload(showToast) {
  if (deferredReloadObserver) return;
  if (!document.body) return;
  if (typeof MutationObserver === 'undefined') return;

  deferredReloadObserver = new MutationObserver(() => {
    performSafeUpdateReload(showToast);
  });

  deferredReloadObserver.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

function activateWaitingServiceWorker(registration) {
  if (!registration?.waiting) return;

  registration.waiting.postMessage({
    type: 'SKIP_WAITING',
  });
}

function watchServiceWorkerUpdates(registration) {
  if (!registration) return;

  if (registration.waiting && registration.active) {
    activateWaitingServiceWorker(registration);
  }

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener('statechange', () => {
      if (
        installing.state === 'installed'
        && registration.waiting
      ) {
        activateWaitingServiceWorker(registration);
      }
    });
  });
}

export function initPWAInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();

    deferredInstallPrompt = event;
    updateInstallUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallUI();
  });

  const btn = document.getElementById('install-btn');

  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;

      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;

      deferredInstallPrompt = null;
      updateInstallUI();
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

  hasSeenServiceWorkerController = Boolean(
    navigator.serviceWorker.controller,
  );

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        watchServiceWorkerUpdates(registration);

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
      // First-ever SW installation does not require a reload.
      if (!hasSeenServiceWorkerController) {
        hasSeenServiceWorkerController = true;
        return;
      }

      serviceWorkerReloadPending = true;

      performSafeUpdateReload(showToast);

      if (serviceWorkerReloadPending) {
        watchForSafeReload(showToast);
      }
    },
  );
}

export function initBuildMetadata() {
  renderBuildInfo();
}
