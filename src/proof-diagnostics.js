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
  IMAGE: 'image_decode',
  UNKNOWN: 'unknown',
};

export const AMBIGUOUS_PROOF_MESSAGE =
  "COULDN'T CONFIRM THE SAVE. CHECK YOUR CONNECTION AND TAP SAVE AGAIN.";

const ATTACHMENT_PERMISSION_PATTERN =
  /permission denied for table workout_attachments/i;

const DETERMINISTIC_RPC_PATTERNS = [
  /linked_record_id not found/i,
  /storage_path must belong/i,
  /proof_key is required/i,
  /file_size out of range/i,
  /unsupported mime_type/i,
  /authentication required/i,
  /idempotency key conflict/i,
  /permission denied/i,
  /invalid linked/i,
];

export function isProofErrorAmbiguous(error) {
  if (!error) return false;
  if (error.proofAmbiguous === true || error.ambiguous === true) return true;
  if (error.name === 'OperationTimeoutError') return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('timed out') || message.includes('abort');
}

export function isProofErrorDeterministic(error) {
  if (!error || isProofErrorAmbiguous(error)) return false;
  if (error.contractHealthStatus === 'mismatch') return true;
  if (error.proofFailureKind === PROOF_FAILURE_KIND.AUTH) return true;
  if (error.proofFailureKind === PROOF_FAILURE_KIND.CONTRACT) return true;
  if (error.proofFailureKind === PROOF_FAILURE_KIND.IMAGE) return true;
  const raw = String(error?.proofRawMessage || error?.message || '');
  return DETERMINISTIC_RPC_PATTERNS.some((pattern) => pattern.test(raw));
}

export function classifyProofUploadError(error, phase = '') {
  const raw = String(error?.message || error || '');
  const message = raw.toLowerCase();

  if (error?.ambiguous || error?.name === 'OperationTimeoutError' || message.includes('timed out')) {
    return {
      kind: PROOF_FAILURE_KIND.NETWORK,
      userMessage: AMBIGUOUS_PROOF_MESSAGE,
      diagnosticDetail: 'operation_timeout',
      retryable: true,
      ambiguous: true,
      raw,
    };
  }

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
      retryable: false,
      ambiguous: false,
      raw,
    };
  }

  if (ATTACHMENT_PERMISSION_PATTERN.test(raw)) {
    return {
      kind: PROOF_FAILURE_KIND.CONTRACT,
      userMessage:
        `Ring Ready could not save this screenshot because the app and data service are out of sync (build ${formatBuildLabel()}). Refresh or reopen the app once. If it happens again, contact your coach.`,
      diagnosticDetail: 'permission_denied_workout_attachments',
      retryable: false,
      ambiguous: false,
      raw,
    };
  }

  if (
    phase === PROOF_UPLOAD_PHASE.STORAGE
    || message.includes('storage')
    || message.includes('bucket')
  ) {
    const ambiguous = message.includes('failed to fetch') || message.includes('network');
    return {
      kind: PROOF_FAILURE_KIND.STORAGE,
      userMessage: ambiguous
        ? AMBIGUOUS_PROOF_MESSAGE
        : 'Screenshot upload failed. Check your connection and try again.',
      diagnosticDetail: ambiguous ? 'storage_upload_ambiguous' : 'storage_upload_failed',
      retryable: ambiguous,
      ambiguous,
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
      userMessage: AMBIGUOUS_PROOF_MESSAGE,
      diagnosticDetail: 'network_error',
      retryable: true,
      ambiguous: true,
      raw,
    };
  }

  if (
    phase === PROOF_UPLOAD_PHASE.RPC
    || message.includes('create_workout_proof_attachment')
    || message.includes('rpc')
    || message.includes('idempotency key conflict')
  ) {
    const ambiguous = !DETERMINISTIC_RPC_PATTERNS.some((pattern) => pattern.test(raw));
    return {
      kind: PROOF_FAILURE_KIND.RPC,
      userMessage: ambiguous
        ? AMBIGUOUS_PROOF_MESSAGE
        : `Proof save failed (build ${formatBuildLabel()}). Try again; if this persists, contact your coach.`,
      diagnosticDetail: ambiguous ? 'proof_rpc_ambiguous' : 'proof_rpc_failed',
      retryable: ambiguous,
      ambiguous,
      raw,
    };
  }

  if (message.includes('could not read') || message.includes('screenshot')) {
    return {
      kind: PROOF_FAILURE_KIND.IMAGE,
      userMessage: raw || 'Could not read that screenshot. Try another image.',
      diagnosticDetail: 'image_decode_failed',
      retryable: false,
      ambiguous: false,
      raw,
    };
  }

  return {
    kind: PROOF_FAILURE_KIND.UNKNOWN,
    userMessage: raw || 'Could not save workout proof.',
    diagnosticDetail: 'unknown',
    retryable: false,
    ambiguous: false,
    raw,
  };
}

export function formatProofUploadError(error, phase = '') {
  return classifyProofUploadError(error, phase).userMessage;
}

export function createProofUploadError(error, phase = '') {
  const classified = classifyProofUploadError(error, phase);

  const err = new Error(classified.userMessage);
  err.proofFailureKind = classified.kind;
  err.proofFailurePhase = phase;
  err.proofRetryable = classified.retryable;
  err.proofAmbiguous = classified.ambiguous;
  err.proofDiagnosticDetail = classified.diagnosticDetail;
  err.proofRawMessage = classified.raw;
  err.ambiguous = classified.ambiguous;
  err.retryable = classified.retryable;
  err.operation = error?.operation || phase || '';

  return err;
}
