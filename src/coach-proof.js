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
