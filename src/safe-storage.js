/**
 * Sole Web Storage adapter for Ring Ready. All localStorage access should route
 * through this module so quota/unavailability failures are structured and safe.
 */

export const STORAGE_ERROR = {
  UNAVAILABLE: 'storage_unavailable',
  QUOTA_EXCEEDED: 'quota_exceeded',
  SERIALIZE: 'serialize_error',
  PARSE: 'parse_error',
  INVALID_KEY: 'invalid_key',
  UNKNOWN: 'unknown',
};

const PROBE_KEY = '__ring_ready_storage_probe__';

let storageAvailableCache = null;

function hasLocalStorage() {
  return typeof localStorage !== 'undefined' && localStorage !== null;
}

export function isQuotaExceededError(error) {
  if (!error) return false;
  if (error.name === 'QuotaExceededError') return true;
  if (error.code === 22 || error.code === 1014) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('quota') || message.includes('storage');
}

export function classifyStorageError(error) {
  if (!error) return STORAGE_ERROR.UNKNOWN;
  if (error.code === STORAGE_ERROR.UNAVAILABLE) return STORAGE_ERROR.UNAVAILABLE;
  if (isQuotaExceededError(error)) return STORAGE_ERROR.QUOTA_EXCEEDED;
  if (error instanceof SyntaxError) return STORAGE_ERROR.PARSE;
  if (error.code === STORAGE_ERROR.SERIALIZE) return STORAGE_ERROR.SERIALIZE;
  if (error.code === STORAGE_ERROR.INVALID_KEY) return STORAGE_ERROR.INVALID_KEY;
  return STORAGE_ERROR.UNKNOWN;
}

function unavailableResult(fallbackValue = null) {
  return {
    ok: false,
    value: fallbackValue,
    error: new DOMException('localStorage is unavailable', STORAGE_ERROR.UNAVAILABLE),
    code: STORAGE_ERROR.UNAVAILABLE,
  };
}

function failureResult(error, fallbackValue = null) {
  return {
    ok: false,
    value: fallbackValue,
    error,
    code: classifyStorageError(error),
  };
}

function successResult(value) {
  return { ok: true, value };
}

export function isStorageAvailable() {
  if (storageAvailableCache === true) return true;
  if (!hasLocalStorage()) return false;
  storageAvailableCache = probeStorageWrite().ok;
  return storageAvailableCache;
}

export function probeStorageWrite(probeKey = PROBE_KEY) {
  if (!hasLocalStorage()) return unavailableResult();
  try {
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    storageAvailableCache = true;
    return successResult(true);
  } catch (error) {
    storageAvailableCache = null;
    return failureResult(error);
  }
}

export function getStorageItem(key, fallback = null) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return failureResult({ code: STORAGE_ERROR.INVALID_KEY, message: 'Storage key is required' }, fallback);
  }
  if (!hasLocalStorage()) return unavailableResult(fallback);
  try {
    const raw = localStorage.getItem(normalizedKey);
    if (raw === null) return successResult(fallback);
    return successResult(raw);
  } catch (error) {
    console.warn(`Could not read storage key ${normalizedKey}`, error);
    return failureResult(error, fallback);
  }
}

export function setStorageItem(key, value) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return failureResult({ code: STORAGE_ERROR.INVALID_KEY, message: 'Storage key is required' });
  }
  if (!hasLocalStorage()) return unavailableResult();
  try {
    localStorage.setItem(normalizedKey, String(value));
    return successResult(true);
  } catch (error) {
    console.warn(`Could not write storage key ${normalizedKey}`, error);
    return failureResult(error);
  }
}

export function removeStorageKey(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return failureResult({ code: STORAGE_ERROR.INVALID_KEY, message: 'Storage key is required' });
  }
  if (!hasLocalStorage()) return unavailableResult();
  try {
    localStorage.removeItem(normalizedKey);
    return successResult(true);
  } catch (error) {
    console.warn(`Could not remove storage key ${normalizedKey}`, error);
    return failureResult(error);
  }
}

export function listStorageKeys(prefix = '') {
  if (!hasLocalStorage()) return unavailableResult([]);
  try {
    const normalizedPrefix = String(prefix || '');
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (!normalizedPrefix || key.startsWith(normalizedPrefix)) keys.push(key);
    }
    return successResult(keys);
  } catch (error) {
    console.warn('Could not enumerate storage keys', error);
    return failureResult(error, []);
  }
}

export function readStorageJSON(key, fallback) {
  const item = getStorageItem(key, null);
  if (!item.ok) return failureResult(item.error, fallback);
  if (item.value === null) return successResult(fallback);
  try {
    return successResult(JSON.parse(item.value));
  } catch (error) {
    console.warn(`Could not parse storage JSON for ${key}`, error);
    return failureResult(error, fallback);
  }
}

export function writeStorageJSON(key, value) {
  try {
    return setStorageItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Could not serialize storage JSON for ${key}`, error);
    return failureResult({ ...error, code: STORAGE_ERROR.SERIALIZE });
  }
}

/** Convenience read returning only the value (fallback on failure). */
export function readJSONValue(key, fallback) {
  return readStorageJSON(key, fallback).value;
}

/** Convenience write returning structured result. */
export function writeJSON(key, value) {
  return writeStorageJSON(key, value);
}

/** Convenience read returning structured result. */
export function readJSON(key, fallback) {
  return readStorageJSON(key, fallback);
}

export async function getStorageDiagnostics() {
  const diagnostics = {
    available: isStorageAvailable(),
    probe: probeStorageWrite(),
    estimate: null,
    persisted: null,
  };

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (typeof navigator.storage.estimate === 'function') {
        diagnostics.estimate = await navigator.storage.estimate();
      }
      if (typeof navigator.storage.persisted === 'function') {
        diagnostics.persisted = await navigator.storage.persisted();
      }
    } catch (error) {
      diagnostics.estimateError = classifyStorageError(error);
    }
  }

  return diagnostics;
}
