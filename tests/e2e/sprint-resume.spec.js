import { test, expect } from './fixtures.js';
import {
  openSprintWorkout,
  readActiveSessionCheckpoint,
  saveAthleteProfile,
  startSprintInterval,
  waitForActiveSessionCheckpoint,
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

    const checkpointBefore = await waitForActiveSessionCheckpoint(page);
    expect(checkpointBefore.state.phase).toBe('sprinting');
    expect(checkpointBefore.state.currentRep).toBe(1);
    expect(String(checkpointBefore.sessionId || '').trim()).toBeTruthy();

    await page.reload();

    await Promise.all([
      expect(page.locator('#session.screen.active')).toBeVisible({ timeout: 15000 }),
      expect(page.locator('#toast')).toContainText(/SESSION RESUMED/i, { timeout: 15000 }),
    ]);
    await expect(page.locator('#curr-interval')).toHaveText('1');

    const checkpointAfter = await readActiveSessionCheckpoint(page);
    expect(checkpointAfter?.sessionId).toBe(checkpointBefore.sessionId);
    expect(checkpointAfter?.state.currentRep).toBe(1);
    expect(checkpointAfter?.state.phase).toBe('sprinting');

    consoleGate.assertClean();
  });
});
