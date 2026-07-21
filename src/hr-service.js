import { HR_STALE_MS } from './constants.js';
import { getPlatformInfo } from './platform.js';

export const hrState = {
  source: 'manual',
  connected: false,
  deviceName: null,
  current: null,
  avg: null,
  lastAt: null,
};

let transport = null;
let webModule = null;
let nativeModule = null;
let uiHooks = null;

export function initHRService(hooks) {
  uiHooks = hooks;
}

export async function initHRTransport() {
  const platform = getPlatformInfo();

  if (platform.supportsNativeBLE) {
    nativeModule = await import('./ble-native.js');
    await nativeModule.initNativeBLE({ onHR: handleTransportHR });
    transport = 'native';
    return;
  }

  if (platform.supportsWebBLE) {
    webModule = await import('./ble-web.js');
    webModule.initWebBLE({ onHR: handleTransportHR });
    transport = 'web';
  }
}

function handleTransportHR(payload) {
  if (payload.disconnected) {
    setHRDisconnected();
    if (uiHooks?.onDisconnect) uiHooks.onDisconnect();
    return;
  }

  if (payload.hr == null) return;

  onHRUpdate(payload);
}

export function setHRConnected(deviceName, source) {
  hrState.source = source || transport || 'web-ble';
  hrState.connected = true;
  hrState.deviceName = deviceName || 'HR Monitor';
  hrState.current = null;
  hrState.avg = null;
  hrState.lastAt = null;

  const el = document.getElementById('live-hr-val');
  if (el) el.textContent = '--';

  const badge = document.getElementById('live-badge');
  if (badge) badge.style.display = 'none';
}

export function setHRDisconnected() {
  hrState.source = 'manual';
  hrState.connected = false;
  hrState.deviceName = null;
  hrState.current = null;
  hrState.avg = null;
  hrState.lastAt = null;

  const badge = document.getElementById('live-badge');
  if (badge) badge.style.display = 'none';
}

export function onHRUpdate(payload) {
  if (!payload || payload.hr == null) return;

  hrState.source = payload.source || hrState.source || 'web-ble';
  hrState.connected = true;
  hrState.current = payload.hr;
  hrState.avg = payload.avg != null ? payload.avg : payload.hr;
  hrState.lastAt = payload.at || Date.now();

  const el = document.getElementById('live-hr-val');
  if (el) el.textContent = payload.hr;

  const badge = document.getElementById('live-badge');
  if (badge) badge.style.display = 'flex';
}

export function getAutoCapturedHR() {
  if (!hrState.connected || !hrState.lastAt) return null;
  if (Date.now() - hrState.lastAt > HR_STALE_MS) return null;
  if (hrState.avg != null) return hrState.avg;
  if (hrState.current != null) return hrState.current;
  return null;
}

export function isHRConnected() {
  return hrState.connected;
}

export function hasFreshHRSample() {
  return (
    hrState.connected &&
    hrState.lastAt &&
    Date.now() - hrState.lastAt <= HR_STALE_MS &&
    hrState.current != null
  );
}

export function clearHRBufferForInterval() {
  if (webModule) webModule.clearWebBuffer();
  if (nativeModule) nativeModule.clearNativeBuffer();
  hrState.avg = null;
}

export function setBLEUI(cls, name, status) {
  document.getElementById('ble-row').className = 'ble-row' + (cls ? ' ' + cls : '');
  document.getElementById('ble-dot').className = 'ble-dot' + (cls ? ' ' + cls : '');
  document.getElementById('ble-name').textContent = name;
  document.getElementById('ble-status').textContent = status;
}

export function applyPlatformBLEMode() {
  const info = getPlatformInfo();
  const btn = document.getElementById('ble-btn');
  const name = document.getElementById('ble-name');
  const status = document.getElementById('ble-status');

  if (!btn || !name || !status) return;
  if (hrState.connected) return;

  btn.disabled = false;
  btn.style.opacity = '1';

  if (info.supportsNativeBLE) {
    name.textContent = 'Not Connected';
    status.textContent = 'Manual HR entry will be used unless connected';
    btn.textContent = 'CONNECT';
    return;
  }

  if (info.isIOS && !info.isCapacitor) {
    name.textContent = 'Manual Mode';
    status.textContent = 'iPhone/iPad Safari uses manual HR entry';
    btn.textContent = 'MANUAL';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    return;
  }

  if (!info.supportsWebBLE) {
    name.textContent = 'Manual Mode';
    status.textContent = 'Bluetooth unavailable in this browser';
    btn.textContent = 'MANUAL';
    btn.disabled = true;
    btn.style.opacity = '0.55';
    return;
  }

  name.textContent = 'Not Connected';
  status.textContent = 'Manual HR entry will be used unless connected';
  btn.textContent = 'CONNECT';
}

export async function connectHR() {
  if (hrState.connected) {
    await disconnectHR();
    return;
  }

  const info = getPlatformInfo();

  if (info.supportsNativeBLE && nativeModule) {
    return connectNative();
  }

  if (info.isIOS && !info.isCapacitor) {
    uiHooks?.showToast('IPHONE SAFARI USES MANUAL HR');
    return;
  }

  if (!info.supportsWebBLE || !webModule) {
    uiHooks?.showToast('WEB BLUETOOTH NOT SUPPORTED');
    return;
  }

  return connectWeb();
}

export async function disconnectHR() {
  if (transport === 'native' && nativeModule) {
    await nativeModule.disconnectNativeHR();
    return;
  }
  if (transport === 'web' && webModule) {
    await webModule.disconnectWebHR();
  }
}

function handleConnectError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/cancel|chooser/i.test(msg)) {
    uiHooks?.showToast('CONNECTION CANCELLED');
  } else if (/service/i.test(msg)) {
    uiHooks?.showToast('HR SERVICE NOT FOUND');
  } else {
    uiHooks?.showToast('CONNECTION FAILED -- USE MANUAL HR');
  }
}

async function connectNative() {
  setBLEUI('connecting', 'Searching...', 'Looking for HR monitor');
  document.getElementById('ble-btn').textContent = 'CANCEL';

  try {
    const result = await nativeModule.connectNativeHR();
    setBLEUI('connected', result.name, 'Auto-capture active OK');
    document.getElementById('ble-btn').textContent = 'DISCONNECT';
    uiHooks?.showToast('CONNECTED -- ' + result.name.toUpperCase());
    setHRConnected(result.name, 'native-ble');
  } catch (err) {
    setHRDisconnected();
    applyPlatformBLEMode();
    handleConnectError(err);
  }
}

async function connectWeb() {
  setBLEUI('connecting', 'Searching...', 'Looking for HR monitor');
  document.getElementById('ble-btn').textContent = 'CANCEL';

  try {
    const result = await webModule.connectWebHR();
    setBLEUI('connected', result.name, 'Auto-capture active OK');
    document.getElementById('ble-btn').textContent = 'DISCONNECT';
    uiHooks?.showToast('CONNECTED -- ' + result.name.toUpperCase());
    setHRConnected(result.name, 'web-ble');
  } catch (err) {
    setHRDisconnected();
    applyPlatformBLEMode();
    handleConnectError(err);
  }
}

export function onHRDisconnectUI() {
  setHRDisconnected();
  applyPlatformBLEMode();
  uiHooks?.showToast('HR MONITOR DISCONNECTED -- MANUAL ENTRY ENABLED');
}
