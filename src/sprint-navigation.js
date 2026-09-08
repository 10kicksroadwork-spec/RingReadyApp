const SPRINT_NAVIGATION_ALLOWED_SCREENS = new Set([
  'session',
  'results',
  'auth',
]);

let activeSprintOwnsNavigation = false;
let finalizingSessionId = '';
let resultsVisibleSessionId = '';

export function setActiveSprintOwnsNavigation(owns) {
  activeSprintOwnsNavigation = !!owns;
}

export function beginSessionFinalization(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return;
  finalizingSessionId = id;
  activeSprintOwnsNavigation = true;
}

export function markSessionResultsVisible(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) return;
  resultsVisibleSessionId = id;
  if (finalizingSessionId && finalizingSessionId === resultsVisibleSessionId) {
    finalizingSessionId = '';
    activeSprintOwnsNavigation = false;
  }
}

export function isSessionFinalizationBlocking() {
  return !!finalizingSessionId && finalizingSessionId !== resultsVisibleSessionId;
}

export function getFinalizingSessionId() {
  return finalizingSessionId;
}

export function resetSprintNavigationForTest() {
  activeSprintOwnsNavigation = false;
  finalizingSessionId = '';
  resultsVisibleSessionId = '';
}

export function doesActiveSprintOwnNavigation() {
  return activeSprintOwnsNavigation || isSessionFinalizationBlocking();
}

export function screenIdForSprintNavigation(requestedId) {
  if (!doesActiveSprintOwnNavigation()) return requestedId;
  if (SPRINT_NAVIGATION_ALLOWED_SCREENS.has(requestedId)) return requestedId;
  return 'session';
}
