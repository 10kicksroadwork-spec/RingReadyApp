import { test, expect } from './fixtures.js';
import {
  enterRestAfterManualSprintHr,
  finishSprintIntervalWithHold,
  openSprintWorkout,
  readRestSeconds,
  saveAthleteProfile,
  setDocumentVisibility,
  startSprintInterval,
  waitForHome,
} from './helpers/app.js';

test.describe('webkit sprint rest background reconciliation', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    await waitForHome(localAthletePage);
    await saveAthleteProfile(localAthletePage, 'Rest Lifecycle Athlete');
  });

  test('reconciles rest elapsed time after hide and foreground', async ({
    localAthletePage,
    consoleGate,
  }) => {
    test.setTimeout(90000);
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible();

    await startSprintInterval(page);
    await finishSprintIntervalWithHold(page);
    await enterRestAfterManualSprintHr(page, '172');

    const remainingBefore = await readRestSeconds(page);
    expect(remainingBefore).toBeGreaterThan(45);

    await setDocumentVisibility(page, false);
    // Real wall-clock advance while hidden; resume uses Date.now() - startedAt.
    await page.waitForTimeout(12000);
    await setDocumentVisibility(page, true);

    await expect(page.locator('#status-pill')).toContainText('REST');
    await expect
      .poll(async () => readRestSeconds(page), { timeout: 5000 })
      .toBeLessThanOrEqual(remainingBefore - 10);

    const remainingAfter = await readRestSeconds(page);
    expect(remainingAfter).toBeGreaterThan(0);
    expect(remainingBefore - remainingAfter).toBeGreaterThanOrEqual(10);

    consoleGate.assertClean();
  });
});
