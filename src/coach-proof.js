/** Coach proof resolution — workout_attachments as authoritative source. */

/**
 * Upload-path outage clean slate for the coach dashboard.
 * Logged sessions with completed_at/session_at before this instant do not count
 * as proof gaps / "Needs a look" attention. New sessions after this still do.
 * Does NOT invent attachments or change athlete proof upload behavior.
 */
export const PROOF_GAP_OUTAGE_WAIVER_BEFORE_ISO = '2026-09-11T00:00:00.000Z';

export function isProofGapWaivedForOutage({
  completedAt = null,
  sessionAt = null,
  updatedAt = null,
} = {}) {
  const cutoffMs = Date.parse(PROOF_GAP_OUTAGE_WAIVER_BEFORE_ISO);
  if (!Number.isFinite(cutoffMs)) return false;
  const stamp = String(completedAt || sessionAt || updatedAt || '').trim();
  if (!stamp) {
    // Historical rows without timestamps are treated as outage residue.
    return true;
  }
  const ts = Date.parse(stamp);
  if (!Number.isFinite(ts)) return true;
  return ts < cutoffMs;
}

export function isCurrentProofAttachment(attachment) {
  if (!attachment) return false;
  if (attachment.is_current === false) return false;
  if (attachment.completion_cleared === true) return false;
  return true;
}

export function findSprintProofAttachment(attachments, sprintRow, weekIndex, workoutIndex) {
  if (!Array.isArray(attachments) || !sprintRow?.user_id) return null;
  const userId = sprintRow.user_id;
  const sessionId = String(sprintRow.session_id || '').trim();

  if (sessionId) {
    const bySession = attachments.find((attachment) => (
      attachment.user_id === userId
      && String(attachment.linked_record_id || '').trim() === sessionId
      && isCurrentProofAttachment(attachment)
    ));
    if (bySession) return bySession;
  }

  if (Number.isFinite(Number(weekIndex)) && Number.isFinite(Number(workoutIndex))) {
    const week = Number(weekIndex);
    const workout = Number(workoutIndex);
    return attachments.find((attachment) => (
      attachment.user_id === userId
      && Number(attachment.week_index) === week
      && Number(attachment.workout_index) === workout
      && isCurrentProofAttachment(attachment)
    )) || null;
  }

  return null;
}

export function sessionHasProof({
  row,
  sprintRow,
  attachments = [],
  isSprint = false,
  weekIndex,
  workoutIndex,
} = {}) {
  if (row?.attachment_id || sprintRow?.attachment_id) return true;
  if (!isSprint || !sprintRow) return false;
  return !!findSprintProofAttachment(attachments, sprintRow, weekIndex, workoutIndex);
}

export function proofTransferLabel(attachment) {
  if (!attachment) return '';
  if (attachment.drive_url) return 'ready';
  if (attachment.transfer_status === 'processing' || attachment.transfer_status === 'pending') {
    return 'processing';
  }
  if (attachment.transfer_status === 'complete') return 'ready';
  return 'uploaded';
}

/**
 * Strict eligibility for clickable coach screenshot links.
 * Unlike isCurrentProofAttachment(), missing flags are not treated as current.
 */
export function isResolvableProofAttachment(attachment, athleteUserId) {
  if (!attachment || !athleteUserId) return false;
  return attachment.user_id === athleteUserId
    && attachment.is_current === true
    && attachment.completion_cleared === false;
}

/**
 * Accept only HTTPS Google Drive file-view URLs for coach screenshot anchors.
 */
export function isValidCoachDriveScreenshotUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'drive.google.com') return false;
  if (parsed.username || parsed.password) return false;
  return /^\/file\/d\/[A-Za-z0-9_-]+(?:\/view)?$/.test(parsed.pathname);
}

function proofLinkResult({ attachmentId = null, url = null, state = 'missing' } = {}) {
  return { attachmentId, url, state };
}

function resolveAttachmentLinkState(attachment) {
  const attachmentId = attachment?.id ? String(attachment.id) : null;
  const rawUrl = String(attachment?.drive_url || '').trim();
  if (rawUrl && isValidCoachDriveScreenshotUrl(rawUrl)) {
    return proofLinkResult({ attachmentId, url: rawUrl, state: 'ready' });
  }
  const transfer = String(attachment?.transfer_status || '').toLowerCase();
  if (transfer === 'processing' || transfer === 'pending') {
    return proofLinkResult({ attachmentId, url: null, state: 'processing' });
  }
  return proofLinkResult({ attachmentId, url: null, state: 'unavailable' });
}

function findAttachmentById(attachments, attachmentId) {
  const id = String(attachmentId || '').trim();
  if (!id || !Array.isArray(attachments)) return null;
  return attachments.find((row) => String(row?.id || '').trim() === id) || null;
}

/**
 * Resolve a display proof link for a logged coach session.
 * Authoritative URL comes from workout_attachments.drive_url only.
 * Explicit attachment IDs never fall back to unrelated screenshots.
 * Legacy sprint association requires exactly one eligible session_id match.
 */
export function resolveSessionProofLink({
  athleteUserId,
  attachmentId = null,
  sprintRow = null,
  attachments = [],
  attachmentsAvailable = true,
} = {}) {
  if (attachmentsAvailable === false) {
    return proofLinkResult({ state: 'unavailable' });
  }

  const explicitId = String(attachmentId || '').trim();
  if (explicitId) {
    const byId = findAttachmentById(attachments, explicitId);
    if (!isResolvableProofAttachment(byId, athleteUserId)) {
      return proofLinkResult({ attachmentId: explicitId, state: 'unavailable' });
    }
    return resolveAttachmentLinkState(byId);
  }

  const sessionId = String(sprintRow?.session_id || '').trim();
  if (sessionId && athleteUserId) {
    const matches = (Array.isArray(attachments) ? attachments : []).filter((attachment) => (
      isResolvableProofAttachment(attachment, athleteUserId)
      && String(attachment.linked_record_id || '').trim() === sessionId
    ));
    if (matches.length > 1) {
      return proofLinkResult({ state: 'unavailable' });
    }
    if (matches.length === 1) {
      return resolveAttachmentLinkState(matches[0]);
    }
  }

  return proofLinkResult({ state: 'missing' });
}

/** Human-readable cue for logged sessions that have a resolved proofLink. */
export function proofLinkCueLabel(proofLink) {
  if (!proofLink || typeof proofLink !== 'object') return '';
  if (proofLink.state === 'ready' && proofLink.url) return 'View screenshot ↗';
  if (proofLink.state === 'processing') return 'Screenshot processing';
  if (proofLink.state === 'unavailable') return 'Screenshot unavailable';
  if (proofLink.state === 'missing') return 'No screenshot attached';
  return '';
}
