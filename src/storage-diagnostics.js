import { getStorageDiagnostics } from './safe-storage.js';
import { captureRuntimeDiagnostic, sanitizeDiagnosticValue } from './runtime-diagnostics.js';

let latestSnapshot = null;

export function formatStorageDiagnosticDetail(diagnostics = {}) {
  const parts = [
    `available=${!!diagnostics.available}`,
    `probe=${diagnostics.probe?.ok ? 'ok' : diagnostics.probe?.code || 'fail'}`,
    `volatile=${Number(diagnostics.volatileKeys) || 0}`,
  ];

  if (diagnostics.estimate && typeof diagnostics.estimate === 'object') {
    parts.push(`usage=${diagnostics.estimate.usage ?? 'unknown'}`);
    parts.push(`quota=${diagnostics.estimate.quota ?? 'unknown'}`);
  }
  if (diagnostics.estimateError) {
    parts.push(`estimateError=${diagnostics.estimateError}`);
  }
  if (diagnostics.persisted !== null && diagnostics.persisted !== undefined) {
    parts.push(`browserPersisted=${diagnostics.persisted}`);
  }
  if (diagnostics.persistedError) {
    parts.push(`persistedError=${diagnostics.persistedError}`);
  }

  return sanitizeDiagnosticValue(parts.join(' '));
}

export function getLatestStorageDiagnostics() {
  return latestSnapshot;
}

export async function captureStorageDiagnosticSnapshot(overrides = {}) {
  try {
    const diagnostics = await getStorageDiagnostics();
    latestSnapshot = diagnostics;
    captureRuntimeDiagnostic({
      kind: 'storage_snapshot',
      stage: String(overrides.stage || 'startup'),
      detail: formatStorageDiagnosticDetail(diagnostics),
      message: diagnostics.available ? 'web_storage_available' : 'web_storage_degraded',
    });
    return diagnostics;
  } catch (error) {
    captureRuntimeDiagnostic({
      kind: 'storage_snapshot',
      stage: String(overrides.stage || 'startup'),
      detail: 'collect_failed',
      message: sanitizeDiagnosticValue(error?.message || 'unknown'),
    });
    return null;
  }
}

export function scheduleStorageDiagnosticCapture(overrides = {}) {
  void captureStorageDiagnosticSnapshot(overrides);
}
