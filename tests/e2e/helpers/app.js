import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROOF_FIXTURE = path.resolve(__dirname, '../../../public/icon-192.png');

export async function seedLocalAthleteState(page) {
  await page.addInitScript(() => {
    localStorage.setItem('ringReadyOnboardingDismissed', '1');
  });
}

export async function waitForHome(page) {
  await expect(page.locator('#home.screen.active')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#boot')).not.toHaveClass(/active/);
}

export async function goHome(page) {
  if (await page.locator('#home.screen.active').isVisible()) return;
  const detailBack = page.locator('#workout-detail.screen.active #detail-back-btn');
  if (await detailBack.isVisible()) {
    await detailBack.click();
    await expectActiveScreen(page, 'home');
    return;
  }
  const homeButton = page.locator('.screen.active [data-page-target="home"]').first();
  await homeButton.click();
  await expectActiveScreen(page, 'home');
}

export async function openDrawer(page) {
  await closeDrawerIfOpen(page);
  const menuButton = page.locator('.screen.active button[aria-label="Open app menu"]');
  await menuButton.click();
  await expect(page.locator('#week-drawer')).toBeVisible();
}

export async function closeDrawer(page) {
  const drawer = page.locator('#week-drawer');
  if (!(await drawer.evaluate((el) => el.classList.contains('open')))) return;
  await page.keyboard.press('Escape');
  await expect(drawer).not.toHaveClass(/open/);
}

export async function closeDrawerIfOpen(page) {
  if (await page.locator('#week-drawer.open').isVisible()) {
    await closeDrawer(page);
  }
}

export async function navigateFromDrawer(page, screenId) {
  const menuButton = page.locator('.screen.active button[aria-label="Open app menu"]');
  if (!(await menuButton.isVisible())) {
    await goHome(page);
  }
  await openDrawer(page);
  await page.locator(`.drawer-page-btn[data-page-target="${screenId}"]`).click();
  await expect(page.locator(`#${screenId}.screen.active`)).toBeVisible();
}

export async function expectActiveScreen(page, screenId) {
  await expect(page.locator(`#${screenId}.screen.active`)).toBeVisible();
}

export async function saveAthleteProfile(page, name = 'Echo Athlete') {
  await navigateFromDrawer(page, 'athlete-profile');
  await page.locator('#profile-athlete-name').fill(name);
  await page.locator('#save-athlete-profile-btn').click();
  await expect(page.locator('#header-athlete-name')).toContainText(name);
  await goHome(page);
}

async function fillAndBlur(page, selector, value) {
  const input = page.locator(selector);
  await input.fill(value);
  await input.blur();
}

export async function fillWorkoutDuration(page, selector, value) {
  await fillAndBlur(page, selector, value);
}

export async function attachProof(page, surface) {
  const input = page.locator(`[data-proof-input="${surface}"]`);
  await expect(input).toHaveCount(1);
  await input.setInputFiles(PROOF_FIXTURE);
  await expect(page.locator(`[data-proof-host="${surface}"] .proof-preview`)).toBeVisible({
    timeout: 15000,
  });
}

export async function openLogWorkout(page, weekIndex = 0, workoutIndex = 1) {
  await expectActiveScreen(page, 'home');
  await closeDrawerIfOpen(page);
  await page.locator(
    `.week-workout-card[data-week-index="${weekIndex}"][data-workout-index="${workoutIndex}"]`,
  ).click();
  await expectActiveScreen(page, 'workout-detail');
}

export async function openSprintWorkout(page, weekIndex = 0, workoutIndex = 0) {
  await openLogWorkout(page, weekIndex, workoutIndex);
  await page.locator('#detail-action-btn').click();
  await expectActiveScreen(page, 'setup');
}

export async function startSprintInterval(page) {
  const btn = page.locator('#main-btn');
  await btn.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#status-pill')).toContainText('SPRINT', { timeout: 10000 });
  await expect(page.locator('#curr-interval')).toHaveText('1');
}

export async function readActiveSessionCheckpoint(page) {
  return page.evaluate(() => {
    const prefix = 'ringReadyActiveSession:';
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        return JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        return null;
      }
    }
    return null;
  });
}

export async function waitForActiveSessionCheckpoint(page) {
  await page.waitForFunction(() => (
    Object.keys(localStorage).some((key) => key.startsWith('ringReadyActiveSession:'))
  ));
  const checkpoint = await readActiveSessionCheckpoint(page);
  expect(checkpoint?.sessionId).toBeTruthy();
  return checkpoint;
}

export async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth > root.clientWidth + 1;
  });
  expect(overflow).toBe(false);
}

