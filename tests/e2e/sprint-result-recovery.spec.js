import { test, expect } from './fixtures.js';
import {
  attachProof,
  saveAthleteProfile,
  seedFinishedSprintSession,
  waitForHome,
  weekWorkoutCard,
} from './helpers/app.js';

async function expectSprintCardState(page, { tag, action, completed = false }) {
  const card = weekWorkoutCard(page, 0, 0);
  await expect(card.locator('.workout-tag')).toHaveText(tag);
  await expect(card.locator('.workout-action')).toHaveText(action);
  if (completed) await expect(card).toHaveClass(/completed/);
  else await expect(card).not.toHaveClass(/completed/);
}

async function openPendingSprintResults(page) {
  await weekWorkoutCard(page, 0, 0).click();
  await expect(page.locator('#workout-detail.screen.active')).toBeVisible();
  await expect(page.locator('#detail-action-btn')).toHaveText('VIEW RESULTS');
  await expect(page.locator('#detail-action-btn')).toHaveAttribute('data-action', 'view-results');
  await page.locator('#detail-action-btn').click();
  await expect(page.locator('#results.screen.active')).toBeVisible();
}

test.describe('sprint result recovery', () => {
  test.beforeEach(async ({ localAthletePage }) => {
    await waitForHome(localAthletePage);
    await saveAthleteProfile(localAthletePage, 'Sprint Recovery Athlete');
  });

  test('recovers saved Sprint results after cold reload without opening a new timer', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    const record = await seedFinishedSprintSession(page);

    await page.reload();
    await waitForHome(page);

    await expectSprintCardState(page, { tag: 'Proof Needed', action: 'RESULTS' });
    await openPendingSprintResults(page);

    await expect(page.locator('#results-kicker')).toHaveText('SPRINT SAVED');
    await expect(page.locator('#sprint-recovery-banner')).toBeVisible();
    await expect(page.locator('#sprint-recovery-banner')).toContainText('Proof required to complete this workout');
    await expect(page.locator('#results-body .result-card')).toHaveCount(5);
    await expect(page.locator('#results-body .result-card').first()).toContainText('172');
    await expect(page.locator('#results-body .summary-val').first()).toHaveText('55');
    await expect(page.locator('#results-body .summary-val').nth(1)).toHaveText('180');
    await expect(page.locator('[data-proof-host="sprint"]')).toBeVisible();
    await expect(page.locator('#complete-workout-btn')).toHaveText('COMPLETE WORKOUT');
    await expect(page.locator('#setup.screen.active')).toHaveCount(0);
    await expect(page.locator('#session.screen.active')).toHaveCount(0);

    await attachProof(page, 'sprint');
    await expect(page.locator('#complete-workout-btn')).toBeEnabled();
    await page.locator('#complete-workout-btn').click();
    await expect(page.locator('#toast')).toContainText('WORKOUT COMPLETE', { timeout: 15000 });

    await page.locator('#new-session-btn').click();
    await expect(page.locator('#home.screen.active')).toBeVisible();
    await expectSprintCardState(page, { tag: 'Done', action: 'RESULTS', completed: true });

    const persisted = await page.evaluate(() => ({
      sessions: JSON.parse(localStorage.getItem('sprintTrainerHistory') || '[]'),
      completions: JSON.parse(localStorage.getItem('ringReadyWorkoutCompletions') || '{}'),
    }));
    expect(persisted.sessions).toHaveLength(1);
    expect(persisted.sessions[0].id).toBe(record.id);
    expect(Object.keys(persisted.completions)).toEqual(['0:0']);
    expect(persisted.completions['0:0'].id).toBe(record.id);
    expect(persisted.completions['0:0'].completedAt).toBeTruthy();
    expect(persisted.completions['0:0'].data).toEqual(record.data);

    await weekWorkoutCard(page, 0, 0).click();
    await expect(page.locator('#detail-action-btn')).toHaveText('VIEW RESULTS');
    await page.locator('#detail-action-btn').click();
    await expect(page.locator('#results.screen.active')).toBeVisible();
    await expect(page.locator('#results-kicker')).toHaveText('Session Complete');
    await expect(page.locator('#sprint-recovery-banner')).toBeHidden();
    await expect(page.locator('#results-body .result-card')).toHaveCount(5);

    consoleGate.assertClean();
  });

  test('does not offer OPEN TIMER as the primary Sprint action while proof is pending', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await seedFinishedSprintSession(page);
    await page.reload();
    await waitForHome(page);

    await expect(weekWorkoutCard(page, 0, 0).locator('.workout-action')).not.toHaveText('OPEN TIMER');
    await weekWorkoutCard(page, 0, 0).click();
    await expect(page.locator('#detail-action-btn')).not.toHaveText(/OPEN TIMER/i);
    await expect(page.locator('#detail-action-btn')).toHaveAttribute('data-action', 'view-results');
    await expect(page.locator('#setup.screen.active')).toHaveCount(0);

    consoleGate.assertClean();
  });

  test('keeps Timer Ready / Open Timer when no prior Sprint exists', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await expectSprintCardState(page, { tag: 'Timer Ready', action: 'OPEN TIMER' });
    await weekWorkoutCard(page, 0, 0).click();
    await expect(page.locator('#detail-action-btn')).toHaveAttribute('data-action', 'sprint');
    await page.locator('#detail-action-btn').click();
    await expect(page.locator('#setup.screen.active')).toBeVisible();

    consoleGate.assertClean();
  });

  test('shows Finish Save when proof is already attached and completion is missing', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await seedFinishedSprintSession(page, {
      sessionId: 'sprint-finish-save-session',
      attachment: { id: 'attachment-1', storagePath: 'user/week1/proof.webp' },
      proofPolicyVersion: 1,
    });
    await page.reload();
    await waitForHome(page);

    await expectSprintCardState(page, { tag: 'Finish Save', action: 'RESULTS' });
    await openPendingSprintResults(page);
    await expect(page.locator('#sprint-recovery-banner')).toBeVisible();
    await expect(page.locator('#sprint-recovery-banner-copy'))
      .toHaveText('Finish saving this workout to your account.');
    await expect(page.locator('#sprint-recovery-banner')).not.toContainText(/Proof required/i);
    await expect(page.locator('#complete-workout-btn')).toBeEnabled();

    consoleGate.assertClean();
  });

  test('never assigns a Week 4 Sprint to Week 1', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await seedFinishedSprintSession(page, {
      weekIndex: 3,
      sessionId: 'week4-sprint-session',
    });
    await page.reload();
    await waitForHome(page);

    await expectSprintCardState(page, { tag: 'Timer Ready', action: 'OPEN TIMER' });

    await page.locator('#open-week-menu-btn').click();
    await page.locator('.drawer-week-btn[data-week-index="3"]').click();
    await expect(page.locator('#home.screen.active')).toBeVisible();
    await expect(weekWorkoutCard(page, 3, 0).locator('.workout-tag')).toHaveText('Proof Needed');
    await expect(weekWorkoutCard(page, 3, 0).locator('.workout-action')).toHaveText('RESULTS');

    consoleGate.assertClean();
  });
});
