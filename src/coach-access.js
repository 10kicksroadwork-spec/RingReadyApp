export const COACH_EMAILS = [
  'gene.byard@gmail.com',
  '10kicksroadwork@gmail.com',
];

/** Hidden from the live coach roster even when they have athlete profiles. */
export const ROSTER_EXCLUDED_USER_IDS = [
  '81c1f795-cd72-416d-b56d-4c3578a7c7f9',
  '0c4d24e9-9778-456f-b046-970f32235fff',
  '05a75ab0-ebac-4a2b-b959-6820225bd028',
  '77481fd7-1411-4799-96bb-42daa347ab6a',
];

export const ROSTER_EXCLUDED_EMAILS = [
  'd.a.friend108@gmail.com',
  'kellimbergmann@gmail.com',
  'ryankfisch@gmail.com',
  'simonbhyard@gmail.com',
];

export function isCoachEmail(email) {
  return COACH_EMAILS.includes(String(email || '').trim().toLowerCase());
}

export function isRosterExcludedEmail(email) {
  return ROSTER_EXCLUDED_EMAILS.includes(String(email || '').trim().toLowerCase());
}

export function normalizeUserId(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildCoachUserIdSet(identities = [], currentUserId = '') {
  const ids = new Set();
  const currentId = normalizeUserId(currentUserId);
  if (currentId) ids.add(currentId);
  identities.forEach((row) => {
    const id = normalizeUserId(row?.user_id);
    if (id && isCoachEmail(row?.email)) ids.add(id);
  });
  return ids;
}

export function buildRosterExclusionSet(exclusions = []) {
  const ids = new Set(ROSTER_EXCLUDED_USER_IDS.map(normalizeUserId));
  exclusions.forEach((row) => {
    const id = normalizeUserId(row?.user_id);
    if (id) ids.add(id);
  });
  return ids;
}

export function isLocalCoachPreviewHost() {
  const host = String(window.location.hostname || '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
