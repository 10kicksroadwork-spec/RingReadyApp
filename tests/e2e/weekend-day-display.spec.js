import { test, expect } from './fixtures.js';
import {
  attachProof,
  fillWorkoutDuration,
  navigateFromDrawer,
  openLogWorkout,
  saveAthleteProfile,
  waitForHome,
} from './helpers/app.js';

test.describe('weekend day display copy', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Weekend Copy Athlete');
  });

  test('shows Saturday or Sunday on week card, detail, and next-up while storing canonical day', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    const weekendCard = page.locator(
      '.week-workout-card[data-week-index="0"][data-workout-index="4"]',
    );

    await expect(weekendCard.locator('.week-card-day')).toHaveText('Saturday or Sunday');
    await expect(weekendCard.locator('.week-card-day')).not.toHaveText('Saturday/Sunday');
    await expect(weekendCard.locator('.week-card-title')).toHaveText('Long Run + S&C');

    await page.evaluate(() => {
      const now = new Date().toISOString();
      const completions = {};
      for (let workoutIndex = 0; workoutIndex < 4; workoutIndex += 1) {
        const key = `0:${workoutIndex}`;
        completions[key] = {
          id: `seed-${workoutIndex}`,
          completionKey: key,
          status: 'completed',
          type: 'daily-workout-completion',
          date: now,
          completedAt: now,
          workoutContext: {
            weekIndex: 0,
            workoutIndex,
            dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'][workoutIndex],
            workoutType: 'Seeded',
          },
          cfg: {
            workoutContext: {
              weekIndex: 0,
              workoutIndex,
            },
          },
          workoutLog: {
            totalMinutes: 20,
            avgBpm: 140,
            maxBpm: 150,
            completedAt: now,
          },
        };
      }
      localStorage.setItem('ringReadyWorkoutCompletions', JSON.stringify(completions));
    });
    await page.reload();
    await waitForHome(page);

    await navigateFromDrawer(page, 'athlete-profile');
    const nextUp = page.locator('#profile-dashboard .dash-detail-card').filter({ hasText: 'Next Up' });
    await expect(nextUp).toContainText('Week 1 / Saturday or Sunday / Long Run + S&C');
    await expect(nextUp).not.toContainText('Saturday/Sunday');
    await page.locator('.screen.active [data-page-target="home"]').first().click();
    await waitForHome(page);

    await openLogWorkout(page, 0, 4);
    await expect(page.locator('#detail-week')).toHaveText('Week 1 / Saturday or Sunday');
    await expect(page.locator('#detail-week')).not.toContainText('Saturday/Sunday');

    await fillWorkoutDuration(page, '#detail-total-minutes-input', '45:00');
    await page.locator('#detail-avg-bpm-input').fill('140');
    await page.locator('#detail-max-bpm-input').fill('155');
    await page.locator('#detail-output-input').fill('5.0');
    await attachProof(page, 'detail');
    await expect(page.locator('#detail-action-btn')).toBeEnabled();
    await page.locator('#detail-action-btn').click();
    await expect(page.locator('#toast')).toContainText('WORKOUT COMPLETE', { timeout: 15000 });

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('ringReadyWorkoutCompletions');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed['0:4'] || null;
    });

    expect(stored).toBeTruthy();
    const dayOfWeek = stored.workoutContext?.dayOfWeek || stored.cfg?.workoutContext?.dayOfWeek;
    expect(dayOfWeek).toBe('Saturday/Sunday');
    expect(dayOfWeek).not.toBe('Saturday or Sunday');

    await page.locator('#detail-back-btn').click();
    await waitForHome(page);
    await expect(weekendCard).toHaveClass(/completed/);
    await expect(weekendCard.locator('.week-card-day')).toHaveText('Saturday or Sunday');
    await expect(weekendCard.locator('.workout-tag')).toHaveText('Done');

    consoleGate.assertClean();
  });
});
