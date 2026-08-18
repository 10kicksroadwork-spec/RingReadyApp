export const COACH_EMAILS = [
  'gene.byard@gmail.com',
  '10kicksroadwork@gmail.com',
];

export function isCoachEmail(email) {
  return COACH_EMAILS.includes(String(email || '').trim().toLowerCase());
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

export function isLocalCoachPreviewHost() {
  const host = String(window.location.hostname || '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
