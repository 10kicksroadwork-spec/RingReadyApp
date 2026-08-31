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

export function getHRMonitorSetupCopy() {
  const info = getPlatformInfo();
  if (info.isNativeApp) {
    return 'Optional. Works with most BLE chest straps. ANT+ is not supported. Manual HR entry is always available.';
  }
  return 'Optional. Works with most BLE chest straps. ANT+ is not supported. On iPhone/iPad, use the Bluefy browser for BLE support; manual HR entry is always available.';
}

export function getSprintHRMonitorDisclaimer() {
  return 'For auto HR capture, connect your chest strap here only. Disconnect it from Wahoo, Strava, or other fitness apps first — most straps can only talk to one app at a time.';
}
