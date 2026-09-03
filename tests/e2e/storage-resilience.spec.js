import { test, expect } from './fixtures.js';
import {
  goHome,
  navigateFromDrawer,
  openSprintWorkout,
  waitForHome,
} from './helpers/app.js';

test.describe('storage SecurityError injection', () => {
  test.use({
    consoleGateOptions: {
      allowlist: [/Could not read storage/i, /Could not write storage/i],
    },
  });

  test('boots when localStorage getter throws SecurityError', async ({ page, consoleGate }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ringReadyOnboardingDismissed', '1');
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
    });

    await page.goto('/');
    await waitForHome(page);
    await expect(page.locator('#week-workouts')).toBeVisible();
    await expect(page.locator('#open-week-menu-btn')).toBeVisible();

    consoleGate.assertClean();
  });
});

test.describe('storage QuotaExceeded injection', () => {
  test.use({
    consoleGateOptions: {
      allowlist: [
        /Could not write storage/i,
        /Could not persist active sprint session/i,
      ],
    },
  });

  test('warns and allows degraded sprint start when persistent writes throw QuotaExceededError', async ({
    page,
    consoleGate,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ringReadyOnboardingDismissed', '1');
      const original = window.localStorage;
      const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');

      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          return new Proxy(original, {
            get(target, prop) {
              if (prop === 'setItem') {
                return () => {
                  throw quotaError;
                };
              }
              const value = Reflect.get(target, prop, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      });
    });

    await page.goto('/');
    await waitForHome(page);
    await navigateFromDrawer(page, 'athlete-profile');
    await page.locator('#profile-athlete-name').fill('Volatile Athlete');
    await page.locator('#save-athlete-profile-btn').click();
    await expect(page.locator('#header-athlete-name')).toContainText('Volatile Athlete');
    await goHome(page);
    await expect(page.locator('#week-workouts')).toBeVisible();

    await openSprintWorkout(page);

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toMatch(/SESSION RESUME STORAGE IS UNAVAILABLE/i);
      await dialog.dismiss();
    });
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#setup.screen.active')).toBeVisible();
    await expect(page.locator('#session')).not.toHaveClass(/active/);

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toMatch(/SESSION RESUME STORAGE IS UNAVAILABLE/i);
      await dialog.accept();
    });
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#main-btn')).toBeVisible();

    consoleGate.assertClean();
  });
});

test.describe('contract health injection', () => {
  test.describe('aborted health', () => {
    test.use({
      consoleGateOptions: {
        allowlist: [/Failed to load resource: net::ERR_FAILED/i, /Failed to load resource/i],
      },
    });

    test('keeps athlete UI usable when contract health is aborted', async ({ page, consoleGate }) => {
      await page.addInitScript(() => {
        localStorage.setItem('ringReadyOnboardingDismissed', '1');
      });

      await page.route('**/api/health', (route) => route.abort('failed'));
      await page.goto('/');
      await waitForHome(page);
      await expect(page.locator('#home .home-title')).toContainText('Ring Ready');

      consoleGate.assertClean();
    });
  });

  test('keeps athlete UI usable when contract health is delayed', async ({ page, consoleGate }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ringReadyOnboardingDismissed', '1');
    });

    await page.route('**/api/health', async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 3000);
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          service: 'ringready',
          buildSha: 'echo000',
          proofContractVersion: 2,
          environment: 'production',
        }),
      });
    });

    await page.goto('/');
    await waitForHome(page);
    await expect(page.locator('#week-workouts')).toBeVisible();

    consoleGate.assertClean();
  });
});
