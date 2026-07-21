import {
  HR_SERVICE_NUM,
  HR_CHAR_NUM,
  parseHeartRateMeasurement,
  createHRBuffer,
} from './ble-adapter.js';
import { HR_STALE_MS } from './constants.js';

const hrBuffer = createHRBuffer(5, HR_STALE_MS);

let device = null;
let server = null;
let characteristic = null;
let connected = false;
let onHRCallback = null;

export function initWebBLE({ onHR }) {
  onHRCallback = onHR;
}

export function webBLESupported() {
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !!navigator.bluetooth && !isIOS;
}

export async function connectWebHR() {
  if (!webBLESupported()) {
    throw new Error('Web Bluetooth is not supported on this platform');
  }

  hrBuffer.clear();

  device = await navigator.bluetooth.requestDevice({
    filters: [
      { services: [HR_SERVICE_NUM] },
      { namePrefix: 'Polar' },
      { namePrefix: 'Wahoo' },
      { namePrefix: 'Garmin' },
      { namePrefix: 'COOSPO' },
      { namePrefix: 'Coospo' },
      { namePrefix: 'Magene' },
      { namePrefix: 'HRM' },
      { namePrefix: 'TICKR' },
    ],
    optionalServices: [HR_SERVICE_NUM],
  });

  device.addEventListener('gattserverdisconnected', handleDisconnect);

  server = await device.gatt.connect();
  const service = await server.getPrimaryService(HR_SERVICE_NUM);
  characteristic = await service.getCharacteristic(HR_CHAR_NUM);
  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', onCharacteristic);

  connected = true;

  return {
    name: device.name || 'HR Monitor',
    source: 'web-ble',
  };
}

export async function disconnectWebHR() {
  try {
    if (device && device.gatt && device.gatt.connected) {
      device.gatt.disconnect();
      return;
    }
  } catch (err) {
    console.warn('Could not disconnect Web BLE device', err);
  }
  handleDisconnect();
}

function onCharacteristic(event) {
  const hr = parseHeartRateMeasurement(event.target.value);
  if (!hr) return;

  hrBuffer.push(hr);
  connected = true;

  if (onHRCallback) {
    onHRCallback({
      hr,
      avg: hrBuffer.avgFresh(),
      at: hrBuffer.lastAt() || Date.now(),
      source: 'web-ble',
    });
  }
}

function handleDisconnect() {
  connected = false;
  device = null;
  server = null;
  characteristic = null;
  hrBuffer.clear();

  if (onHRCallback) {
    onHRCallback({
      hr: null,
      avg: null,
      at: Date.now(),
      source: 'manual',
      disconnected: true,
    });
  }
}

export function clearWebBuffer() {
  hrBuffer.clear();
}

export function isWebHRConnected() {
  return connected;
}

export function getWebAvgHR() {
  return hrBuffer.avgFresh();
}
