import { test, expect } from './fixtures.js';
import {
  enterRestAfterManualSprintHr,
  finishSprintIntervalWithHold,
  installScreenTrace,
  openSprintWorkout,
  readActiveSessionCheckpoint,
  readScreenTrace,
  saveAthleteProfile,
  seedLocalActiveSessionCheckpoint,
  setDocumentVisibility,
  startScreenTrace,
  startSprintInterval,
  waitForActiveSessionCheckpoint,
  waitForHome,
} from './helpers/app.js';

function expectNoProgramShellDuringResume(screenTrace) {
  expect(screenTrace).not.toContain('home');
  expect(screenTrace).not.toContain('workout-detail');
  expect(screenTrace).not.toContain('setup');
}

async function expectSessionOwnsNavigationAfterReload(page, {
  expectedPhase,
  expectedRep = 1,
}) {
  const checkpointBefore = await waitForActiveSessionCheckpoint(page);
  expect(checkpointBefore.state.phase).toBe(expectedPhase);
  expect(checkpointBefore.state.currentRep).toBe(expectedRep);
  expect(String(checkpointBefore.sessionId || '').trim()).toBeTruthy();

  await installScreenTrace(page);
  await page.reload();

  await expect(page.locator('#session.screen.active')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('#toast')).toContainText(/SESSION RESUMED/i, {
    timeout: 15000,
  });
  await expect(page.locator('#curr-interval')).toHaveText(String(expectedRep));

  expectNoProgramShellDuringResume(await readScreenTrace(page));

  const checkpointAfter = await readActiveSessionCheckpoint(page);
  expect(checkpointAfter?.sessionId).toBe(checkpointBefore.sessionId);
  expect(checkpointAfter?.state.currentRep).toBe(expectedRep);
  expect(checkpointAfter?.state.phase).toBe(expectedPhase);
  return { checkpointBefore, checkpointAfter };
}

test.describe('sprint checkpoint resume', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    const page = localAthletePage;
    await waitForHome(page);
    await saveAthleteProfile(page, 'Sprint Athlete');
  });

  test('returns home from sprint setup', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#setup-back-btn').click();

    await expect(page.locator('#home.screen.active')).toBeVisible();

    consoleGate.assertClean();
  });

  test('active Sprint owns navigation immediately after reload', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible();

    await startSprintInterval(page);

    await expectSessionOwnsNavigationAfterReload(page, {
      expectedPhase: 'sprinting',
      expectedRep: 1,
    });

    consoleGate.assertClean();
  });

  test('manual Sprint HR owns navigation immediately after reload', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible();

    await startSprintInterval(page);
    await finishSprintIntervalWithHold(page);
    await expect(page.locator('#hr-modal.open')).toBeVisible();
    await expect(page.locator('#modal-sprint-hr')).toBeEnabled();

    await expectSessionOwnsNavigationAfterReload(page, {
      expectedPhase: 'manual-entry',
      expectedRep: 1,
    });

    await expect(page.locator('#hr-modal.open')).toBeVisible();
    await expect(page.locator('#modal-sprint-hr')).toBeEnabled();

    consoleGate.assertClean();
  });

  test('rest countdown owns navigation immediately after reload', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible();

    await startSprintInterval(page);
    await finishSprintIntervalWithHold(page);
    await enterRestAfterManualSprintHr(page, '168');

    await expectSessionOwnsNavigationAfterReload(page, {
      expectedPhase: 'resting',
      expectedRep: 1,
    });

    await expect(page.locator('#status-pill')).toContainText('REST');

    consoleGate.assertClean();
  });

  test('foregrounding an in-memory Sprint never exposes Home', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;

    await openSprintWorkout(page);
    await page.locator('#start-session-btn').click();
    await expect(page.locator('#session.screen.active')).toBeVisible();

    await startSprintInterval(page);
    await startScreenTrace(page);

    await setDocumentVisibility(page, false);
    await page.waitForTimeout(500);
    await setDocumentVisibility(page, true);

    await expect(page.locator('#session.screen.active')).toBeVisible();
    await expect(page.locator('#status-pill')).toContainText('SPRINT');
    expectNoProgramShellDuringResume(await readScreenTrace(page));

    consoleGate.assertClean();
  });

  test.describe('seeded rest HR resume', () => {
    test.use({
      consoleGateOptions: {
        allowlist: [/Blocked call to navigator\.vibrate/i],
      },
    });

    test('manual Rest HR owns navigation immediately after reload', async ({
      localAthletePage,
      consoleGate,
    }) => {
      const page = localAthletePage;
      const sessionId = 'seeded-rest-hr-session';

      await seedLocalActiveSessionCheckpoint(page, {
        sessionId,
        state: {
          phase: 'manual-entry',
          currentRep: 1,
          seconds: 0,
          data: [],
          pendingRep: {
            sprintHR: 168,
            restHR: null,
            drop: null,
            suspicious: false,
            needsManualSprint: false,
            needsManualRest: true,
          },
          awaitingModal: true,
          capturedSprintHR: 168,
          capturedRestHR: null,
        },
        timer: {
          kind: 'rest',
          startedAt: Date.now() - 60000,
          totalRest: 90,
          restCaptureAt: 60,
          captureAttempted: true,
          delaySec: 0,
        },
      });

      await installScreenTrace(page);
      await page.reload();

      await expect(page.locator('#session.screen.active')).toBeVisible({
        timeout: 15000,
      });
      await expect(page.locator('#toast')).toContainText(/SESSION RESUMED/i, {
        timeout: 15000,
      });
      await expect(page.locator('#hr-modal.open')).toBeVisible();
      await expect(page.locator('#modal-rest-hr')).toBeEnabled();

      expectNoProgramShellDuringResume(await readScreenTrace(page));

      const checkpointAfter = await readActiveSessionCheckpoint(page);
      expect(checkpointAfter?.sessionId).toBe(sessionId);
      expect(checkpointAfter?.state.phase).toBe('manual-entry');
      expect(checkpointAfter?.state.capturedSprintHR).toBe(168);

      consoleGate.assertClean();
    });
  });
});
