import { HR_INFO_DEFAULTS, HR_INFO_STORAGE_KEY } from './app-content.js';

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (err) {
    console.warn(`Could not read ${key}`, err);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getHRInfo() {
  const saved = readJSON(HR_INFO_STORAGE_KEY, {});
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
  writeJSON(HR_INFO_STORAGE_KEY, next);
  return next;
}
