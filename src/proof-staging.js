/** Pure staging decisions for proof identity before upload. */

import {
  buildProvisionalMileTestCloudPayload,
  buildProvisionalWorkoutCloudPayload,
  getCompletionKeyFromRecord,
} from './cloud-record-mapper.js';

function textOrEmpty(value) {
  return String(value || '').trim();
}

export function planWorkoutIdentityStaging(existingRow, record) {
  const clientRecordId = textOrEmpty(record?.id);
  const completionKey = getCompletionKeyFromRecord(record);
  if (!completionKey || !clientRecordId) {
    return { action: 'skip', created: false, clientRecordId: '', completionKey: '' };
  }

  if (!existingRow) {
    return { action: 'insert-provisional', created: true, clientRecordId, completionKey };
  }

  if (existingRow.proof_pending) {
    const existingId = textOrEmpty(existingRow.client_record_id);
    return {
      action: 'refresh-provisional',
      created: true,
      clientRecordId: existingId || clientRecordId,
      completionKey,
    };
  }

  if (!textOrEmpty(existingRow.client_record_id)) {
    return { action: 'patch-client-id', created: false, clientRecordId, completionKey };
  }

  return {
    action: 'noop',
    created: false,
    clientRecordId: textOrEmpty(existingRow.client_record_id),
    completionKey,
  };
}

export function planMileTestIdentityStaging(existingRow, result, testContext) {
  const clientRecordId = textOrEmpty(result?.id);
  const testKey = textOrEmpty(testContext?.testKey || result?.testKey);
  if (!testKey || !clientRecordId) {
    return { action: 'skip', created: false, clientRecordId: '', testKey: '' };
  }

  if (!existingRow) {
    return { action: 'insert-provisional', created: true, clientRecordId, testKey };
  }

  if (existingRow.proof_pending) {
    const existingId = textOrEmpty(existingRow.client_record_id);
    return {
      action: 'refresh-provisional',
      created: true,
      clientRecordId: existingId || clientRecordId,
      testKey,
    };
  }

  if (!textOrEmpty(existingRow.client_record_id)) {
    return { action: 'patch-client-id', created: false, clientRecordId, testKey };
  }

  return {
    action: 'noop',
    created: false,
    clientRecordId: textOrEmpty(existingRow.client_record_id),
    testKey,
  };
}

export function canRollbackProvisionalStaging(staging, row) {
  if (!staging?.created) return false;
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
