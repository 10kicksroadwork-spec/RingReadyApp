import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/build-info.js', () => ({
  formatBuildLabel: () => 'f409d0c',
}));

import {
  PROOF_FAILURE_KIND,
  PROOF_UPLOAD_PHASE,
  classifyProofUploadError,
  createProofUploadError,
} from '../src/proof-diagnostics.js';

describe('proof upload diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies permission denied on workout_attachments as proof contract mismatch', () => {
    const result = classifyProofUploadError(
      new Error('permission denied for table workout_attachments'),
      PROOF_UPLOAD_PHASE.RPC,
    );

    expect(result.kind).toBe(PROOF_FAILURE_KIND.CONTRACT);
    expect(result.diagnosticDetail).toBe('permission_denied_workout_attachments');
    expect(result.userMessage).toContain('app and data service are out of sync');
    expect(result.userMessage).toContain('f409d0c');
  });

  it('classifies storage upload failures separately from rpc failures', () => {
    const storage = classifyProofUploadError(
      new Error('Bucket not found'),
      PROOF_UPLOAD_PHASE.STORAGE,
    );
    const rpc = classifyProofUploadError(
      new Error('function create_workout_proof_attachment() does not exist'),
      PROOF_UPLOAD_PHASE.RPC,
    );

    expect(storage.kind).toBe(PROOF_FAILURE_KIND.STORAGE);
    expect(storage.userMessage).toContain('Screenshot upload failed');
    expect(rpc.kind).toBe(PROOF_FAILURE_KIND.RPC);
    expect(rpc.userMessage).toContain('Proof save failed');
  });

  it('classifies network and auth failures before storage phase', () => {
    expect(classifyProofUploadError(new Error('Failed to fetch')).kind).toBe(PROOF_FAILURE_KIND.NETWORK);
    expect(classifyProofUploadError(new Error('JWT expired')).kind).toBe(PROOF_FAILURE_KIND.AUTH);
    expect(classifyProofUploadError(new Error('Failed to fetch'), PROOF_UPLOAD_PHASE.STORAGE).kind)
      .toBe(PROOF_FAILURE_KIND.NETWORK);
    expect(classifyProofUploadError(new Error('JWT expired'), PROOF_UPLOAD_PHASE.STORAGE).kind)
      .toBe(PROOF_FAILURE_KIND.AUTH);
  });

  it('attaches diagnostic metadata to thrown proof errors', () => {
    const err = createProofUploadError(
      new Error('permission denied for table workout_attachments'),
      PROOF_UPLOAD_PHASE.RPC,
    );

    expect(err.message).toContain('app and data service are out of sync');
    expect(err.proofFailureKind).toBe(PROOF_FAILURE_KIND.CONTRACT);
    expect(err.proofDiagnosticDetail).toBe('permission_denied_workout_attachments');
    expect(err.proofRawMessage).toContain('workout_attachments');
  });
});
