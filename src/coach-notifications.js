/**
 * Coach alert acknowledgement helpers.
 *
 * notifications_cleared_at is a watermark: historical proof/HR/missing issues
 * stay in the session record, but only events newer than the watermark count
 * as ACTIVE coach attention.
 */

export function parseAlertEventMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const stamp = String(value || '').trim();
  if (!stamp) return null;
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : null;
}

export function maxIsoTimestamp(...values) {
  let maxMs = -Infinity;
  let maxIso = '';
  values.forEach((value) => {
    const ms = parseAlertEventMs(value);
    if (ms != null && ms > maxMs) {
      maxMs = ms;
      maxIso = new Date(ms).toISOString();
    }
  });
  return maxIso || '';
}

/**
 * An alert is active when there is no watermark, or when the source event
 * is strictly newer than the watermark. Unknown event times stay active
 * (fail closed) so we do not hide issues we cannot date.
 */
export function isCoachAlertActive(alertEventAt, notificationsClearedAt) {
  const clearedMs = parseAlertEventMs(notificationsClearedAt);
  if (clearedMs == null) return true;
  const eventMs = parseAlertEventMs(alertEventAt);
  if (eventMs == null) return true;
  return eventMs > clearedMs;
}

export function formatAlertsReviewedAt(value) {
  const ms = parseAlertEventMs(value);
  if (ms == null) return '';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function hasClearableCoachAlerts(athlete) {
  if (!athlete) return false;
  if (athlete.completionsAvailable === false) return false;
  const proofGaps = Number(athlete.proofGaps) || 0;
  const watchCount = Number(athlete.watchCount) || 0;
  const missingCount = Number(athlete.missingCount) || 0;
  const skippedCount = Number(athlete.activeSkippedCount) || 0;
  return proofGaps > 0 || watchCount > 0 || missingCount > 0 || skippedCount > 0;
}
