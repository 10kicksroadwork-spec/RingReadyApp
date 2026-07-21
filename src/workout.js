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
