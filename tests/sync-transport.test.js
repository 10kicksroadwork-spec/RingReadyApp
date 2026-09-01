import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/auth.js', () => ({
  getCurrentUser: vi.fn(() => null),
  getAccessToken: vi.fn(async () => 'token'),
}));

describe('production sync transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, value) { this.store[key] = value; },
      removeItem(key) { delete this.store[key]; },
    });
    vi.doMock('../src/workout.js', () => ({}));
    vi.doMock('../src/hr-service.js', () => ({ hrState: { source: 'manual' } }));
    vi.doMock('../src/modality.js', () => ({
      MODALITY_RUNNING: 'running',
      normalizeModality: (value) => value || 'running',
      readOutputFromWorkoutLog: () => ({ modality: 'running', outputType: 'distance', outputValue: null }),
    }));
  });

  it('treats /api/sync as configured in production without VITE_RING_READY_SYNC_URL', async () => {
    vi.doMock('../src/auth.js', () => ({
      getCurrentUser: vi.fn(() => ({ id: 'user-a' })),
      getAccessToken: vi.fn(async () => 'token'),
    }));
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_RING_READY_SYNC_URL', '');

    const { isSyncTransportConfigured } = await import('../src/sync.js');
    expect(isSyncTransportConfigured()).toBe(true);
  });
});
