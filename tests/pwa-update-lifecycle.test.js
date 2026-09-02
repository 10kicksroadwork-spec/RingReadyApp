import { describe, expect, it } from 'vitest';
import {
  canActivateOnScreen,
  createServiceWorkerUpdateLifecycle,
  isProtectedScreen,
  PROTECTED_SCREENS,
} from '../src/pwa-update-lifecycle.js';

function createHarness(screenId = 'home') {
  const diagnostics = [];
  let skipWaitingCount = 0;
  let reloadCount = 0;

  const lifecycle = createServiceWorkerUpdateLifecycle({
    initialController: true,
    getScreen: () => screenId,
    onDiagnostic: (entry) => diagnostics.push(entry),
    onSkipWaiting: () => { skipWaitingCount += 1; },
    onReload: () => { reloadCount += 1; },
  });

  return {
    lifecycle,
    diagnostics,
    get skipWaitingCount() { return skipWaitingCount; },
    get reloadCount() { return reloadCount; },
    setScreen(nextScreen) {
      screenId = nextScreen;
    },
  };
}

describe('pwa update lifecycle', () => {
  it('marks session/results/setup as protected screens', () => {
    expect([...PROTECTED_SCREENS]).toEqual(['session', 'results', 'setup']);
    expect(isProtectedScreen('session')).toBe(true);
    expect(isProtectedScreen('home')).toBe(false);
    expect(canActivateOnScreen('setup')).toBe(false);
  });

  it('activates once on a safe screen when a waiting worker is found at startup', () => {
    const harness = createHarness('home');
    harness.lifecycle.handleInitialWaiting('home');

    expect(harness.skipWaitingCount).toBe(1);
    expect(harness.lifecycle.getPhase()).toBe('ACTIVATION_REQUESTED');
  });

  it('defers activation when a waiting worker is found on an unsafe screen at startup', () => {
    const harness = createHarness('session');
    harness.lifecycle.handleInitialWaiting('session');

    expect(harness.skipWaitingCount).toBe(0);
    expect(harness.diagnostics.some((entry) => entry.kind === 'sw_activation_deferred')).toBe(true);
  });

  it('activates once after leaving a protected screen', () => {
    const harness = createHarness('session');
    harness.lifecycle.handleInstallingInstalled('session');
    expect(harness.skipWaitingCount).toBe(0);

    harness.setScreen('home');
    harness.lifecycle.handleScreenChange('home');

    expect(harness.skipWaitingCount).toBe(1);
  });

  it('does not activate during session/results/setup updates', () => {
    for (const screenId of ['session', 'results', 'setup']) {
      const harness = createHarness(screenId);
      harness.lifecycle.handleUpdateFound();
      harness.lifecycle.handleInstallingInstalled(screenId);
      harness.lifecycle.handleScreenChange(screenId);
      expect(harness.skipWaitingCount).toBe(0);
    }
  });

  it('reloads once after controllerchange on a safe screen', () => {
    const harness = createHarness('home');
    harness.lifecycle.handleInitialWaiting('home');
    harness.lifecycle.handleControllerChange('home');

    expect(harness.reloadCount).toBe(1);
    expect(harness.lifecycle.getPhase()).toBe('RELOADING');
  });

  it('defers reload while results/setup remain active', () => {
    for (const screenId of ['results', 'setup']) {
      const harness = createHarness(screenId);
      harness.lifecycle.handleInstallingInstalled(screenId);
      harness.lifecycle.handleControllerChange(screenId);
      expect(harness.reloadCount).toBe(0);
    }
  });

  it('does not reload on first-ever service worker install', () => {
    const diagnostics = [];
    let reloadCount = 0;

    const lifecycle = createServiceWorkerUpdateLifecycle({
      initialController: false,
      getScreen: () => 'home',
      onDiagnostic: (entry) => diagnostics.push(entry),
      onSkipWaiting: () => {},
      onReload: () => { reloadCount += 1; },
    });

    lifecycle.handleControllerChange('home');

    expect(reloadCount).toBe(0);
    expect(diagnostics.some((entry) => entry.kind === 'sw_reload_requested')).toBe(false);
  });

  it('activates an existing waiting worker once the athlete reaches home', () => {
    const harness = createHarness('session');
    harness.lifecycle.handleInitialWaiting('session');
    harness.setScreen('home');
    harness.lifecycle.handleScreenChange('home');

    expect(harness.skipWaitingCount).toBe(1);
  });

  it('ignores duplicate controllerchange reload requests', () => {
    const harness = createHarness('home');
    harness.lifecycle.handleControllerChange('home');
    harness.lifecycle.handleControllerChange('home');

    expect(harness.reloadCount).toBe(1);
  });

  it('requests activation at most once across repeated update signals', () => {
    const harness = createHarness('home');
    harness.lifecycle.handleUpdateFound();
    harness.lifecycle.handleInstallingInstalled('home');
    harness.lifecycle.handleInstallingInstalled('home');
    harness.lifecycle.handleInitialWaiting('home');

    expect(harness.skipWaitingCount).toBe(1);
  });
});

describe('pwa update lifecycle on home screen', () => {
  it('requests skip waiting once then reloads once for a home-screen update', () => {
    const harness = createHarness('home');
    harness.lifecycle.handleUpdateFound();
    harness.lifecycle.handleInstallingInstalled('home');
    harness.lifecycle.handleControllerChange('home');

    expect(harness.skipWaitingCount).toBe(1);
    expect(harness.reloadCount).toBe(1);
  });
});

describe('pwa install copy', () => {
  it('exposes actionable iOS install guidance instead of a disabled ready state', async () => {
    const { getInstallCopy } = await import('../src/pwa.js');

    const copy = getInstallCopy({
      standalone: false,
      hasDeferredPrompt: false,
      isIOS: true,
    });

    expect(copy.title).toBe('ADD TO HOME SCREEN');
    expect(copy.button).toBe('HOW TO INSTALL');
    expect(copy.actionable).toBe(true);
  });
});
