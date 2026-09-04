import { expect, test } from './fixtures.js';
import { closeDrawer, openDrawer, waitForHome } from './helpers/app.js';

async function openCoachPreview(page) {
  await page.goto('/?coach=1');
  await expect(page.locator('#coach-dashboard.screen.active')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#coach-dashboard .coach-hero h2')).toHaveText(/Camp roster/i);
}

test.describe('coach decision dashboard drawer and lenses', () => {
  test('coach drawer shows Analysis and hides Training Weeks', async ({ page }) => {
    await openCoachPreview(page);
    await openDrawer(page);

    await expect(page.locator('[data-coach-training-weeks]')).toBeHidden();
    await expect(page.locator('[data-coach-analysis]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-dashboard"]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-athlete"]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-benchmark-stats"]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-recovery-stats"]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-pace-stats"]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-hr-adherence-stats"]')).toBeVisible();

    await closeDrawer(page);
  });

  test('athlete drawer still shows Training Weeks without coach Analysis', async ({ localAthletePage: page }) => {
    await waitForHome(page);
    await openDrawer(page);

    await expect(page.locator('[data-coach-training-weeks]')).toBeVisible();
    await expect(page.locator('#drawer-week-list')).toBeVisible();
    await expect(page.locator('[data-coach-analysis]')).toBeHidden();
    await expect(page.locator('.drawer-page-btn[data-page-target="home"]')).toBeVisible();
    await expect(page.locator('.drawer-page-btn[data-page-target="coach-benchmark-stats"]')).toBeHidden();

    await closeDrawer(page);
  });

  test('benchmark sort, filter, search, and card open Detailed Summary', async ({ page }) => {
    await openCoachPreview(page);
    await openDrawer(page);
    await page.locator('.drawer-page-btn[data-page-target="coach-benchmark-stats"]').click();
    await expect(page.locator('#coach-benchmark-stats.screen.active')).toBeVisible();
    await expect(page.locator('#coach-benchmark-stats-list .coach-lens-card').first()).toBeVisible();

    const before = await page.locator('#coach-benchmark-stats-list .coach-lens-card strong').allTextContents();
    await page.locator('#coach-benchmark-stats-sort').selectOption('asc');
    await page.locator('#coach-benchmark-stats-sort').selectOption('desc');
    const afterDesc = await page.locator('#coach-benchmark-stats-list .coach-lens-card strong').allTextContents();
    expect(afterDesc.length).toBe(before.length);

    const allCount = await page.locator('#coach-benchmark-stats-list .coach-lens-card').count();
    await page.locator('[data-coach-metric-filter="declining"][data-coach-lens="benchmark"]').click();
    const decliningCount = await page.locator('#coach-benchmark-stats-list .coach-lens-card').count();
    expect(decliningCount).toBeLessThanOrEqual(allCount);

    await page.locator('[data-coach-metric-filter="all"][data-coach-lens="benchmark"]').click();
    await page.locator('#coach-benchmark-stats-search').fill('Alex');
    await expect(page.locator('#coach-benchmark-stats-list .coach-lens-card')).toHaveCount(1);
    await expect(page.locator('#coach-benchmark-stats-list .coach-lens-card strong')).toContainText(/Alex/i);

    await page.locator('#coach-benchmark-stats-list .coach-lens-card').click();
    await expect(page.locator('#coach-athlete.screen.active')).toBeVisible();
    await expect(page.locator('#coach-athlete-name')).toContainText(/Alex/i);
    await expect(page.locator('#coach-athlete-select')).toHaveValue('alex');
    await expect(page.locator('#coach-athlete-guidance-label')).toContainText(/Generated guidance/i);
    await expect(page.locator('#coach-athlete-notes-kicker')).toContainText(/Coach-authored notes/i);
  });

  test('athlete cannot keep a coach screen active without preview', async ({ localAthletePage: page }) => {
    await waitForHome(page);
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
      document.getElementById('coach-benchmark-stats')?.classList.add('active');
    });
    await openDrawer(page);
    await page.locator('.drawer-page-btn[data-page-target="home"]').click();
    await expect(page.locator('#home.screen.active')).toBeVisible();
    await expect(page.locator('#coach-benchmark-stats')).not.toHaveClass(/active/);
  });
});
