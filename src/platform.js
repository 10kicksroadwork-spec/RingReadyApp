export const IOS_MANUAL_HR_MESSAGE =
  "Bluetooth heart-rate connection isn't supported on iPhone right now. Use Manual HR instead.";

export const IOS_MANUAL_HR_STATUS = 'Manual HR is the supported iPhone option.';

export const IOS_MANUAL_HR_SETUP_COPY =
  `${IOS_MANUAL_HR_MESSAGE} Your workout can be completed normally using Manual HR.`;

export const HR_MONITOR_OPTIONAL_COPY =
  'Optional. Works with most BLE chest straps. ANT+ is not supported. Manual HR entry is always available.';

export function getPlatformInfo() {
  const ua = navigator.userAgent || '';

  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isAndroid = /Android/i.test(ua);

  const isCapacitor =
    !!window.Capacitor &&
    typeof window.Capacitor.getPlatform === 'function';

  const capacitorPlatform = isCapacitor
    ? window.Capacitor.getPlatform()
    : 'web';

  const hasWebBluetooth = !!navigator.bluetooth;

  return {
    isIOS,
    isAndroid,
    isCapacitor,
    capacitorPlatform,
    hasWebBluetooth,
    supportsWebBLE: hasWebBluetooth && !isCapacitor,
    supportsNativeBLE: isCapacitor && ['ios', 'android'].includes(capacitorPlatform),
    isNativeApp: isCapacitor && ['ios', 'android'].includes(capacitorPlatform),
  };
}

/** Reuses getPlatformInfo().isIOS — do not add a second UA sniffer. */
export function isIOSDevice(info = getPlatformInfo()) {
  return !!info.isIOS;
}

/**
 * iPhone/iPad web surfaces use Manual HR. Native Capacitor BLE stays available.
 */
export function isIOSWebBluetoothBlocked(info = getPlatformInfo()) {
  return isIOSDevice(info) && !info.supportsNativeBLE;
}

export function getHRMonitorSetupCopy() {
  const info = getPlatformInfo();
  if (isIOSWebBluetoothBlocked(info)) {
    return IOS_MANUAL_HR_SETUP_COPY;
  }
  return HR_MONITOR_OPTIONAL_COPY;
}

export function getSprintHRMonitorDisclaimer() {
  return 'Disconnect your chest strap from Wahoo, Strava, or other fitness apps first. Most straps can only connect to one app at a time.';
}
