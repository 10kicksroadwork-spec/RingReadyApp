import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/build-info.js', () => ({
  APP_BUILD_SHA: 'abc1234',
  PROOF_CONTRACT_VERSION: 2,
  formatBuildLabel: () => 'abc1234',
}));

import {
  captureRuntimeDiagnostic,
  classifyRuntimeError,
  clearCapturedDiagnostics,
  getCapturedDiagnostics,
  getRuntimeContext,
  installGlobalRuntimeDiagnostics,
  sanitizeDiagnosticValue,
} from '../src/runtime-diagnostics.js';
import { createProofUploadError } from '../src/proof-diagnostics.js';

describe('runtime diagnostics', () => {
  beforeEach(() => {
    clearCapturedDiagnostics();
  });

  it('captures safe runtime context', () => {
    const context = getRuntimeContext({ screen: 'home-page' });
    expect(context.buildSha).toBe('abc1234');
    expect(context.proofContractVersion).toBe(2);
    expect(context.screen).toBe('home-page');
    expect(context.timestamp).toBeTruthy();
  });

  it('redacts bearer tokens and jwt-like values', () => {
    const sanitized = sanitizeDiagnosticValue(
      'Authorization Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def password=secret123',
    );

    expect(sanitized).not.toContain('eyJhbGci');
    expect(sanitized).not.toContain('secret123');
    expect(sanitized).toContain('[redacted]');
  });

  it('stores sanitized diagnostics in memory', () => {
    const record = captureRuntimeDiagnostic({
      kind: 'test_event',
      stage: 'unit',
      message: 'Bearer abc.def.ghi',
    });

    expect(record.kind).toBe('test_event');
    expect(record.message).not.toContain('Bearer abc');
    expect(getCapturedDiagnostics()).toHaveLength(1);
  });

  it('classifies proof upload errors through proof diagnostics', () => {
    const classified = classifyRuntimeError(
      createProofUploadError(new Error('permission denied for table workout_attachments')),
    );

    expect(classified.kind).toBe('proof_contract');
    expect(classified.message).toContain('out of sync');
  });

  it('installs global error handlers once', () => {
    installGlobalRuntimeDiagnostics.installed = false;
    const addSpy = vi.spyOn(window, 'addEventListener');
    installGlobalRuntimeDiagnostics();
    installGlobalRuntimeDiagnostics();

    const errorCalls = addSpy.mock.calls.filter(([type]) => type === 'error');
    const rejectionCalls = addSpy.mock.calls.filter(([type]) => type === 'unhandledrejection');
    expect(errorCalls).toHaveLength(1);
    expect(rejectionCalls).toHaveLength(1);

    addSpy.mockRestore();
  });

  it('records window error events', () => {
    installGlobalRuntimeDiagnostics();
    clearCapturedDiagnostics();
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'boom',
      filename: 'app.js',
      lineno: 10,
      colno: 4,
    }));

    expect(getCapturedDiagnostics()[0]).toMatchObject({
      kind: 'window_error',
      stage: 'global',
      message: 'boom',
    });
  });

  it('records unhandled promise rejections', () => {
    installGlobalRuntimeDiagnostics();
    clearCapturedDiagnostics();
    const event = new Event('unhandledrejection');
    event.reason = new Error('Bearer token leak');
    window.dispatchEvent(event);

    const record = getCapturedDiagnostics()[0];
    expect(record.kind).toBe('unhandled_rejection');
    expect(record.message).not.toContain('Bearer');
  });
});
