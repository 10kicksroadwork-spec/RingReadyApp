export const COACH_EMAILS = [
  'gene.byard@gmail.com',
  '10kicksroadwork@gmail.com',
];

export function isCoachEmail(email) {
  return COACH_EMAILS.includes(String(email || '').trim().toLowerCase());
}

export function isLocalCoachPreviewHost() {
  const host = String(window.location.hostname || '');
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}
