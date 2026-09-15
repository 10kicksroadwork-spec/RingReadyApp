import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getHRMonitorSetupCopy,
  getPlatformInfo,
  HR_MONITOR_OPTIONAL_COPY,
  isIOSDevice,
  isIOSWebBluetoothBlocked,
  IOS_MANUAL_HR_MESSAGE,
  IOS_MANUAL_HR_SETUP_COPY,
  IOS_MANUAL_HR_STATUS,
} from '../src/platform.js';
import {
  applyPlatformBLEMode,
  connectHR,
  hrServiceTestHooks,
  hrState,
  initHRService,
  initHRTransport,
} from '../src/hr-service.js';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const originalUserAgent = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
  || Object.getOwnPropertyDescriptor(navigator, 'userAgent');
const originalPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')
  || Object.getOwnPropertyDescriptor(navigator, 'platform');
const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(Navigator.prototype, 'maxTouchPoints')
  || Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');
const originalBluetooth = Object.getOwnPropertyDescriptor(navigator, 'bluetooth');

function stubNavigator({
  userAgent,
  platform = 'Win32',
  maxTouchPoints = 0,
  bluetooth,
  capacitor,
}) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    get: () => userAgent,
  });
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    get: () => platform,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    get: () => maxTouchPoints,
  });
  if (bluetooth === undefined) {
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: undefined,
    });
  } else {
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: bluetooth,
    });
  }
  if (capacitor) {
    window.Capacitor = capacitor;
  } else {
    delete window.Capacitor;
  }
}

function restoreNavigator() {
  if (originalUserAgent) Object.defineProperty(navigator, 'userAgent', originalUserAgent);
  if (originalPlatform) Object.defineProperty(navigator, 'platform', originalPlatform);
  if (originalMaxTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints);
  if (originalBluetooth) {
    Object.defineProperty(navigator, 'bluetooth', originalBluetooth);
  } else {
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: undefined,
    });
  }
  delete window.Capacitor;
}

function mountHrDom() {
  document.body.innerHTML = `
    <div id="hr-setup-copy">Optional. Works with most BLE chest straps. ANT+ is not supported. Manual HR entry is always available.</div>
    <div class="hr-setup-notice" id="hr-setup-disclaimer">
      <strong>Before connecting:</strong> Disconnect your chest strap first.
    </div>
    <div class="ble-row" id="ble-row">
      <div class="ble-dot" id="ble-dot"></div>
      <div class="ble-info">
        <div class="ble-name" id="ble-name">Not Connected</div>
        <div class="ble-status" id="ble-status">Manual HR entry will be used unless connected</div>
      </div>
      <button type="button" class="ble-btn" id="ble-btn" aria-label="Connect heart rate monitor">CONNECT</button>
    </div>
    <input id="detail-avg-bpm-input" value="148">
    <input id="detail-max-bpm-input" value="172">
    <input id="modal-sprint-hr" value="165">
    <input id="modal-rest-hr" value="118">
    <div id="live-hr-val">--</div>
    <div id="live-badge" style="display:none"></div>
  `;
}

function readManualHrFields() {
  return {
    avg: document.getElementById('detail-avg-bpm-input').value,
    max: document.getElementById('detail-max-bpm-input').value,
    sprint: document.getElementById('modal-sprint-hr').value,
    rest: document.getElementById('modal-rest-hr').value,
    source: hrState.source,
    connected: hrState.connected,
  };
}

describe('iOS BLE containment', () => {
  let showToast;

  beforeEach(() => {
    mountHrDom();
    showToast = vi.fn();
    hrServiceTestHooks.resetTransportForTest();
    initHRService({ showToast });
  });

  afterEach(() => {
    hrServiceTestHooks.resetTransportForTest();
    restoreNavigator();
    document.body.innerHTML = '';
  });

  it('detects iPhone, iPad, and iPadOS-style devices via existing platform info', () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone' });
    expect(isIOSDevice()).toBe(true);
    expect(getPlatformInfo().isIOS).toBe(true);
    expect(isIOSWebBluetoothBlocked()).toBe(true);

    stubNavigator({ userAgent: IPAD_UA, platform: 'iPad' });
    expect(isIOSDevice()).toBe(true);
    expect(isIOSWebBluetoothBlocked()).toBe(true);

    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });
    expect(isIOSDevice()).toBe(true);
    expect(isIOSWebBluetoothBlocked()).toBe(true);
  });

  it('does not treat Android or desktop Chromium as iOS', () => {
    stubNavigator({ userAgent: ANDROID_UA });
    expect(isIOSDevice()).toBe(false);
    expect(isIOSWebBluetoothBlocked()).toBe(false);

    stubNavigator({ userAgent: DESKTOP_CHROME_UA });
    expect(isIOSDevice()).toBe(false);
    expect(isIOSWebBluetoothBlocked()).toBe(false);
  });

  it('keeps native Capacitor iOS BLE available', () => {
    stubNavigator({
      userAgent: IPHONE_UA,
      platform: 'iPhone',
      capacitor: { getPlatform: () => 'ios' },
    });
    const info = getPlatformInfo();
    expect(info.isIOS).toBe(true);
    expect(info.supportsNativeBLE).toBe(true);
    expect(isIOSWebBluetoothBlocked(info)).toBe(false);
    expect(getHRMonitorSetupCopy()).toBe(HR_MONITOR_OPTIONAL_COPY);

    applyPlatformBLEMode();
    const btn = document.getElementById('ble-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('CONNECT');
    expect(document.getElementById('hr-setup-disclaimer').hidden).toBe(false);
  });

  it('defaults iPhone to Manual HR and disables BLE even when Web Bluetooth exists', async () => {
    const requestDevice = vi.fn();
    stubNavigator({
      userAgent: IPHONE_UA,
      platform: 'iPhone',
      bluetooth: { requestDevice },
    });

    expect(getHRMonitorSetupCopy()).toBe(IOS_MANUAL_HR_SETUP_COPY);
    expect(getHRMonitorSetupCopy()).not.toMatch(/Bluefy/i);

    await initHRTransport();
    applyPlatformBLEMode();

    const btn = document.getElementById('ble-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.textContent).toBe('CONNECT');
    expect(document.getElementById('ble-name').textContent).toBe('Manual HR');
    expect(document.getElementById('ble-status').textContent).toBe(IOS_MANUAL_HR_STATUS);
    expect(document.getElementById('hr-setup-copy').textContent).toBe(IOS_MANUAL_HR_SETUP_COPY);
    expect(document.getElementById('hr-setup-disclaimer').hidden).toBe(true);
    expect(hrServiceTestHooks.getTransportForTest()).toBe(null);
    expect(hrServiceTestHooks.hasWebModuleForTest()).toBe(false);
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it('does not call navigator.bluetooth when an iPhone athlete reaches the BLE handler', async () => {
    const requestDevice = vi.fn();
    stubNavigator({
      userAgent: IPHONE_UA,
      platform: 'iPhone',
      bluetooth: { requestDevice },
    });
    hrServiceTestHooks.setAcceptTransportHRForTest(false);
    await initHRTransport();
    const before = readManualHrFields();

    await connectHR();

    expect(requestDevice).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(IOS_MANUAL_HR_MESSAGE);
    expect(showToast.mock.calls[0][0]).not.toMatch(/Bluefy|Web Bluetooth|navigator\.bluetooth|BLE error/i);
    expect(hrServiceTestHooks.isAcceptingTransportHR()).toBe(false);
    expect(readManualHrFields()).toEqual(before);
    expect(document.getElementById('ble-btn').disabled).toBe(true);
  });

  it('preserves entered manual HR values when iOS BLE UI is applied', () => {
    stubNavigator({ userAgent: IPHONE_UA, platform: 'iPhone' });
    const before = readManualHrFields();
    applyPlatformBLEMode();
    expect(readManualHrFields()).toEqual(before);
    expect(hrState.source).toBe('manual');
  });
});

describe('non-iOS BLE behavior', () => {
  let showToast;

  beforeEach(() => {
    mountHrDom();
    showToast = vi.fn();
    hrServiceTestHooks.resetTransportForTest();
    initHRService({ showToast });
  });

  afterEach(() => {
    hrServiceTestHooks.resetTransportForTest();
    restoreNavigator();
    document.body.innerHTML = '';
  });

  it('keeps BLE connect available on Android when Web Bluetooth exists', async () => {
    const requestDevice = vi.fn(async () => {
      throw new Error('User cancelled the requestDevice() chooser');
    });
    stubNavigator({
      userAgent: ANDROID_UA,
      bluetooth: { requestDevice },
    });

    expect(getHRMonitorSetupCopy()).toBe(HR_MONITOR_OPTIONAL_COPY);
    expect(getHRMonitorSetupCopy()).not.toMatch(/Bluefy/i);

    await initHRTransport();
    applyPlatformBLEMode();

    const btn = document.getElementById('ble-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('CONNECT');
    expect(document.getElementById('ble-name').textContent).toBe('Not Connected');
    expect(document.getElementById('hr-setup-disclaimer').hidden).toBe(false);
    expect(hrServiceTestHooks.getTransportForTest()).toBe('web');
    expect(hrServiceTestHooks.hasWebModuleForTest()).toBe(true);

    await connectHR();

    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('CONNECTION CANCELLED');
  });

  it('keeps the existing manual fallback when Web Bluetooth is unavailable', () => {
    stubNavigator({ userAgent: ANDROID_UA });
    applyPlatformBLEMode();

    const btn = document.getElementById('ble-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('MANUAL');
    expect(document.getElementById('ble-name').textContent).toBe('Manual Mode');
    expect(document.getElementById('ble-status').textContent).toBe('Bluetooth unavailable in this browser');
  });

  it('does not change desktop Chromium BLE-capable UI', () => {
    stubNavigator({
      userAgent: DESKTOP_CHROME_UA,
      bluetooth: { requestDevice: vi.fn() },
    });
    applyPlatformBLEMode();
    const btn = document.getElementById('ble-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('CONNECT');
  });
});
