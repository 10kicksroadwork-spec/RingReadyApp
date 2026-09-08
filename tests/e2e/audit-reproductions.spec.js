import { test, expect } from './fixtures.js';
import { waitForHome, openLogWorkout, fillWorkoutDuration, attachProof } from './helpers/app.js';

test('Back and reopen preserves unfinished metrics', async ({ localAthletePage: page }) => {
  await waitForHome(page);
  await openLogWorkout(page);
  await fillWorkoutDuration(page, '#detail-total-minutes-input', '23:15');
  await page.locator('#detail-avg-bpm-input').fill('150');
  await page.locator('#detail-max-bpm-input').fill('165');
  await page.locator('#detail-output-input').fill('3.2');
  await page.locator('#detail-back-btn').click();
  await openLogWorkout(page);
  await expect(page.locator('#detail-total-minutes-input')).toHaveValue('23:15');
  await expect(page.locator('#detail-avg-bpm-input')).toHaveValue('150');
});

test('reload before completion preserves selected proof and metrics', async ({ localAthletePage: page }) => {
  await waitForHome(page);
  await openLogWorkout(page);
  await fillWorkoutDuration(page, '#detail-total-minutes-input', '23:15');
  await attachProof(page, 'detail');
  await page.reload();
  await waitForHome(page);
  await openLogWorkout(page);
  await expect(page.locator('#detail-total-minutes-input')).toHaveValue('23:15');
  await expect(page.locator('[data-proof-host="detail"] .proof-preview')).toHaveCount(1);
});

test('saved assigned Mile Re-Test completes its week-plan task', async ({ localAthletePage: page }) => {
  await waitForHome(page);
  for (let i = 0; i < 5; i++) await page.locator('#week-next-btn').click();
  await openLogWorkout(page, 5, 3);
  await page.locator('#detail-action-btn').click();
  await page.locator('#mile-distance-input').fill('1');
  await fillWorkoutDuration(page, '#mile-time-input', '6:30');
  await page.locator('#mile-avg-bpm-input').fill('150');
  await page.locator('#mile-max-bpm-input').fill('165');
  await attachProof(page, 'mile');
  await page.locator('#save-mile-test-btn').click();
  await expect(page.locator('#mile-last-result')).toContainText('6:30');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ringReadyMileTestResult')));
  expect(saved.testKey).toBe('program:7:5:3');
  await page.locator('.screen.active [data-page-target="home"]').first().click();
  await expect(page.locator('.week-workout-card[data-week-index="5"][data-workout-index="3"]')).toHaveClass(/completed/);
});
