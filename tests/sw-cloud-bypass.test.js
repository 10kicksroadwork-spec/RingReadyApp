import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const SW_SOURCE = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');
const APP_ORIGIN = 'https://ring-ready-app.vercel.app';

function createFetchHarness() {
  const listeners = new Map();
  const cacheMatch = vi.fn(async () => null);
  const cachePut = vi.fn(async () => undefined);
  const cacheOpen = vi.fn(async () => ({
    match: cacheMatch,
    put: cachePut,
    addAll: vi.fn(async () => undefined),
  }));
  const cachesKeys = vi.fn(async () => []);
  const cachesDelete = vi.fn(async () => true);

  const self = {
    location: { origin: APP_ORIGIN },
    addEventListener(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    clients: {
      matchAll: vi.fn(async () => []),
      claim: vi.fn(async () => undefined),
    },
    skipWaiting: vi.fn(async () => undefined),
  };

  const context = {
    self,
    caches: {
      open: cacheOpen,
      match: cacheMatch,
      keys: cachesKeys,
      delete: cachesDelete,
    },
    fetch: vi.fn(async () => new Response('network', { status: 200 })),
    URL,
    Response,
    Promise,
    console,
  };

  vm.runInNewContext(SW_SOURCE, context, { filename: 'public/sw.js' });

  function dispatchFetch(requestInit) {
    let request;
    if (requestInit instanceof Request) {
      request = requestInit;
    } else if (requestInit.mode === 'navigate') {
      // Node's Request may reject mode:"navigate"; SW only reads .url/.method/.mode.
      request = {
        url: requestInit.url,
        method: requestInit.method || 'GET',
        mode: 'navigate',
      };
    } else {
      request = new Request(requestInit.url, {
        method: requestInit.method || 'GET',
        mode: requestInit.mode || 'cors',
      });
    }
    const event = {
      request,
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    for (const handler of listeners.get('fetch') || []) {
      handler(event);
    }
    return event;
  }

  return {
    dispatchFetch,
    cacheMatch,
    cachePut,
    cacheOpen,
    fetch: context.fetch,
  };
}

describe('service worker cloud-data bypass', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares a same-origin guard before any respondWith path', () => {
    expect(SW_SOURCE).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
    const originGuardIndex = SW_SOURCE.indexOf('url.origin !== self.location.origin');
    const firstRespondWith = SW_SOURCE.indexOf('event.respondWith');
    expect(originGuardIndex).toBeGreaterThan(-1);
    expect(firstRespondWith).toBeGreaterThan(originGuardIndex);
  });

  it('does not intercept or cache cross-origin Supabase REST GETs', () => {
    const harness = createFetchHarness();
    const event = harness.dispatchFetch({
      url: 'https://example.supabase.co/rest/v1/workout_completions?select=*',
      method: 'GET',
    });

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(harness.cacheMatch).not.toHaveBeenCalled();
    expect(harness.cachePut).not.toHaveBeenCalled();
    expect(harness.cacheOpen).not.toHaveBeenCalled();
    expect(harness.fetch).not.toHaveBeenCalled();
  });

  it('does not intercept Supabase profile, auth, or storage GETs', () => {
    const harness = createFetchHarness();
    const urls = [
      'https://example.supabase.co/rest/v1/athlete_profiles?select=*',
      'https://example.supabase.co/auth/v1/user',
      'https://example.supabase.co/storage/v1/object/list/workout-proof-staging',
    ];

    for (const url of urls) {
      const event = harness.dispatchFetch({ url, method: 'GET' });
      expect(event.respondWith).not.toHaveBeenCalled();
    }

    expect(harness.cacheMatch).not.toHaveBeenCalled();
    expect(harness.cachePut).not.toHaveBeenCalled();
  });

  it('bypasses same-origin /api/* requests', () => {
    const harness = createFetchHarness();
    const event = harness.dispatchFetch({
      url: `${APP_ORIGIN}/api/health`,
      method: 'GET',
    });

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(harness.cacheMatch).not.toHaveBeenCalled();
    expect(harness.cachePut).not.toHaveBeenCalled();
  });

  it('uses network-first respondWith for same-origin navigations', () => {
    const harness = createFetchHarness();
    const event = harness.dispatchFetch({
      url: `${APP_ORIGIN}/`,
      method: 'GET',
      mode: 'navigate',
    });

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    expect(harness.fetch).toHaveBeenCalled();
  });

  it('uses network-first respondWith for same-origin JS/CSS assets', () => {
    const harness = createFetchHarness();
    const event = harness.dispatchFetch({
      url: `${APP_ORIGIN}/assets/index-abc123.js`,
      method: 'GET',
    });

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    expect(harness.fetch).toHaveBeenCalled();
  });

  it('allows cache-first respondWith for same-origin static shell assets', async () => {
    const harness = createFetchHarness();
    const event = harness.dispatchFetch({
      url: `${APP_ORIGIN}/icon-192.png`,
      method: 'GET',
    });

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    const handled = event.respondWith.mock.calls[0][0];
    await handled;
    expect(harness.cacheMatch).toHaveBeenCalled();
  });
});
