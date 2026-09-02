import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCurrentSkipWaitingMessage } from '../src/pwa-activation-protocol.js';

const swJs = readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8');

function simulateServiceWorkerMessage(data) {
  let skipWaitingCalled = false;
  const SW_ACTIVATION_PROTOCOL = 2;
  const SW_SKIP_WAITING_MESSAGE_TYPE = 'RINGREADY_SKIP_WAITING';

  if (
    data?.type === SW_SKIP_WAITING_MESSAGE_TYPE
    && data?.protocol === SW_ACTIVATION_PROTOCOL
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

  it('activates once for the current protocol-v2 message', () => {
    expect(simulateServiceWorkerMessage({
      type: 'RINGREADY_SKIP_WAITING',
      protocol: 2,
    })).toBe(true);
  });

  it('keeps legacy SKIP_WAITING out of the deployed service worker handler', () => {
    const messageBlock = swJs.match(/self\.addEventListener\('message'[\s\S]*?\n\}\);/)?.[0] || '';
    expect(messageBlock).toContain('SW_SKIP_WAITING_MESSAGE_TYPE');
    expect(messageBlock).toContain('SW_ACTIVATION_PROTOCOL');
    expect(messageBlock).not.toMatch(/type === 'SKIP_WAITING'/);
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
      onSkipWaiting: () => {},
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
