/** Pure staging decisions for proof identity before upload. */

import {
  buildProvisionalMileTestCloudPayload,
  buildProvisionalWorkoutCloudPayload,
  getCompletionKeyFromRecord,
} from './cloud-record-mapper.js';

function textOrEmpty(value) {
  return String(value || '').trim();
}

function insertedStaging(fields) {
  return {
    created: true,
    insertedThisAttempt: true,
    reused: false,
    rollbackOwned: true,
    ...fields,
  };
}

function reusedStaging(fields) {
  return {
    created: false,
    insertedThisAttempt: false,
    reused: true,
    rollbackOwned: false,
    ...fields,
  };
}

export function planWorkoutIdentityStaging(existingRow, record) {
  const clientRecordId = textOrEmpty(record?.id);
  const completionKey = getCompletionKeyFromRecord(record);
  if (!completionKey || !clientRecordId) {
    return {
      action: 'skip',
      created: false,
      insertedThisAttempt: false,
      reused: false,
      rollbackOwned: false,
      clientRecordId: '',
      completionKey: '',
    };
  }

  if (!existingRow) {
    return insertedStaging({
      action: 'insert-provisional',
      clientRecordId,
      completionKey,
    });
  }

  if (existingRow.proof_pending) {
    const existingId = textOrEmpty(existingRow.client_record_id);
    // Reused provisional from a prior attempt — never auto-delete on this retry.
    return reusedStaging({
      action: 'refresh-provisional',
      clientRecordId: existingId || clientRecordId,
      completionKey,
    });
  }

  if (!textOrEmpty(existingRow.client_record_id)) {
    return reusedStaging({
      action: 'patch-client-id',
      clientRecordId,
      completionKey,
    });
  }

  return reusedStaging({
    action: 'noop',
    clientRecordId: textOrEmpty(existingRow.client_record_id),
    completionKey,
  });
}

export function planMileTestIdentityStaging(existingRow, result, testContext) {
  const clientRecordId = textOrEmpty(result?.id);
  const testKey = textOrEmpty(testContext?.testKey || result?.testKey);
  if (!testKey || !clientRecordId) {
    return {
      action: 'skip',
      created: false,
      insertedThisAttempt: false,
      reused: false,
      rollbackOwned: false,
      clientRecordId: '',
      testKey: '',
    };
  }

  if (!existingRow) {
    return insertedStaging({
      action: 'insert-provisional',
      clientRecordId,
      testKey,
    });
  }

  if (existingRow.proof_pending) {
    const existingId = textOrEmpty(existingRow.client_record_id);
    return reusedStaging({
      action: 'refresh-provisional',
      clientRecordId: existingId || clientRecordId,
      testKey,
    });
  }

  if (!textOrEmpty(existingRow.client_record_id)) {
    return reusedStaging({
      action: 'patch-client-id',
      clientRecordId,
      testKey,
    });
  }

  return reusedStaging({
    action: 'noop',
    clientRecordId: textOrEmpty(existingRow.client_record_id),
    testKey,
  });
}

export function canRollbackProvisionalStaging(staging, row) {
  // Only rows inserted by THIS attempt may be auto-deleted.
  if (!(staging?.rollbackOwned || staging?.insertedThisAttempt)) return false;
  if (!row) return true;
  return row.proof_pending === true;
}

export function isVisibleCompletionRow(row) {
  return !!row && row.proof_pending !== true;
}

/** Prefer the server-established client_record_id over a freshly generated local id. */
export function resolveCanonicalClientRecordId(identityStaging, localId) {
  const stagedId = textOrEmpty(identityStaging?.clientRecordId);
  const fallbackId = textOrEmpty(localId);
  return stagedId || fallbackId;
}

export {
  buildProvisionalMileTestCloudPayload,
  buildProvisionalWorkoutCloudPayload,
};
