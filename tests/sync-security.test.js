import { describe, expect, it, vi } from 'vitest';

describe('production sync endpoint lockdown', () => {
  it('rejects non-Apps-Script sync URLs in development', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, value) { this.store[key] = value; },
      removeItem(key) { delete this.store[key]; },
    });
    vi.doMock('../src/auth.js', () => ({ getCurrentUser: () => null }));
    vi.doMock('../src/workout.js', () => ({}));
    vi.doMock('../src/hr-service.js', () => ({ hrState: { source: 'manual' } }));
    vi.doMock('../src/modality.js', () => ({ MODALITY_RUNNING: 'running', normalizeModality: (v) => v || 'running' }));

    const { applySyncEndpointFromURL, getSyncEndpoint } = await import('../src/sync.js');

    vi.stubGlobal('window', {
      location: { href: 'https://app.test/?syncUrl=https%3A%2F%2Fevil.example%2Fsteal' },
      history: { replaceState: vi.fn() },
    });

    applySyncEndpointFromURL();
    expect(localStorage.store.ringReadySyncEndpoint).toBeUndefined();
    expect(getSyncEndpoint()).toBe('');
  });

  it('accepts Google Apps Script /exec URLs in development', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, value) { this.store[key] = value; },
      removeItem(key) { delete this.store[key]; },
    });
    vi.doMock('../src/auth.js', () => ({ getCurrentUser: () => null }));
    vi.doMock('../src/workout.js', () => ({}));
    vi.doMock('../src/hr-service.js', () => ({ hrState: { source: 'manual' } }));
    vi.doMock('../src/modality.js', () => ({ MODALITY_RUNNING: 'running', normalizeModality: (v) => v || 'running' }));

    const execUrl = 'https://script.google.com/macros/s/abc123/exec';
    const { applySyncEndpointFromURL, getSyncEndpoint } = await import('../src/sync.js');

    vi.stubGlobal('window', {
      location: { href: `https://app.test/?syncUrl=${encodeURIComponent(execUrl)}` },
      history: { replaceState: vi.fn() },
    });

    applySyncEndpointFromURL();
    expect(getSyncEndpoint()).toBe(execUrl);
  });
});
