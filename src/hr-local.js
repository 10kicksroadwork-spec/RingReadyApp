import { HR_INFO_DEFAULTS, HR_INFO_STORAGE_KEY } from './app-content.js';
import { readJSONValue, writeJSON } from './safe-storage.js';

function persistJSON(key, value) {
  const result = writeJSON(key, value);
  if (!result.ok) {
    console.warn(`Could not write ${key}`, result.error);
  }
  return result.ok;
}

export function getHRInfo() {
  const saved = readJSONValue(HR_INFO_STORAGE_KEY, {});
  const next = {
    goalWeight: Number(saved.goalWeight ?? HR_INFO_DEFAULTS.goalWeight),
    targetDate: String(saved.targetDate || HR_INFO_DEFAULTS.targetDate),
    maxHr: Number(saved.maxHr ?? HR_INFO_DEFAULTS.maxHr),
    restingHr: Number(saved.restingHr ?? HR_INFO_DEFAULTS.restingHr),
  };
  const updatedAt = String(saved.updatedAt || saved.updated_at || '').trim();
  if (updatedAt) next.updatedAt = updatedAt;
  return next;
}

export function saveHRInfo(info, options = {}) {
  const current = getHRInfo();
  const next = {
    goalWeight: Number(info.goalWeight) || HR_INFO_DEFAULTS.goalWeight,
    targetDate: String(info.targetDate || HR_INFO_DEFAULTS.targetDate),
    maxHr: Number(info.maxHr) || HR_INFO_DEFAULTS.maxHr,
    restingHr: Number(info.restingHr) || HR_INFO_DEFAULTS.restingHr,
  };
  if (options.preserveUpdatedAt) {
    const preserved = String(info.updatedAt || info.updated_at || current.updatedAt || '').trim();
    if (preserved) next.updatedAt = preserved;
  } else {
    next.updatedAt = new Date().toISOString();
  }
  persistJSON(HR_INFO_STORAGE_KEY, next);
  return next;
}
