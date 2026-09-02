export class OperationTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`Operation timed out: ${operation}`);
    this.name = 'OperationTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.ambiguous = true;
    this.retryable = true;
  }
}

export async function withOperationTimeout(promise, {
  timeoutMs,
  operation = 'operation',
  ambiguous = true,
} = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          const error = new OperationTimeoutError(operation, timeoutMs);
          error.ambiguous = ambiguous;
          error.retryable = ambiguous;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export const OPERATION_TIMEOUT_MS = {
  IDENTITY_STAGING: 12_000,
  STORAGE_UPLOAD: 20_000,
  PROOF_RPC: 12_000,
  CLOUD_COMPLETION: 12_000,
};
