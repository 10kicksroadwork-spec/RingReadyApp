import { describe, expect, it, vi, beforeEach } from 'vitest';

const getUser = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser },
  }),
}));

import syncHandler from '../api/sync.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('sync relay handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
    process.env.RING_READY_SUPABASE_URL = 'https://example.supabase.co';
    process.env.RING_READY_SUPABASE_ANON_KEY = 'anon-key';
    process.env.RING_READY_APPS_SCRIPT_SYNC_URL = 'https://script.google.com/macros/s/test/exec';
    process.env.RING_READY_SYNC_RELAY_SECRET = 'relay-secret';
  });

  it('returns 503 when relay secret is missing', async () => {
    delete process.env.RING_READY_SYNC_RELAY_SECRET;
    const res = mockRes();
    await syncHandler({ method: 'POST', headers: {}, body: { eventType: 'profile_update' } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.ok).toBe(false);
  });

  it('returns 502 when upstream returns non-json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '<html>error</html>',
    })));

    const res = mockRes();
    await syncHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { eventType: 'profile_update', userId: 'forged-user' },
    }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Invalid response/);
  });

  it('returns 502 when upstream JSON ok is false', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: false, error: 'rejected' }),
    })));

    const res = mockRes();
    await syncHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { eventType: 'profile_update', userId: 'forged-user' },
    }, res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('rejected');
  });

  it('returns 200 only when upstream JSON ok is true', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const payload = JSON.parse(init.body);
      expect(payload.userId).toBe('user-a');
      expect(payload._relaySecret).toBe('relay-secret');
      expect(payload.athleteName).toBe("'=1+1");
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, eventType: 'profile_update' }),
      };
    }));

    const res = mockRes();
    await syncHandler({
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: {
        eventType: 'profile_update',
        userId: 'forged-user',
        athleteName: '=1+1',
      },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
