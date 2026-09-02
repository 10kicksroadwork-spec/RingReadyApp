import {
  PROFILE_STORAGE_KEY,
  STORAGE_KEY,
  WORKOUT_COMPLETIONS_STORAGE_KEY,
} from './constants.js';
import {
  HR_INFO_STORAGE_KEY,
  MILE_TEST_STORAGE_KEY,
} from './app-content.js';
import { readJSONValue, removeStorageKey } from './safe-storage.js';

const SHARED_LOCAL_STATE_KEYS = [
  PROFILE_STORAGE_KEY,
  STORAGE_KEY,
  WORKOUT_COMPLETIONS_STORAGE_KEY,
  HR_INFO_STORAGE_KEY,
  MILE_TEST_STORAGE_KEY,
  'ringReadyProfileFormCollapsed',
  'ringReadyProgramGuideCollapsed',
  'ringReadyWorkoutNotes',
  'ringReadyCampResetAtSeen',
  'ringReadyClearedWorkoutCompletions',
];

export function hasSharedAthleteCacheData() {
  return SHARED_LOCAL_STATE_KEYS.some((key) => {
    const value = readJSONValue(key, null);
    if (value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return String(value).trim().length > 0;
  });
}

export function shouldClearSharedStateOnSwitch(lastUserId, newUserId) {
  return !!(String(lastUserId || '').trim() && String(newUserId || '').trim() && lastUserId !== newUserId);
}

export function shouldFailClosedClearSharedCache(lastCacheOwnerId, newUserId) {
  const owner = String(lastCacheOwnerId || '').trim();
  const next = String(newUserId || '').trim();
  if (!next) return false;
  if (owner && owner !== next) return false;
  return !owner && hasSharedAthleteCacheData();
}

export function clearSharedLocalState() {
  SHARED_LOCAL_STATE_KEYS.forEach((key) => {
    removeStorageKey(key);
  });
}
