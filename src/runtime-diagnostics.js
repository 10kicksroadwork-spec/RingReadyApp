import { APP_BUILD_SHA, PROOF_CONTRACT_VERSION } from './build-info.js';
import { classifyProofUploadError } from './proof-diagnostics.js';

const diagnostics = [];
const MAX_DIAGNOSTICS = 50;

const REDACTION_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /(?:access|refresh)[_-]?token["'\s:=]+[A-Za-z0-9\-._~+/]+=*/gi,
  /password["'\s:=]+[^\s"'`,]+/gi,
];

function isStandaloneSurface() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true;
}

function getBrowserClass() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = String(navigator.userAgent || '');
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Chrome/.test(ua)) return 'chromium';
  if (/Safari/.test(ua)) return 'safari';
  return 'other';
}

function getActiveScreenId() {
  if (typeof document === 'undefined') return '';
  const visible = document.querySelector('.screen.active');
  return visible?.id || '';
}

export function sanitizeDiagnosticValue(value) {
  let text = String(value ?? '');
  for (const pattern of REDACTION_PATTERNS) {
    text = text.replace(pattern, '[redacted]');
  }
  return text.slice(0, 500);
}

export function getRuntimeContext(overrides = {}) {
  return {
    buildSha: APP_BUILD_SHA,
    proofContractVersion: PROOF_CONTRACT_VERSION,
    platform: typeof navigator !== 'undefined' ? (navigator.platform || '') : '',
    browserClass: getBrowserClass(),
    standalone: isStandaloneSurface(),
    screen: getActiveScreenId(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

export function captureRuntimeDiagnostic(entry = {}) {
  const record = {
    ...getRuntimeContext(),
    kind: String(entry.kind || 'unknown'),
    stage: String(entry.stage || ''),
    detail: sanitizeDiagnosticValue(entry.detail || ''),
    message: sanitizeDiagnosticValue(entry.message || ''),
  };

  diagnostics.push(record);
  if (diagnostics.length > MAX_DIAGNOSTICS) {
    diagnostics.shift();
  }

  console.info('[ringready:diagnostic]', record);
  return record;
}

export function classifyRuntimeError(error) {
  if (error?.proofFailureKind) {
    return {
      kind: error.proofFailureKind,
      message: sanitizeDiagnosticValue(error.message),
    };
  }

  const classified = classifyProofUploadError(error);
  return {
    kind: classified.kind,
    message: sanitizeDiagnosticValue(classified.userMessage),
  };
}

export function getCapturedDiagnostics() {
  return diagnostics.slice();
}

export function clearCapturedDiagnostics() {
  diagnostics.length = 0;
}

export function installGlobalRuntimeDiagnostics() {
  if (typeof window === 'undefined') return;
  if (installGlobalRuntimeDiagnostics.installed) return;
  installGlobalRuntimeDiagnostics.installed = true;

  window.addEventListener('error', (event) => {
    captureRuntimeDiagnostic({
      kind: 'window_error',
      stage: 'global',
      message: event.message,
      detail: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    captureRuntimeDiagnostic({
      kind: 'unhandled_rejection',
      stage: 'global',
      message: sanitizeDiagnosticValue(reason?.message || reason),
      detail: sanitizeDiagnosticValue(reason?.stack || ''),
    });
  });
}

installGlobalRuntimeDiagnostics.installed = false;
