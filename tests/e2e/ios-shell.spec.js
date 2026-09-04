import { test, expect } from './fixtures.js';
import {
  assertNoHorizontalOverflow,
  attachProof,
  closeDrawer,
  navigateFromDrawer,
  openLogWorkout,
  saveAthleteProfile,
  waitForHome,
} from './helpers/app.js';

test.describe('webkit iPhone shell', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    await waitForHome(localAthletePage);
    await saveAthleteProfile(localAthletePage, 'WebKit Athlete');
  });

  test('keeps core surfaces usable without horizontal overflow', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;

    await assertNoHorizontalOverflow(page);

    await page.locator('#open-week-menu-btn').click();
    await expect(page.locator('#week-drawer')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await closeDrawer(page);

    await openLogWorkout(page, 0, 1);
    await page.locator('#detail-total-minutes-input').fill('20:00');
    await page.locator('#detail-avg-bpm-input').fill('145');
    await page.locator('#detail-max-bpm-input').fill('160');
    await page.locator('#detail-output-input').fill('3');
    await assertNoHorizontalOverflow(page);

    await navigateFromDrawer(page, 'mile-test-page');
    await page.locator('#mile-time-input').fill('6:45');
    await expect(page.locator('#mile-time-input')).toHaveValue('6:45');

    consoleGate.assertClean();
  });

  test('positions workout HOME below injected safe-top', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;
    await page.addStyleTag({
      content: ':root { --safe-top: 47px !important; --safe-right: 12px !important; }',
    });
    await openLogWorkout(page, 0, 1);

    const metrics = await page.locator('#detail-back-btn').evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        top: style.top,
        right: style.right,
        y: el.getBoundingClientRect().top,
      };
    });

    expect(metrics.top).toBe('55px');
    expect(metrics.right).toBe('24px');
    expect(metrics.y).toBeGreaterThanOrEqual(47);

    consoleGate.assertClean();
  });

  test('accepts proof png selection and shows install instructions on welcome', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openLogWorkout(page, 0, 1);
    await attachProof(page, 'detail');

    await navigateFromDrawer(page, 'welcome-page');
    await expect(page.locator('#install-panel')).toBeVisible();
    await expect(page.locator('#install-btn')).toBeVisible();
    await expect(page.locator('#install-btn')).toContainText(/HOW TO INSTALL/i);
    await page.locator('#install-btn').click();
    await expect(page.locator('#install-instructions')).toBeVisible();

    consoleGate.assertClean();
  });
});
