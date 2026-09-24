import { test, expect } from './fixtures.js';
import {
  openLogWorkout,
  openSprintWorkout,
  saveAthleteProfile,
  waitForHome,
} from './helpers/app.js';
import {
  IOS_MANUAL_HR_MESSAGE,
  IOS_MANUAL_HR_STATUS,
} from '../../src/platform.js';

async function installWebBluetoothStub(page) {
  await page.addInitScript(() => {
    window.__bleRequested = false;
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        requestDevice: () => {
          window.__bleRequested = true;
          return Promise.reject(new Error('User cancelled the requestDevice() chooser'));
        },
      },
    });
  });
  await page.reload();
  await waitForHome(page);
}

test.describe('iPhone Manual HR BLE containment', () => {
  test.beforeEach(async ({ localAthletePage }, testInfo) => {
    test.skip(testInfo.project.name !== 'webkit-iphone', 'iPhone WebKit profile only');
    await waitForHome(localAthletePage);
    await saveAthleteProfile(localAthletePage, 'iPhone HR Athlete');
  });

  test('defaults to Manual HR and disables BLE connect', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await openSprintWorkout(page);

    const bleBtn = page.locator('#ble-btn');
    await expect(bleBtn).toBeDisabled();
    await expect(bleBtn).toHaveText('CONNECT');
    await expect(page.locator('#ble-name')).toHaveText('Manual HR');
    await expect(page.locator('#ble-status')).toHaveText(IOS_MANUAL_HR_STATUS);
    await expect(page.locator('#hr-setup-copy')).toContainText(IOS_MANUAL_HR_MESSAGE);
    await expect(page.locator('#hr-setup-copy')).not.toContainText(/Bluefy/i);
    await expect(page.locator('#hr-setup-disclaimer')).toBeHidden();
    await expect(page.locator('#start-session-btn')).toBeEnabled();

    consoleGate.assertClean();
  });

  test('blocks a stale BLE tap even when Web Bluetooth is injected', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await installWebBluetoothStub(page);
    await openSprintWorkout(page);

    await expect(page.locator('#ble-btn')).toBeDisabled();
    await expect(page.locator('#ble-status')).toHaveText(IOS_MANUAL_HR_STATUS);

    const requested = await page.evaluate(async () => {
      const btn = document.getElementById('ble-btn');
      btn.disabled = false;
      btn.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return window.__bleRequested;
    });

    expect(requested).toBe(false);
    await expect(page.locator('#toast')).toContainText(/Manual HR/i);
    await expect(page.locator('#toast')).not.toContainText(/Bluefy|Web Bluetooth|navigator\.bluetooth/i);
    await expect(page.locator('#ble-btn')).toBeDisabled();

    consoleGate.assertClean();
  });

  test('keeps entered manual HR after leaving and reopening a workout', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await openLogWorkout(page, 0, 1);
    await page.locator('#detail-avg-bpm-input').fill('145');
    await page.locator('#detail-max-bpm-input').fill('160');
    await page.locator('#detail-back-btn').click();
    await waitForHome(page);
    await openLogWorkout(page, 0, 1);

    await expect(page.locator('#detail-avg-bpm-input')).toHaveValue('145');
    await expect(page.locator('#detail-max-bpm-input')).toHaveValue('160');

    consoleGate.assertClean();
  });
});

test.describe('non-iOS BLE availability', () => {
  test.beforeEach(async ({ localAthletePage }, testInfo) => {
    test.skip(testInfo.project.name === 'webkit-iphone', 'Chromium profiles only');
    await waitForHome(localAthletePage);
    await saveAthleteProfile(localAthletePage, 'Android HR Athlete');
  });

  test('keeps BLE connect available when Web Bluetooth exists', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await installWebBluetoothStub(page);
    await openSprintWorkout(page);

    const bleBtn = page.locator('#ble-btn');
    await expect(bleBtn).toBeEnabled();
    await expect(bleBtn).toHaveText('CONNECT');
    await expect(page.locator('#ble-name')).toHaveText('Not Connected');
    await expect(page.locator('#hr-setup-copy')).not.toContainText(/Bluefy/i);
    await expect(page.locator('#hr-setup-disclaimer')).toBeVisible();

    await bleBtn.click();
    expect(await page.evaluate(() => window.__bleRequested)).toBe(true);

    consoleGate.assertClean();
  });

  test('keeps the existing manual fallback when Web Bluetooth is unavailable', async ({
    localAthletePage,
    consoleGate,
  }) => {
    const page = localAthletePage;
    await openSprintWorkout(page);

    await expect(page.locator('#ble-btn')).toBeDisabled();
    await expect(page.locator('#ble-btn')).toHaveText('MANUAL');
    await expect(page.locator('#ble-status')).toContainText('Bluetooth unavailable in this browser');

    consoleGate.assertClean();
  });
});
