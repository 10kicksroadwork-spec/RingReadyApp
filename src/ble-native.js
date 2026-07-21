import { BleClient } from '@capacitor-community/bluetooth-le';
import {
  HR_SERVICE,
  HR_CHAR,
  parseHeartRateMeasurement,
  createHRBuffer,
} from './ble-adapter.js';
import { HR_STALE_MS } from './constants.js';

const hrBuffer = createHRBuffer(5, HR_STALE_MS);

let connectedDeviceId = null;
let onHRCallback = null;
let initialized = false;

function bytesToDataView(value) {
  if (value instanceof DataView) return value;
  if (Array.isArray(value)) {
    return new DataView(Uint8Array.from(value).buffer);
  }
  if (value && value.buffer) {
    return new DataView(value.buffer);
  }
  throw new Error('Unsupported BLE notification payload');
}

export async function initNativeBLE({ onHR }) {
  onHRCallback = onHR;
  if (!initialized) {
    await BleClient.initialize();
    initialized = true;
  }
}

export async function connectNativeHR() {
  hrBuffer.clear();

  const device = await BleClient.requestDevice({
    services: [HR_SERVICE],
    optionalServices: [HR_SERVICE],
  });

  connectedDeviceId = device.deviceId;

  await BleClient.connect(connectedDeviceId, () => {
    handleDisconnect();
  });

  await BleClient.startNotifications(
    connectedDeviceId,
    HR_SERVICE,
    HR_CHAR,
    (value) => {
      const dataView = bytesToDataView(value);
      const hr = parseHeartRateMeasurement(dataView);
      if (!hr) return;

      hrBuffer.push(hr);

      if (onHRCallback) {
        onHRCallback({
          hr,
          avg: hrBuffer.avgFresh(),
          at: hrBuffer.lastAt() || Date.now(),
          source: 'native-ble',
        });
      }
    }
  );

  return {
    name: device.name || 'HR Monitor',
    id: connectedDeviceId,
    source: 'native-ble',
  };
}

export async function disconnectNativeHR() {
  if (!connectedDeviceId) return;

  try {
    await BleClient.stopNotifications(connectedDeviceId, HR_SERVICE, HR_CHAR);
  } catch (err) {
    console.warn('Could not stop native HR notifications', err);
  }

  try {
    await BleClient.disconnect(connectedDeviceId);
  } catch (err) {
    console.warn('Could not disconnect native HR strap', err);
  }

  handleDisconnect();
}

function handleDisconnect() {
  connectedDeviceId = null;
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

export function clearNativeBuffer() {
  hrBuffer.clear();
}

export function isNativeHRConnected() {
  return !!connectedDeviceId;
}

export function getNativeAvgHR() {
  return hrBuffer.avgFresh();
}
