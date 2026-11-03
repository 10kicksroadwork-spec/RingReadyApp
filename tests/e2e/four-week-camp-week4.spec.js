import { test, expect } from './fixtures.js';
import {
  goHome,
  navigateFromDrawer,
  saveAthleteProfile,
  waitForHome,
} from './helpers/app.js';

async function saveProfileWithCampLength(page, name, campLength) {
  await navigateFromDrawer(page, 'athlete-profile');
  await page.locator('#profile-athlete-name').fill(name);
  await page.locator('#profile-camp-length-select').selectOption(String(campLength));
  await page.locator('#save-athlete-profile-btn').click();
  await expect(page.locator('#header-athlete-name')).toContainText(name);
  await goHome(page);
}

async function goToWeek(page, weekIndex) {
  await waitForHome(page);
  const next = page.locator('#week-next-btn');
  for (let i = 0; i < weekIndex; i += 1) {
    await expect(next).toBeEnabled();
    await next.click();
  }
  await expect(page.locator('#current-week-label')).toContainText(`Week ${weekIndex + 1}`);
}

test.describe('four-week vs seven-week Week 4 schedule', () => {
  test('4-week Week 4 shows exactly Mon–Thu and no weekend Long Run', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveProfileWithCampLength(page, 'Four Week E2E', 4);

    await goToWeek(page, 3);
    const cards = page.locator('.week-workout-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0).locator('.week-card-day')).toHaveText('Monday');
    await expect(cards.nth(1).locator('.week-card-day')).toHaveText('Tuesday');
    await expect(cards.nth(2).locator('.week-card-day')).toHaveText('Wednesday');
    await expect(cards.nth(3).locator('.week-card-day')).toHaveText('Thursday');
    await expect(page.locator('.week-workout-card[data-workout-index="4"]')).toHaveCount(0);
    await expect(page.locator('.week-card-title', { hasText: 'Long Run + S&C' })).toHaveCount(0);

    consoleGate.assertClean();
  });

  test('7-week Week 4 still includes weekend Long Run + S&C', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Seven Week E2E');

    await goToWeek(page, 3);
    const cards = page.locator('.week-workout-card');
    await expect(cards).toHaveCount(5);
    const weekend = page.locator('.week-workout-card[data-week-index="3"][data-workout-index="4"]');
    await expect(weekend).toBeVisible();
    await expect(weekend.locator('.week-card-day')).toHaveText('Saturday or Sunday');
    await expect(weekend.locator('.week-card-title')).toHaveText('Long Run + S&C');

    consoleGate.assertClean();
  });
});
