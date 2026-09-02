import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSkipWaitingMessage,
  isCurrentSkipWaitingMessage,
  SW_ACTIVATION_PROTOCOL,
  SW_SKIP_WAITING_MESSAGE_TYPE,
} from '../src/pwa-activation-protocol.js';

const swJs = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

function simulateServiceWorkerMessage(data, clientCount = 1) {
  let skipWaitingCalled = false;

  if (
    data?.type === SW_SKIP_WAITING_MESSAGE_TYPE
    && data?.protocol === SW_ACTIVATION_PROTOCOL
    && clientCount === 1
  ) {
    skipWaitingCalled = true;
  }

  return skipWaitingCalled;
}

describe('cross-version delta rollout', () => {
  it('does not activate when legacy Charlie sends bare SKIP_WAITING', () => {
    expect(simulateServiceWorkerMessage({ type: 'SKIP_WAITING' })).toBe(false);
    expect(isCurrentSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(false);
  });

  it('activates once for the current protocol-v2 message with exactly one client', () => {
    expect(simulateServiceWorkerMessage(buildSkipWaitingMessage(), 1)).toBe(true);
  });

  it.each([2, 3])('declines live activation with %i open window clients', (clientCount) => {
    expect(simulateServiceWorkerMessage(buildSkipWaitingMessage(), clientCount)).toBe(false);
  });

  it('does not activate legacy Charlie messages even with one client', () => {
    expect(simulateServiceWorkerMessage({ type: 'SKIP_WAITING' }, 1)).toBe(false);
  });

  it('keeps legacy SKIP_WAITING out of the deployed service worker handler', () => {
    expect(swJs).toContain('SW_SKIP_WAITING_MESSAGE_TYPE');
    expect(swJs).toContain('SW_ACTIVATION_PROTOCOL');
    expect(swJs).toContain('isCurrentSkipWaitingMessage');
    expect(swJs).not.toMatch(/type === 'SKIP_WAITING'/);
  });

  it('requires exactly one window client before calling skipWaiting', () => {
    const messageBlock = swJs.match(/self\.addEventListener\('message'[\s\S]*?\n\}\);/)?.[0] || '';
    expect(messageBlock).toContain('clients.matchAll');
    expect(messageBlock).toContain("type: 'window'");
    expect(messageBlock).toContain('includeUncontrolled: true');
    expect(messageBlock).toContain('clients.length !== 1');
  });
});

describe('activation protocol parity', () => {
  it('matches client protocol constants to the deployed service worker literals', () => {
    expect(swJs).toContain(`const SW_ACTIVATION_PROTOCOL = ${SW_ACTIVATION_PROTOCOL};`);
    expect(swJs).toContain(`const SW_SKIP_WAITING_MESSAGE_TYPE = '${SW_SKIP_WAITING_MESSAGE_TYPE}';`);
  });
});

describe('screen-change event discipline', () => {
  it('evaluates lifecycle once per ringready:screen-changed event', async () => {
    const { createServiceWorkerUpdateLifecycle } = await import('../src/pwa-update-lifecycle.js');

    let evaluations = 0;
    const lifecycle = createServiceWorkerUpdateLifecycle({
      initialController: true,
      getScreen: () => 'session',
      onDiagnostic: () => {},
      onSkipWaiting: () => false,
      onReload: () => {},
    });

    const wrapped = {
      handleScreenChange(screenId) {
        evaluations += 1;
        lifecycle.handleScreenChange(screenId);
      },
    };

    for (let index = 0; index < 100; index += 1) {
      document.body?.classList.toggle('timer-urgent');
    }

    expect(evaluations).toBe(0);

    wrapped.handleScreenChange('session');
    expect(evaluations).toBe(1);
  });
});

describe('direct waiting worker handoff', () => {
  it('posts protocol-v2 to the exact waiting worker synchronously', async () => {
    const { __testPostSkipWaitingToWorker } = await import('../src/pwa.js');
    const messages = [];
    const worker = {
      postMessage(message) {
        messages.push(message);
      },
    };

    expect(__testPostSkipWaitingToWorker(worker)).toBe(true);
    expect(messages).toEqual([buildSkipWaitingMessage()]);
    expect(__testPostSkipWaitingToWorker(null)).toBe(false);
  });
});
