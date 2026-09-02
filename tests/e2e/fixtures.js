import { test as base } from '@playwright/test';
import { attachConsoleGate } from './helpers/console-gate.js';
import { seedLocalAthleteState } from './helpers/app.js';

export const test = base.extend({
  consoleGate: async ({ page }, use) => {
    const gate = attachConsoleGate(page);
    await use(gate);
    gate.assertClean();
  },
  localAthletePage: async ({ page }, use) => {
    await seedLocalAthleteState(page);
    await page.goto('/');
    await use(page);
  },
});

export { expect } from '@playwright/test';
