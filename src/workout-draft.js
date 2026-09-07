import { getCurrentUser } from './auth.js';
import { readJSONValue, writeJSON, removeStorageKey, listStorageKeys } from './safe-storage.js';

function draftOwner(ownerId = '') {
  return String(ownerId || getCurrentUser()?.id || 'local-athlete').trim() || 'local-athlete';
}

function key(identity, ownerId = '') {
  return `ringReadyDraft:${draftOwner(ownerId)}:${identity}`;
}

export function readWorkoutDraft(identity) {
  return readJSONValue(key(identity), null);
}

export function saveWorkoutDraft(identity, value) {
  return writeJSON(key(identity), { ...value, updatedAt: new Date().toISOString() });
}

export function clearWorkoutDraft(identity) {
  return removeStorageKey(key(identity));
}

/** Remove persisted workout/proof drafts for the given owner (outgoing athlete on logout/switch). */
export function clearAthleteDrafts(ownerId = '') {
  const owner = draftOwner(ownerId);
  for (const prefix of [`ringReadyDraft:${owner}:`, `ringReadyProofDraft:${owner}:`]) {
    const keys = listStorageKeys(prefix);
    for (const entry of keys.value || []) removeStorageKey(entry);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('ringready:account-boundary'));
  }
}
