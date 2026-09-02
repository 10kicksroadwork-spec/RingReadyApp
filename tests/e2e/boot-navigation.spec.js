import { test, expect } from './fixtures.js';
import {
  goHome,
  navigateFromDrawer,
  waitForHome,
} from './helpers/app.js';

test.describe('boot and navigation', () => {
  test('loads home and navigates core athlete screens', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;
    await waitForHome(page);

    await page.locator('[data-page-target="welcome-page"]').first().click();
    await expect(page.locator('#welcome-page.screen.active')).toBeVisible();

    await goHome(page);
    await navigateFromDrawer(page, 'athlete-profile');
    await goHome(page);
    await navigateFromDrawer(page, 'hr-info');
    await goHome(page);
    await navigateFromDrawer(page, 'mile-test-page');
    await goHome(page);

    consoleGate.assertClean();
  });
});
