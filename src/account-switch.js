import {
  PROFILE_STORAGE_KEY,
  STORAGE_KEY,
  WORKOUT_COMPLETIONS_STORAGE_KEY,
} from './constants.js';
import {
  HR_INFO_STORAGE_KEY,
  MILE_TEST_STORAGE_KEY,
} from './app-content.js';
import { removeStorageKey } from './safe-storage.js';

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

export function shouldClearSharedStateOnSwitch(lastUserId, newUserId) {
  return !!(String(lastUserId || '').trim() && String(newUserId || '').trim() && lastUserId !== newUserId);
}

export function clearSharedLocalState() {
  SHARED_LOCAL_STATE_KEYS.forEach((key) => {
    removeStorageKey(key);
  });
}
