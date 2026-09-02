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
const volatileStorage = new Map();

function getStorageBackend() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return {
        ok: false,
        storage: null,
        error: new DOMException('localStorage is unavailable', STORAGE_ERROR.UNAVAILABLE),
        code: STORAGE_ERROR.UNAVAILABLE,
      };
    }
    return { ok: true, storage, error: null, code: null };
  } catch (error) {
    return {
      ok: false,
      storage: null,
      error,
      code: STORAGE_ERROR.UNAVAILABLE,
    };
  }
}

export function isStorageAccessError(error) {
  if (!error) return false;
  const name = String(error.name || '');
  if (name === 'SecurityError' || name === 'InvalidStateError') return true;
  if (error.code === STORAGE_ERROR.UNAVAILABLE) return true;
  return false;
}

export function isQuotaExceededError(error) {
  if (!error) return false;
  if (error.name === 'QuotaExceededError') return true;
  if (error.code === 22 || error.code === 1014) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('quota');
}

export function classifyStorageError(error) {
  if (!error) return STORAGE_ERROR.UNKNOWN;
  if (error.code === STORAGE_ERROR.UNAVAILABLE || isStorageAccessError(error)) {
    return STORAGE_ERROR.UNAVAILABLE;
  }
  if (isQuotaExceededError(error)) return STORAGE_ERROR.QUOTA_EXCEEDED;
  if (error instanceof SyntaxError) return STORAGE_ERROR.PARSE;
  if (error.code === STORAGE_ERROR.SERIALIZE) return STORAGE_ERROR.SERIALIZE;
  if (error.code === STORAGE_ERROR.INVALID_KEY) return STORAGE_ERROR.INVALID_KEY;
  return STORAGE_ERROR.UNKNOWN;
}

function unavailableResult(fallbackValue = null, error = null) {
  return {
    ok: false,
    value: fallbackValue,
    error: error || new DOMException('localStorage is unavailable', STORAGE_ERROR.UNAVAILABLE),
    code: STORAGE_ERROR.UNAVAILABLE,
    persisted: false,
    volatile: false,
    source: null,
  };
}

function failureResult(error, fallbackValue = null) {
  return {
    ok: false,
    value: fallbackValue,
    error,
    code: classifyStorageError(error),
    persisted: false,
    volatile: false,
    source: null,
  };
}

function successResult(value, extras = {}) {
  return {
    ok: true,
    value,
    code: null,
    persisted: true,
    volatile: false,
    source: 'persistent',
    ...extras,
  };
}

function volatileSuccessResult(value, error = null) {
  return {
    ok: true,
    value,
    code: error ? classifyStorageError(error) : null,
    error: error || null,
    persisted: false,
    volatile: true,
    source: 'memory',
  };
}

function storeVolatileValue(key, value) {
  volatileStorage.set(key, String(value));
}

function clearVolatileValue(key) {
  volatileStorage.delete(key);
}

export function resetStorageAvailabilityCache() {
  storageAvailableCache = null;
}

export function resetVolatileStorageForTest() {
  volatileStorage.clear();
}

export function hasVolatileStorageKey(key) {
  const normalizedKey = String(key || '').trim();
  return normalizedKey ? volatileStorage.has(normalizedKey) : false;
}

export function isStorageAvailable() {
  const backend = getStorageBackend();
  if (!backend.ok) {
    storageAvailableCache = false;
    return false;
  }
  if (storageAvailableCache === true) return true;
  storageAvailableCache = probeStorageWrite().ok;
  return storageAvailableCache;
}

export function probeStorageWrite(probeKey = PROBE_KEY) {
  const backend = getStorageBackend();
  if (!backend.ok) {
    storageAvailableCache = false;
    return unavailableResult(null, backend.error);
  }
  try {
    backend.storage.setItem(probeKey, '1');
    backend.storage.removeItem(probeKey);
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

  if (volatileStorage.has(normalizedKey)) {
    return volatileSuccessResult(volatileStorage.get(normalizedKey));
  }

  const backend = getStorageBackend();
  if (!backend.ok) return unavailableResult(fallback, backend.error);
  try {
    const raw = backend.storage.getItem(normalizedKey);
    if (raw === null) return successResult(fallback);
    return successResult(raw);
  } catch (error) {
    console.warn(`Could not read storage key ${normalizedKey}`, error);
    return failureResult(error, fallback);
  }
}

export function setStorageItem(key, value, options = {}) {
  const persistentOnly = !!options.persistentOnly;
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return failureResult({ code: STORAGE_ERROR.INVALID_KEY, message: 'Storage key is required' });
  }

  const backend = getStorageBackend();
  if (!backend.ok) {
    if (persistentOnly) return unavailableResult(null, backend.error);
    storeVolatileValue(normalizedKey, value);
    return volatileSuccessResult(true, backend.error);
  }

  try {
    backend.storage.setItem(normalizedKey, String(value));
    clearVolatileValue(normalizedKey);
    storageAvailableCache = true;
    return successResult(true);
  } catch (error) {
    console.warn(`Could not write storage key ${normalizedKey}`, error);
    if (persistentOnly) return failureResult(error);
    storeVolatileValue(normalizedKey, value);
    return volatileSuccessResult(true, error);
  }
}

export function removeStorageKey(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return failureResult({ code: STORAGE_ERROR.INVALID_KEY, message: 'Storage key is required' });
  }

  clearVolatileValue(normalizedKey);

  const backend = getStorageBackend();
  if (!backend.ok) return unavailableResult(null, backend.error);
  try {
    backend.storage.removeItem(normalizedKey);
    return successResult(true);
  } catch (error) {
    console.warn(`Could not remove storage key ${normalizedKey}`, error);
    return failureResult(error);
  }
}

export function listStorageKeys(prefix = '') {
  const normalizedPrefix = String(prefix || '');
  const keys = new Set();

  volatileStorage.forEach((_value, key) => {
    if (!normalizedPrefix || key.startsWith(normalizedPrefix)) keys.add(key);
  });

  const backend = getStorageBackend();
  if (!backend.ok) {
    if (keys.size) return successResult([...keys]);
    return unavailableResult([], backend.error);
  }

  try {
    for (let index = 0; index < backend.storage.length; index += 1) {
      const key = backend.storage.key(index);
      if (!key) continue;
      if (!normalizedPrefix || key.startsWith(normalizedPrefix)) keys.add(key);
    }
    return successResult([...keys]);
  } catch (error) {
    console.warn('Could not enumerate storage keys', error);
    if (keys.size) return successResult([...keys]);
    return failureResult(error, []);
  }
}

export function readStorageJSON(key, fallback) {
  const item = getStorageItem(key, null);
  if (!item.ok) return failureResult(item.error, fallback);
  if (item.value === null) return successResult(fallback, {
    persisted: item.persisted,
    volatile: item.volatile,
    source: item.source,
  });
  try {
    return successResult(JSON.parse(item.value), {
      persisted: item.persisted,
      volatile: item.volatile,
      source: item.source,
    });
  } catch (error) {
    console.warn(`Could not parse storage JSON for ${key}`, error);
    return failureResult(error, fallback);
  }
}

export function writeStorageJSON(key, value, options = {}) {
  try {
    return setStorageItem(key, JSON.stringify(value), options);
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
export function writeJSON(key, value, options = {}) {
  return writeStorageJSON(key, value, options);
}

/** Convenience read returning structured result. */
export function readJSON(key, fallback) {
  return readStorageJSON(key, fallback);
}

export async function getStorageDiagnostics() {
  const diagnostics = {
    available: isStorageAvailable(),
    probe: probeStorageWrite(),
    volatileKeys: volatileStorage.size,
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
