import { describe, expect, it } from 'vitest';
import {
  RR_PROOF_BUCKET,
  assertAttachmentOwnedByCaller,
  assertAttachmentTransferable,
  buildAttachmentLookupPath,
  planRelayProofTransfer,
  requireRelayUserId,
  resolveProofTransferPlan,
} from '../scripts/workout-proof-transfer-policy.mjs';

function attachment(overrides = {}) {
  return {
    id: 'att-1',
    user_id: 'user-a',
    is_current: true,
    completion_cleared: false,
    storage_bucket: RR_PROOF_BUCKET,
    storage_path: 'user-a/week-0/workout-0/proof.webp',
    transfer_status: 'pending',
    drive_url: '',
    drive_file_id: '',
    ...overrides,
  };
}

describe('workout proof transfer policy', () => {
  it('requires relay-authenticated userId', () => {
    expect(() => requireRelayUserId('')).toThrow(/missing authenticated user ID/);
    expect(() => requireRelayUserId('user-a')).not.toThrow();
  });

  it('binds attachment lookup to authenticated user on relay calls', () => {
    const path = buildAttachmentLookupPath('att-1', 'user-a');
    expect(path).toContain('id=eq.att-1');
    expect(path).toContain('user_id=eq.user-a');
  });

  it('omits user filter for internal retry worker calls', () => {
    const path = buildAttachmentLookupPath('att-1', '');
    expect(path).toContain('id=eq.att-1');
    expect(path).not.toContain('user_id=eq.');
  });

  it('rejects cross-user attachment ownership', () => {
    const row = attachment({ user_id: 'user-b' });
    expect(() => assertAttachmentOwnedByCaller(row, 'att-1', 'user-a'))
      .toThrow(/not owned by caller/);
  });

  it('rejects missing attachment rows', () => {
    expect(() => assertAttachmentOwnedByCaller(null, 'att-1', 'user-a'))
      .toThrow(/not owned by caller/);
  });

  it('rejects non-current attachments', () => {
    expect(() => assertAttachmentTransferable(attachment({ is_current: false })))
      .toThrow(/no longer the current attachment/);
  });

  it('rejects completion-cleared attachments', () => {
    expect(() => assertAttachmentTransferable(attachment({ completion_cleared: true })))
      .toThrow(/cleared completion/);
  });

  it('rejects unexpected storage bucket', () => {
    expect(() => assertAttachmentTransferable(attachment({ storage_bucket: 'other-bucket' })))
      .toThrow(/Unexpected workout proof storage bucket/);
  });

  it('rejects storage path outside owner namespace', () => {
    expect(() => assertAttachmentTransferable(attachment({
      storage_path: 'user-b/week-0/proof.webp',
    }))).toThrow(/storage path does not match owner/);
  });

  it('returns already_complete for successful replay without re-transfer', () => {
    const plan = resolveProofTransferPlan(attachment({
      transfer_status: 'complete',
      drive_url: 'https://drive.google.com/file/d/abc',
      drive_file_id: 'abc',
    }));
    expect(plan).toEqual({
      action: 'already_complete',
      driveUrl: 'https://drive.google.com/file/d/abc',
      driveFileId: 'abc',
    });
  });

  it('requires drive metadata on complete replay', () => {
    expect(() => resolveProofTransferPlan(attachment({
      transfer_status: 'complete',
      drive_url: '',
      drive_file_id: '',
    }))).toThrow(/missing Drive metadata/);
  });

  it('allows first transfer for pending attachments', () => {
    expect(resolveProofTransferPlan(attachment())).toEqual({ action: 'transfer' });
    expect(resolveProofTransferPlan(attachment({ transfer_status: 'failed' })))
      .toEqual({ action: 'transfer' });
  });

  it('plans relay transfer end-to-end for owned pending proof', () => {
    expect(planRelayProofTransfer(attachment(), 'att-1', 'user-a'))
      .toEqual({ action: 'transfer' });
  });

  it('plans idempotent replay for owned complete proof', () => {
    expect(planRelayProofTransfer(attachment({
      transfer_status: 'complete',
      drive_url: 'https://drive.google.com/file/d/abc',
      drive_file_id: 'abc',
    }), 'att-1', 'user-a')).toEqual({
      action: 'already_complete',
      driveUrl: 'https://drive.google.com/file/d/abc',
      driveFileId: 'abc',
    });
  });
});
