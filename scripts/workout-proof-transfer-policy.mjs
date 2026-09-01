/**
 * Pure policy helpers mirroring RingReadyWorkoutProof.gs relay transfer guards.
 * Keep in sync with rrHandleWorkoutProofEvent / rrTransferWorkoutProof_.
 */

export const RR_PROOF_BUCKET = 'workout-proof-staging';

export function requireRelayUserId(expectedUserId) {
  if (!String(expectedUserId || '').trim()) {
    throw new Error('Workout proof is missing authenticated user ID.');
  }
}

export function buildAttachmentLookupPath(attachmentId, expectedUserId) {
  let path =
    '/rest/v1/workout_attachments'
    + '?select=*'
    + `&id=eq.${encodeURIComponent(attachmentId)}`;
  if (expectedUserId) {
    path += `&user_id=eq.${encodeURIComponent(expectedUserId)}`;
  }
  return `${path}&limit=1`;
}

export function assertAttachmentOwnedByCaller(row, attachmentId, expectedUserId) {
  if (!row) {
    throw new Error(
      `Workout proof attachment not found or not owned by caller: ${attachmentId}`,
    );
  }
  if (expectedUserId && String(row.user_id) !== String(expectedUserId)) {
    throw new Error(
      `Workout proof attachment not found or not owned by caller: ${attachmentId}`,
    );
  }
}

export function assertAttachmentTransferable(row) {
  if (row.is_current !== true) {
    throw new Error('Workout proof is no longer the current attachment.');
  }
  if (row.completion_cleared === true) {
    throw new Error('Workout proof belongs to a cleared completion.');
  }
  if (String(row.storage_bucket || '') !== RR_PROOF_BUCKET) {
    throw new Error('Unexpected workout proof storage bucket.');
  }
  const expectedPathPrefix = `${String(row.user_id || '')}/`;
  if (!String(row.storage_path || '').startsWith(expectedPathPrefix)) {
    throw new Error('Workout proof storage path does not match owner.');
  }
}

export function resolveProofTransferPlan(row) {
  assertAttachmentTransferable(row);
  if (row.transfer_status === 'complete') {
    if (!row.drive_url || !row.drive_file_id) {
      throw new Error('Completed proof is missing Drive metadata.');
    }
    return {
      action: 'already_complete',
      driveUrl: row.drive_url,
      driveFileId: row.drive_file_id,
    };
  }
  return { action: 'transfer' };
}

export function planRelayProofTransfer(row, attachmentId, expectedUserId) {
  requireRelayUserId(expectedUserId);
  assertAttachmentOwnedByCaller(row, attachmentId, expectedUserId);
  return resolveProofTransferPlan(row);
}
