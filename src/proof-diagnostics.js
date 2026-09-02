import { formatBuildLabel } from './build-info.js';

export const PROOF_UPLOAD_PHASE = {
  STORAGE: 'storage',
  RPC: 'rpc',
};

export const PROOF_FAILURE_KIND = {
  STORAGE: 'storage_upload',
  RPC: 'proof_rpc',
  CONTRACT: 'proof_contract',
  NETWORK: 'network',
  AUTH: 'auth',
  UNKNOWN: 'unknown',
};

const ATTACHMENT_PERMISSION_PATTERN =
  /permission denied for table workout_attachments/i;

export function classifyProofUploadError(error, phase = '') {
  const raw = String(error?.message || error || '');
  const message = raw.toLowerCase();

  // Universal failures come before phase-specific classification.
  if (
    message.includes('jwt')
    || message.includes('not authenticated')
    || message.includes('sign in')
    || message.includes('session')
  ) {
    return {
      kind: PROOF_FAILURE_KIND.AUTH,
      userMessage:
        'Your session expired. Sign in again before submitting workout proof.',
      diagnosticDetail: 'auth_required',
      raw,
    };
  }

  if (
    message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('internet connection')
  ) {
    return {
      kind: PROOF_FAILURE_KIND.NETWORK,
      userMessage:
        'Connection problem while saving proof. Check signal and try again.',
      diagnosticDetail: 'network_error',
      raw,
    };
  }

  if (ATTACHMENT_PERMISSION_PATTERN.test(raw)) {
    return {
      kind: PROOF_FAILURE_KIND.CONTRACT,
      userMessage:
        `Ring Ready could not save this screenshot because the app and data service are out of sync (build ${formatBuildLabel()}). Refresh or reopen the app once. If it happens again, contact your coach.`,
      diagnosticDetail:
        'permission_denied_workout_attachments',
      raw,
    };
  }

  if (
    phase === PROOF_UPLOAD_PHASE.STORAGE
    || message.includes('storage')
    || message.includes('bucket')
  ) {
    return {
      kind: PROOF_FAILURE_KIND.STORAGE,
      userMessage:
        'Screenshot upload failed. Check your connection and try again.',
      diagnosticDetail: 'storage_upload_failed',
      raw,
    };
  }

  if (
    phase === PROOF_UPLOAD_PHASE.RPC
    || message.includes(
      'create_workout_proof_attachment',
    )
    || message.includes('rpc')
  ) {
    return {
      kind: PROOF_FAILURE_KIND.RPC,
      userMessage:
        `Proof save failed (build ${formatBuildLabel()}). Try again; if this persists, contact your coach.`,
      diagnosticDetail: 'proof_rpc_failed',
      raw,
    };
  }

  return {
    kind: PROOF_FAILURE_KIND.UNKNOWN,
    userMessage:
      raw || 'Could not save workout proof.',
    diagnosticDetail: 'unknown',
    raw,
  };
}

export function formatProofUploadError(
  error,
  phase = '',
) {
  return classifyProofUploadError(
    error,
    phase,
  ).userMessage;
}

export function createProofUploadError(
  error,
  phase = '',
) {
  const classified = classifyProofUploadError(
    error,
    phase,
  );

  const err = new Error(classified.userMessage);

  err.proofFailureKind = classified.kind;
  err.proofDiagnosticDetail =
    classified.diagnosticDetail;
  err.proofRawMessage = classified.raw;

  return err;
}
