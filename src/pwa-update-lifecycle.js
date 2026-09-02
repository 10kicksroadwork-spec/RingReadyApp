export const PROTECTED_SCREENS = new Set(['session', 'results', 'setup']);

export function isProtectedScreen(screenId) {
  return PROTECTED_SCREENS.has(String(screenId || ''));
}

export function canActivateOnScreen(screenId) {
  return !isProtectedScreen(screenId);
}

export function createServiceWorkerUpdateLifecycle(options = {}) {
  const onDiagnostic = options.onDiagnostic || (() => {});
  const onSkipWaiting = options.onSkipWaiting || (() => {});
  const onReload = options.onReload || (() => {});
  const getScreen = options.getScreen || (() => '');

  let phase = 'IDLE';
  let hasSeenController = Boolean(options.initialController);
  let activationRequested = false;
  let reloadStarted = false;
  let reloadPending = false;
  let waitingWorkerSeen = false;

  function record(kind, detail = '') {
    onDiagnostic({
      kind,
      detail: String(detail || getScreen()),
      screen: getScreen(),
    });
  }

  function requestActivation(screenId = getScreen()) {
    if (activationRequested) return false;
    if (!canActivateOnScreen(screenId)) {
      record('sw_activation_deferred', screenId);
      return false;
    }

    activationRequested = true;
    phase = 'ACTIVATION_REQUESTED';
    record('sw_activation_requested', screenId);
    onSkipWaiting();
    return true;
  }

  function noteWaitingWorker(screenId = getScreen()) {
    if (!waitingWorkerSeen) {
      waitingWorkerSeen = true;
      record('sw_update_waiting', screenId);
    }
    phase = 'UPDATE_WAITING';
  }

  function handleInitialWaiting(screenId = getScreen()) {
    noteWaitingWorker(screenId);
    requestActivation(screenId);
  }

  function handleUpdateFound() {
    record('sw_update_found');
  }

  function handleInstallingInstalled(screenId = getScreen()) {
    noteWaitingWorker(screenId);
    requestActivation(screenId);
  }

  function handleControllerChange(screenId = getScreen()) {
    record('sw_controller_changed', screenId);

    if (!hasSeenController) {
      hasSeenController = true;
      return;
    }

    if (reloadStarted) return;

    reloadPending = true;
    phase = 'RELOAD_PENDING';
    tryReload(screenId);
  }

  function tryReload(screenId = getScreen()) {
    if (!reloadPending || reloadStarted) return false;
    if (!canActivateOnScreen(screenId)) return false;

    reloadStarted = true;
    reloadPending = false;
    phase = 'RELOADING';
    record('sw_reload_requested', screenId);
    onReload();
    return true;
  }

  function handleScreenChange(screenId = getScreen()) {
    if (waitingWorkerSeen && !activationRequested) {
      requestActivation(screenId);
    }

    if (reloadPending) {
      tryReload(screenId);
    }
  }

  return {
    getPhase: () => phase,
    isActivationRequested: () => activationRequested,
    isReloadStarted: () => reloadStarted,
    isReloadPending: () => reloadPending,
    hasWaitingWorker: () => waitingWorkerSeen,
    handleInitialWaiting,
    handleUpdateFound,
    handleInstallingInstalled,
    handleControllerChange,
    handleScreenChange,
    tryReload,
    requestActivation,
  };
}
