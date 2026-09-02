import { describe, expect, it } from 'vitest';
import {
  buildSkipWaitingMessage,
  isCurrentSkipWaitingMessage,
  SW_ACTIVATION_PROTOCOL,
  SW_SKIP_WAITING_MESSAGE_TYPE,
} from '../src/pwa-activation-protocol.js';
import {
  canActivateOnScreen,
  createServiceWorkerUpdateLifecycle,
  isSafeActivationScreen,
  SAFE_ACTIVATION_SCREENS,
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

describe('pwa activation protocol', () => {
  it('builds the current protocol-v2 skip-waiting message', () => {
    expect(buildSkipWaitingMessage()).toEqual({
      type: SW_SKIP_WAITING_MESSAGE_TYPE,
      protocol: SW_ACTIVATION_PROTOCOL,
    });
  });

  it('accepts only the current protocol-v2 message', () => {
    expect(isCurrentSkipWaitingMessage(buildSkipWaitingMessage())).toBe(true);
    expect(isCurrentSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(false);
    expect(isCurrentSkipWaitingMessage({
      type: SW_SKIP_WAITING_MESSAGE_TYPE,
      protocol: 1,
    })).toBe(false);
  });
});

describe('pwa update lifecycle safe-screen allowlist', () => {
  it('allows activation only on home and welcome-page', () => {
    expect([...SAFE_ACTIVATION_SCREENS]).toEqual(['home', 'welcome-page']);
    expect(isSafeActivationScreen('home')).toBe(true);
    expect(isSafeActivationScreen('welcome-page')).toBe(true);
    expect(canActivateOnScreen('session')).toBe(false);
    expect(canActivateOnScreen('')).toBe(false);
  });

  it.each([
    'session',
    'results',
    'setup',
    'workout-detail',
    'mile-test-page',
    'athlete-profile',
    'hr-info',
    'auth',
    '',
  ])('does not activate on unsafe screen %s', (screenId) => {
    const harness = createHarness(screenId);
    harness.lifecycle.handleInstallingInstalled(screenId);
    harness.lifecycle.handleScreenChange(screenId);
    expect(harness.skipWaitingCount).toBe(0);
  });

  it.each(['home', 'welcome-page'])('activates on safe screen %s', (screenId) => {
    const harness = createHarness(screenId);
    harness.lifecycle.handleInstallingInstalled(screenId);
    expect(harness.skipWaitingCount).toBe(1);
  });

  it('activates once after leaving workout-detail for home', () => {
    const harness = createHarness('workout-detail');
    harness.lifecycle.handleInstallingInstalled('workout-detail');
    expect(harness.skipWaitingCount).toBe(0);

    harness.setScreen('home');
    harness.lifecycle.handleScreenChange('home');

    expect(harness.skipWaitingCount).toBe(1);
  });

  it('defers reload while workout-detail remains active', () => {
    const harness = createHarness('workout-detail');
    harness.lifecycle.handleInstallingInstalled('workout-detail');
    harness.lifecycle.handleControllerChange('workout-detail');
    expect(harness.reloadCount).toBe(0);
  });

  it('records activation deferred at most once while staying on an unsafe screen', () => {
    const harness = createHarness('session');
    harness.lifecycle.handleInstallingInstalled('session');
    harness.lifecycle.handleScreenChange('session');
    harness.lifecycle.handleScreenChange('session');

    const deferredCount = harness.diagnostics.filter(
      (entry) => entry.kind === 'sw_activation_deferred',
    ).length;
    expect(deferredCount).toBe(1);
  });
});

describe('pwa update lifecycle', () => {
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

  it('reloads once after controllerchange on a safe screen', () => {
    const harness = createHarness('home');
    harness.lifecycle.handleInitialWaiting('home');
    harness.lifecycle.handleControllerChange('home');

    expect(harness.reloadCount).toBe(1);
    expect(harness.lifecycle.getPhase()).toBe('RELOADING');
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
