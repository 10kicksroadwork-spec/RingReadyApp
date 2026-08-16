const ROUTE_MARKER = 'ringReady';

let currentRoute = null;
let renderRoute = () => {};
let isBackLocked = () => false;
let initialized = false;

function createRoute(screenId, payload = {}, overlay = '') {
  return {
    [ROUTE_MARKER]: true,
    screenId: String(screenId || 'home'),
    payload: payload && typeof payload === 'object' ? payload : {},
    overlay: String(overlay || ''),
  };
}

function isRingReadyRoute(route) {
  return Boolean(route && route[ROUTE_MARKER] && route.screenId);
}

function routeWithoutOverlay(route) {
  return createRoute(route?.screenId, route?.payload);
}

function routesMatch(left, right) {
  if (!left || !right) return false;
  return left.screenId === right.screenId
    && left.overlay === right.overlay
    && JSON.stringify(left.payload || {}) === JSON.stringify(right.payload || {});
}

function render(route) {
  if (!route) return;
  renderRoute(route);
}

export function initNavigation({
  initialScreen = 'boot',
  onRender,
  shouldLockBack,
} = {}) {
  if (typeof onRender === 'function') renderRoute = onRender;
  if (typeof shouldLockBack === 'function') isBackLocked = shouldLockBack;

  const initialRoute = createRoute(initialScreen);
  currentRoute = initialRoute;
  window.history.replaceState(initialRoute, document.title);

  if (!initialized) {
    window.addEventListener('popstate', handlePopState);
    initialized = true;
  }

  return initialRoute;
}

export function navigate(screenId, payload = {}) {
  const nextRoute = createRoute(screenId, payload);

  if (currentRoute?.overlay) {
    const baseRoute = routeWithoutOverlay(currentRoute);
    if (routesMatch(baseRoute, nextRoute)) {
      window.history.back();
      return;
    }

    window.history.replaceState(nextRoute, document.title);
    currentRoute = nextRoute;
    render(nextRoute);
    return;
  }

  if (routesMatch(currentRoute, nextRoute)) {
    render(nextRoute);
    return;
  }

  window.history.pushState(nextRoute, document.title);
  currentRoute = nextRoute;
  render(nextRoute);
}

export function replaceRoute(screenId, payload = {}) {
  const nextRoute = createRoute(screenId, payload);
  window.history.replaceState(nextRoute, document.title);
  currentRoute = nextRoute;
  render(nextRoute);
}

export function openOverlay(overlay) {
  if (!currentRoute || currentRoute.overlay === overlay) return;
  const nextRoute = createRoute(currentRoute.screenId, currentRoute.payload, overlay);
  window.history.pushState(nextRoute, document.title);
  currentRoute = nextRoute;
  render(nextRoute);
}

export function closeOverlay(overlay) {
  if (currentRoute?.overlay !== overlay) return;
  window.history.back();
}

export function getCurrentRoute() {
  return currentRoute;
}

function handlePopState(event) {
  const nextRoute = isRingReadyRoute(event.state) ? event.state : null;
  if (!nextRoute) return;

  if (isBackLocked(currentRoute, nextRoute)) {
    window.history.pushState(currentRoute, document.title);
    render(currentRoute);
    return;
  }

  currentRoute = nextRoute;
  render(nextRoute);
}
