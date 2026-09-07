import { getCurrentUser } from './auth.js';
import { readJSONValue, writeJSON, removeStorageKey, listStorageKeys } from './safe-storage.js';

function key(identity) {
  return `ringReadyDraft:${getCurrentUser()?.id || 'local-athlete'}:${identity}`;
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
export function clearAthleteDrafts() {
  const owner = getCurrentUser()?.id || 'local-athlete';
  for (const prefix of [`ringReadyDraft:${owner}:`, `ringReadyProofDraft:${owner}:`]) {
    const keys = listStorageKeys(prefix);
    for (const entry of keys.value || []) removeStorageKey(entry);
  }
  window.dispatchEvent(new Event('ringready:account-boundary'));
}
