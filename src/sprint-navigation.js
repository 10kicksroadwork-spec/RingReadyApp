const SPRINT_NAVIGATION_ALLOWED_SCREENS = new Set([
  'session',
  'results',
  'auth',
]);

let activeSprintOwnsNavigation = false;

export function setActiveSprintOwnsNavigation(owns) {
  activeSprintOwnsNavigation = !!owns;
}

export function doesActiveSprintOwnNavigation() {
  return activeSprintOwnsNavigation;
}

export function screenIdForSprintNavigation(requestedId) {
  if (!activeSprintOwnsNavigation) return requestedId;
  if (SPRINT_NAVIGATION_ALLOWED_SCREENS.has(requestedId)) return requestedId;
  return 'session';
}
