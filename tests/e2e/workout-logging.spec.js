import { test, expect } from './fixtures.js';
import {
  attachProof,
  fillWorkoutDuration,
  navigateFromDrawer,
  openLogWorkout,
  saveAthleteProfile,
  waitForHome,
} from './helpers/app.js';

test.describe('mile test logging', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Mile Athlete');
  });

  test('saves mile test results and keeps them after reload', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;

    await navigateFromDrawer(page, 'mile-test-page');
    await page.locator('#mile-distance-input').fill('1');
    await fillWorkoutDuration(page, '#mile-time-input', '6:30');
    await page.locator('#mile-avg-bpm-input').fill('150');
    await page.locator('#mile-max-bpm-input').fill('165');
    await attachProof(page, 'mile');

    await expect(page.locator('#save-mile-test-btn')).toBeEnabled();
    await page.locator('#save-mile-test-btn').click();

    await page.reload();
    await waitForHome(page);
    await navigateFromDrawer(page, 'mile-test-page');

    await expect(page.locator('#mile-distance-input')).toHaveValue('1');
    await expect(page.locator('#mile-time-input')).toHaveValue('6:30');
    await expect(page.locator('#mile-avg-bpm-input')).toHaveValue('150');
    await expect(page.locator('#mile-max-bpm-input')).toHaveValue('165');

    consoleGate.assertClean();
  });
});

test.describe('normal workout logging', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Workout Athlete');
  });

  async function completeLogWorkout(page, {
    weekIndex,
    workoutIndex,
    modality,
    outputValue,
    outputLabelPattern,
  }) {
    await openLogWorkout(page, weekIndex, workoutIndex);

    if (modality) {
      await page.locator(`[data-detail-modality="${modality}"]`).click();
      await expect(page.locator('#detail-output-label')).toContainText(outputLabelPattern);
    }

    await fillWorkoutDuration(page, '#detail-total-minutes-input', '23:15');
    await page.locator('#detail-avg-bpm-input').fill('150');
    await page.locator('#detail-max-bpm-input').fill('165');
    await page.locator('#detail-output-input').fill(outputValue);
    await attachProof(page, 'detail');

    await expect(page.locator('#detail-action-btn')).toBeEnabled();
    await page.locator('#detail-action-btn').click();
    await expect(page.locator('#toast')).toContainText('WORKOUT COMPLETE', { timeout: 15000 });
    await expect(page.locator('#detail-action-btn')).toHaveText('SAVE CHANGES', { timeout: 15000 });
  }

  test('completes a running workout with distance and persists after reload', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await completeLogWorkout(page, {
      weekIndex: 0,
      workoutIndex: 1,
      modality: 'running',
      outputValue: '3.5',
      outputLabelPattern: /Distance/i,
    });

    await page.reload();
    await waitForHome(page);
    await openLogWorkout(page, 0, 1);

    await expect(page.locator('#detail-output-input')).toHaveValue('3.5');
    await expect(page.locator('#detail-action-btn')).toHaveText('SAVE CHANGES');

    consoleGate.assertClean();
  });

  test('completes an assault bike workout with average watts', async ({ localAthletePage, consoleGate }) => {
    const page = localAthletePage;

    await completeLogWorkout(page, {
      weekIndex: 0,
      workoutIndex: 1,
      modality: 'assault_bike',
      outputValue: '280',
      outputLabelPattern: /Watts/i,
    });

    await expect(page.locator('#detail-output-input')).toHaveValue('280');

    consoleGate.assertClean();
  });
});
