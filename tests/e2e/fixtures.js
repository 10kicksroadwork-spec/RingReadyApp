import { test as base } from '@playwright/test';
import { attachConsoleGate } from './helpers/console-gate.js';
import { seedLocalAthleteState } from './helpers/app.js';

export const test = base.extend({
  // Opt-in allowlist for intentional failure-injection specs only.
  // Use an object (not a bare array) so Playwright test.use() preserves it.
  consoleGateOptions: [{ allowlist: [] }, { option: true }],
  // Auto fixture: attaches before dependent fixtures navigate (e.g. localAthletePage).
  consoleGate: [
    async ({ page, consoleGateOptions }, use) => {
      const allowlist = Array.isArray(consoleGateOptions?.allowlist)
        ? consoleGateOptions.allowlist
        : [];
      const gate = attachConsoleGate(page, { allowlist });
      await use(gate);
      gate.assertClean();
    },
    { auto: true },
  ],
  localAthletePage: async ({ page, consoleGate: _consoleGate }, use) => {
    await seedLocalAthleteState(page);
    await page.goto('/');
    await use(page);
  },
});

export { expect } from '@playwright/test';
