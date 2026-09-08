import { test, expect } from './fixtures.js';
import {
  attachProof,
  fillWorkoutDuration,
  goHome,
  openLogWorkout,
  saveAthleteProfile,
  waitForHome,
} from './helpers/app.js';

async function goToWeek(page, weekIndex) {
  await expect(page.locator('#home.screen.active')).toBeVisible();
  for (let i = 0; i < weekIndex; i += 1) {
    await page.locator('#week-next-btn').click();
  }
  await expect(
    page.locator(`.week-workout-card[data-week-index="${weekIndex}"]`).first(),
  ).toBeVisible();
}

test.describe('assigned mile result reopen lifecycle', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Assigned Mile Athlete');
  });

  test('save → VIEW MILE RESULT → edit/resave → clear → reload absent → recomplete', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    const weekIndex = 5;
    const workoutIndex = 3;

    await goToWeek(page, weekIndex);
    await openLogWorkout(page, weekIndex, workoutIndex);

    await expect(page.locator('#detail-action-btn')).toHaveText(/MILE/i);
    await expect(page.locator('#detail-action-btn')).toBeEnabled();
    await page.locator('#detail-action-btn').click();
    await expect(page.locator('#mile-test-page.screen.active')).toBeVisible();

    await page.locator('#mile-distance-input').fill('1');
    await fillWorkoutDuration(page, '#mile-time-input', '7:15');
    await page.locator('#mile-avg-bpm-input').fill('152');
    await page.locator('#mile-max-bpm-input').fill('171');
    await attachProof(page, 'mile');
    await expect(page.locator('#save-mile-test-btn')).toBeEnabled();
    await page.locator('#save-mile-test-btn').click();
    await expect(page.locator('#clear-mile-test-btn')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#mile-last-result')).toContainText(/7:15|Last saved/i);

    await goHome(page);
    await goToWeek(page, weekIndex);
    await openLogWorkout(page, weekIndex, workoutIndex);

    const viewBtn = page.locator('#detail-action-btn');
    await expect(viewBtn).toHaveText('VIEW MILE RESULT');
    await expect(viewBtn).toBeEnabled();
    await expect(viewBtn).toHaveAttribute('data-action', 'mile-test');
    await viewBtn.click();
    await expect(page.locator('#mile-test-page.screen.active')).toBeVisible();

    await expect(page.locator('#mile-distance-input')).toHaveValue('1');
    await expect(page.locator('#mile-time-input')).toHaveValue('7:15');
    await expect(page.locator('#mile-avg-bpm-input')).toHaveValue('152');
    await expect(page.locator('#mile-max-bpm-input')).toHaveValue('171');
    await expect(page.locator('#clear-mile-test-btn')).toBeVisible();

    await fillWorkoutDuration(page, '#mile-time-input', '7:05');
    await page.locator('#mile-avg-bpm-input').fill('154');
    await page.locator('#mile-max-bpm-input').fill('173');
    await page.locator('#save-mile-test-btn').click();
    await expect(page.locator('#mile-time-input')).toHaveValue('7:05', { timeout: 15000 });
    await expect(page.locator('#clear-mile-test-btn')).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#clear-mile-test-btn').click();
    await expect(page.locator('#clear-mile-test-btn')).toBeHidden({ timeout: 15000 });

    await page.reload();
    await waitForHome(page);
    await goToWeek(page, weekIndex);
    await openLogWorkout(page, weekIndex, workoutIndex);
    await expect(page.locator('#detail-action-btn')).not.toHaveText('VIEW MILE RESULT');
    await expect(page.locator('#detail-action-btn')).toBeEnabled();
    await page.locator('#detail-action-btn').click();
    await expect(page.locator('#mile-test-page.screen.active')).toBeVisible();
    await expect(page.locator('#mile-time-input')).toHaveValue('');
    await expect(page.locator('#clear-mile-test-btn')).toBeHidden();

    await page.locator('#mile-distance-input').fill('1');
    await fillWorkoutDuration(page, '#mile-time-input', '6:58');
    await page.locator('#mile-avg-bpm-input').fill('150');
    await page.locator('#mile-max-bpm-input').fill('168');
    await attachProof(page, 'mile');
    await page.locator('#save-mile-test-btn').click();
    await expect(page.locator('#clear-mile-test-btn')).toBeVisible({ timeout: 15000 });

    await goHome(page);
    await goToWeek(page, weekIndex);
    await openLogWorkout(page, weekIndex, workoutIndex);
    await expect(page.locator('#detail-action-btn')).toHaveText('VIEW MILE RESULT');
    await expect(page.locator('#detail-action-btn')).toBeEnabled();

    consoleGate.assertClean();
  });
});
