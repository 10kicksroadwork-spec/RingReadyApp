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

    await page.locator('#coach-benchmark-stats-sort').selectOption('desc');
    const descNames = await page.locator('#coach-benchmark-stats-list .coach-lens-card strong').allTextContents();
    const descValues = await page.locator('#coach-benchmark-stats-list .coach-lens-card em').allTextContents();
    await page.locator('#coach-benchmark-stats-sort').selectOption('asc');
    const ascNames = await page.locator('#coach-benchmark-stats-list .coach-lens-card strong').allTextContents();
    const ascValues = await page.locator('#coach-benchmark-stats-list .coach-lens-card em').allTextContents();
    expect(ascNames.length).toBe(descNames.length);
    expect(ascNames.length).toBeGreaterThan(1);
    expect(ascNames.join('|')).not.toBe(descNames.join('|'));
    expect(Number.parseFloat(descValues[0])).toBeGreaterThanOrEqual(Number.parseFloat(ascValues[0]));

    await page.locator('#coach-benchmark-stats-sort').selectOption('desc');
    const allCount = await page.locator('#coach-benchmark-stats-list .coach-lens-card').count();
    await page.locator('[data-coach-metric-filter="declining"][data-coach-lens="benchmark"]').click();
    const decliningCards = page.locator('#coach-benchmark-stats-list .coach-lens-card');
    const decliningCount = await decliningCards.count();
    expect(decliningCount).toBeGreaterThan(0);
    expect(decliningCount).toBeLessThan(allCount);
    for (let i = 0; i < decliningCount; i += 1) {
      await expect(decliningCards.nth(i).locator('.coach-status-chip')).toHaveText(/DECLINING/i);
      await expect(decliningCards.nth(i)).toHaveClass(/is-declining/);
    }

    await page.locator('[data-coach-metric-filter="all"][data-coach-lens="benchmark"]').click();
    await page.locator('#coach-benchmark-stats-search').fill('Alex');
    await expect(page.locator('#coach-benchmark-stats-list .coach-lens-card')).toHaveCount(1);
    await expect(page.locator('#coach-benchmark-stats-list .coach-lens-card strong')).toContainText(/Alex/i);
    const aggregateBench = (await page.locator('#coach-benchmark-stats-list .coach-lens-card em').textContent())?.trim();

    await page.locator('#coach-benchmark-stats-list .coach-lens-card').click();
    await expect(page.locator('#coach-athlete.screen.active')).toBeVisible();
    await expect(page.locator('#coach-athlete-name')).toContainText(/Alex/i);
    await expect(page.locator('#coach-athlete-select')).toHaveValue('alex');
    await expect(page.locator('#coach-athlete-guidance-label')).toContainText(/Generated guidance/i);
    await expect(page.locator('#coach-athlete-notes-kicker')).toContainText(/Coach-authored notes/i);

    const detailBench = page.locator('.coach-metric-card').filter({ hasText: 'Benchmark Run' }).locator('strong');
    await expect(detailBench).toHaveText(aggregateBench || '');
    await expect(detailBench).toHaveText(/\d+\.\d/);
    await expect(page.locator('.coach-metric-card').filter({ hasText: 'Performance Index' }).locator('strong')).toHaveText(/\d+\.\d/);

    await expect(page.locator('#coach-athlete-mile-test')).toBeVisible();
    await expect(page.locator('#coach-athlete-mile-test-body')).toContainText(/Baseline/i);
    await expect(page.locator('#coach-athlete-mile-test-body')).toContainText(/Latest/i);
    await expect(page.locator('#coach-athlete-mile-test-body')).toContainText(/Delta/i);
    await expect(page.locator('#coach-athlete-zone-heatmap')).toBeVisible();
    await expect(page.locator('#coach-athlete-hr-pace')).toBeVisible();
  });

  test('recovery aggregate matches Detailed Summary latest First-5 value', async ({ page }) => {
    await openCoachPreview(page);
    await openDrawer(page);
    await page.locator('.drawer-page-btn[data-page-target="coach-recovery-stats"]').click();
    await expect(page.locator('#coach-recovery-stats.screen.active')).toBeVisible();
    await page.locator('#coach-recovery-stats-search').fill('Alex');
    await expect(page.locator('#coach-recovery-stats-list .coach-lens-card')).toHaveCount(1);
    const aggregateRecovery = (await page.locator('#coach-recovery-stats-list .coach-lens-card em').textContent())?.trim();
    await page.locator('#coach-recovery-stats-list .coach-lens-card').click();
    await expect(page.locator('#coach-athlete.screen.active')).toBeVisible();
    const detailRecovery = page.locator('.coach-metric-card').filter({ hasText: /Recovery/i }).locator('strong');
    await expect(detailRecovery).toContainText(aggregateRecovery || '');
  });

  test('Jordan Tillman zone heatmap uses personalized HR bands', async ({ page }) => {
    await openCoachPreview(page);
    await page.locator('#coach-roster-search').fill('Tillman');
    const jordanCard = page.locator('.coach-roster-card[data-coach-athlete="jordan-tillman"]');
    await expect(jordanCard).toBeVisible();
    await jordanCard.click();

    await expect(page.locator('#coach-athlete.screen.active')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#coach-athlete-name')).toContainText(/Jordan Tillman/i);
    await expect(page.locator('#coach-athlete-zone-heatmap')).toBeVisible();

    const heat = page.locator('#coach-athlete-zone-heatmap-body');
    await expect(heat).toContainText('Target 145–155');
    await expect(heat).toContainText('Target 166–176');
    await expect(heat).toContainText('Target 165–175');
    await expect(heat).not.toContainText('Target 132–142');
    await expect(heat).not.toContainText('Target 155–165');

    const tuesday = heat.locator('.coach-zone-heat-cell').filter({ hasText: /W1 Tuesday/i });
    await expect(tuesday).toContainText('154');
    await expect(tuesday).toContainText('IN ZONE');
    await expect(tuesday).toContainText('Target 145–155');

    const wednesday = heat.locator('.coach-zone-heat-cell').filter({ hasText: /W1 Wednesday/i });
    await expect(wednesday).toContainText('165');
    await expect(wednesday).toContainText('1 bpm LOW');
    await expect(wednesday).toContainText('Target 166–176');
  });

  test('clear current alerts then a newer HR flag returns to Needs a look', async ({ page }) => {
    await page.goto('/?coach=1');
    await expect(page.locator('#coach-dashboard.screen.active')).toBeVisible({ timeout: 15000 });

    const samCard = page.locator('.coach-roster-card[data-coach-athlete="sam"]');
    await expect(samCard).toBeVisible();
    await expect(samCard.locator('.coach-status-chip')).toHaveText(/Watch HR/i);
    const beforeCount = Number(await page.locator('#coach-attention-count').textContent());
    expect(beforeCount).toBeGreaterThan(0);

    await samCard.click();
    await expect(page.locator('#coach-athlete.screen.active')).toBeVisible();
    await expect(page.locator('#coach-athlete-name')).toContainText(/Sam Ortiz/i);
    await expect(page.locator('#coach-athlete-status')).toHaveText(/Watch HR/i);
    await expect(page.locator('#coach-athlete-attention')).toBeVisible();
    await expect(page.locator('#coach-athlete-attention')).toContainText(/HR flag/i);
    await expect(page.locator('[data-coach-clear-alerts]')).toBeVisible();

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toMatch(/reviewed/i);
      expect(dialog.message()).toMatch(/does not change workout data/i);
      await dialog.accept();
    });
    await page.locator('[data-coach-clear-alerts]').click();

    await expect(page.locator('#coach-athlete-status')).toHaveText(/On track/i);
    await expect(page.locator('#coach-athlete-attention')).toContainText(/Alerts reviewed/i);
    await expect(page.locator('[data-coach-restore-alerts]')).toBeVisible();

    await page.locator('#coach-athlete [data-page-target="coach-dashboard"]').click();
    await expect(page.locator('#coach-dashboard.screen.active')).toBeVisible();
    await expect(page.locator('.coach-roster-card[data-coach-athlete="sam"] .coach-status-chip')).toHaveText(/On track/i);
    const clearedCount = Number(await page.locator('#coach-attention-count').textContent());
    expect(clearedCount).toBe(beforeCount - 1);

    await page.reload();
    await expect(page.locator('#coach-dashboard.screen.active')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.coach-roster-card[data-coach-athlete="sam"] .coach-status-chip')).toHaveText(/On track/i);
    expect(Number(await page.locator('#coach-attention-count').textContent())).toBe(clearedCount);

    await page.evaluate(() => {
      window.__ringReadyCoachPreview.injectAthleteAlert('sam', {
        flags: { '4:3': 'Easy Run avg 165 · target 140' },
        flagEventAt: { '4:3': new Date().toISOString() },
      });
    });
    await expect(page.locator('.coach-roster-card[data-coach-athlete="sam"] .coach-status-chip')).toHaveText(/Watch HR/i);
    expect(Number(await page.locator('#coach-attention-count').textContent())).toBe(beforeCount);
  });
});
