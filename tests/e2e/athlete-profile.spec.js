import { test, expect } from './fixtures.js';
import { goHome, navigateFromDrawer, waitForHome } from './helpers/app.js';

test.describe('athlete profile persistence', () => {
  test('saves profile fields and keeps them after reload', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;
    await waitForHome(page);

    await navigateFromDrawer(page, 'athlete-profile');
    await page.locator('#profile-athlete-name').fill('Echo Profile');
    await page.locator('#profile-age-input').fill('28');
    await page.locator('#profile-gender-select').selectOption('Female');
    await page.locator('#save-athlete-profile-btn').click();
    await expect(page.locator('#header-athlete-name')).toContainText('Echo Profile');

    await page.reload();
    await waitForHome(page);
    await navigateFromDrawer(page, 'athlete-profile');

    await expect(page.locator('#profile-athlete-name')).toHaveValue('Echo Profile');
    await expect(page.locator('#profile-age-input')).toHaveValue('28');
    await expect(page.locator('#profile-gender-select')).toHaveValue('Female');

    consoleGate.assertClean();
  });

  test('requires a saved profile name before sprint setup', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;
    await waitForHome(page);

    await page.locator('.week-workout-card[data-week-index="0"][data-workout-index="0"]').click();
    await page.locator('#detail-action-btn').click();
    await page.locator('#start-session-btn').click();

    await expect(page.locator('#athlete-profile.screen.active')).toBeVisible();
    await page.locator('#profile-athlete-name').fill('Sprint Ready');
    await page.locator('#save-athlete-profile-btn').click();
    await goHome(page);

    consoleGate.assertClean();
  });
});
