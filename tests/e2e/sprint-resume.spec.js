import { test, expect } from './fixtures.js';
import {
  openSprintWorkout,
  saveAthleteProfile,
  startSprintInterval,
  waitForHome,
} from './helpers/app.js';

test.describe('sprint checkpoint resume', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Sprint Athlete');
  });

  test('returns home from sprint setup', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;
    await openSprintWorkout(page);
    await page.locator('#setup-back-btn').click();
    await expect(page.locator('#home.screen.active')).toBeVisible();
    consoleGate.assertClean();
  });

  test('creates a checkpoint and resumes the same session after reload', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible();

    await startSprintInterval(page);

    await page.waitForFunction(() => (
      Object.keys(localStorage).some((key) => key.startsWith('ringReadyActiveSession:'))
    ));

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    if (!(await page.locator('#session.screen.active').isVisible())) {
      await waitForHome(page);
      await openSprintWorkout(page);
      page.on('dialog', (dialog) => dialog.accept());
      await page.locator('#start-session-btn').click();
    }

    await expect(page.locator('#session.screen.active')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#curr-interval')).toHaveText('1');

    consoleGate.assertClean();
  });
});
