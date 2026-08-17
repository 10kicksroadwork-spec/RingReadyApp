export function validateSprintHR(value) {
  const hr = parseInt(value, 10);
  if (!hr || hr < 60 || hr > 230) return { valid: false, value: null };
  return { valid: true, value: hr };
}

export function validateRestHR(value) {
  const hr = parseInt(value, 10);
  if (!hr || hr < 40 || hr >= 230) return { valid: false, value: null };
  return { valid: true, value: hr };
}

export function calculateAvgDrop(data) {
  const validDrops = data.filter((d) => d.drop !== null && !d.suspicious).map((d) => d.drop);
  return validDrops.length ? Math.round(validDrops.reduce((a, b) => a + b, 0) / validDrops.length) : 0;
}

export function calculatePeakHR(data) {
  if (!data.length) return 0;
  return Math.max(...data.map((d) => d.sprintHR));
}

export function getRestDuration(cfg) {
  return Math.max(30, Math.min(300, Number(cfg.rest) || 90));
}

export function getRestCaptureCopy(totalRest, restCaptureAt, captured) {
  if (captured) return 'Rest HR captured -- recover';

  const captureRemaining = Math.max(0, totalRest - restCaptureAt);

  if (captureRemaining === 0) {
    return 'Rest HR captures at end of rest';
  }

  return `Rest HR captures at ${captureRemaining}s left`;
}

/**
 * Format MM:SS while typing. After two minute digits, insert ":".
 * Backspacing off the colon leaves the two digits so athletes can edit minutes.
 */
export function sanitizeDurationInput(value, previousValue = '') {
  const raw = String(value ?? '');
  const previous = String(previousValue ?? '');
  const isDeleting = previous.length > raw.length;
  const cleaned = raw.replace(/[^\d:]/g, '');
  const colonAt = cleaned.indexOf(':');

  if (colonAt !== -1) {
    const minutes = cleaned.slice(0, colonAt).replace(/\D/g, '').slice(0, 3);
    const seconds = cleaned.slice(colonAt + 1).replace(/\D/g, '').slice(0, 2);
    if (!minutes && !seconds) return '';
    if (seconds.length) return `${minutes}:${seconds}`;
    return `${minutes}:`;
  }

  const digits = cleaned.replace(/\D/g, '').slice(0, 5);
  if (!digits) return '';
  if (digits.length === 1) return digits;
  if (digits.length === 2) return isDeleting ? digits : `${digits}:`;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
}
