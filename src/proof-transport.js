/** Wrap proof mutations so transport rejections stay ambiguous and phase-tagged. */

export async function runProofTransportOperation(promise, operation) {
  try {
    return await promise;
  } catch (error) {
    if (error?.proofFailureKind || error?.contractHealthStatus === 'mismatch') {
      throw error;
    }
    const wrapped = error instanceof Error ? error : new Error(String(error || 'Network request failed'));
    wrapped.operation = operation;
    wrapped.ambiguous = true;
    wrapped.retryable = true;
    throw wrapped;
  }
}
