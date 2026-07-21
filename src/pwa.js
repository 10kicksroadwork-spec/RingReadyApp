let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function getInstallCopy() {
  if (isStandalone()) {
    return { title: 'Installed', copy: 'Runs from your home screen and keeps the workout shell available offline.', button: 'OPEN' };
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (deferredInstallPrompt) {
    return { title: 'Install Ready', copy: 'Add Ring Ready to this device for app-style access.', button: 'INSTALL' };
  }

  if (isIOS) {
    return { title: 'Home Screen Ready', copy: 'Use the browser share menu to add Ring Ready to your home screen.', button: 'READY' };
  }

  return { title: 'Web App Ready', copy: 'This device can run Ring Ready from the browser or home screen.', button: 'READY' };
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
  btn.style.opacity = deferredInstallPrompt && !isStandalone() ? '1' : '0.55';
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

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const isLocalDev = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (isLocalDev) {
    navigator.serviceWorker.getRegistrations?.().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}