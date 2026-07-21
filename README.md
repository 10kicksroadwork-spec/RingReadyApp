# 10 Kicks Roadwork -- Capacitor App (Phase 2)

Native iOS/Android wrapper for the Sprint Session trainer. The standalone web/PWA version remains at `../sprint-trainer.html`.

## Project layout

```
Sprint Tracker/
  sprint-trainer.html     <- standalone web/PWA (Phase 1)
  sprint-trainer/         <- this Capacitor + Vite project
    src/
      main.js             <- boot, event wiring, HR transport init
      app.js              <- session flow (same behavior as Phase 1)
      ui.js               <- DOM, toast, audio, ring
      workout.js          <- HR validation, rest copy, stats
      platform.js         <- Capacitor vs web BLE routing
      hr-service.js       <- HR facade (connect, capture, stale checks)
      ble-web.js          <- Web Bluetooth (Android/desktop)
      ble-native.js       <- @capacitor-community/bluetooth-le (iOS/Android app)
      ble-adapter.js      <- UUIDs, HR parsing, buffer
      storage.js          <- localStorage history
      constants.js
    ios/ android/         <- native projects (after cap add)
```

## Requirements

- Node.js 18+
- For iOS builds: macOS with Xcode
- For Android builds: Android Studio

## Web dev (browser)

From this folder:

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Web Bluetooth works on Android Chrome and desktop Chromium -- not iPhone Safari.

## Production web build

```bash
npm run build
npm run preview
```

Output goes to `dist/`.

### Windows path note

If the project lives under a path with an apostrophe (e.g. `P&C's`), `npm run` may fail because of broken `.cmd` shims. Scripts in `package.json` call Vite/Capacitor via `node node_modules/...` directly to avoid that. If issues persist, map a drive letter:

```bat
subst Z: "e:\P&C's\Coding Projects\10 Kicks App\Updated 7 Week with Mile Test\Sprint Tracker\sprint-trainer"
Z:
npm run build
```

## Native app workflow

1. Build web assets and sync to native projects:

   ```bash
   npm run cap:sync
   ```

2. Open in IDE:

   ```bash
   npm run cap:ios      # Xcode (Mac only)
   npm run cap:android  # Android Studio
   ```

3. Run on a physical device (recommended for BLE). Connect a chest strap from the setup screen -- native BLE is enabled automatically in the Capacitor app on iOS and Android.

## BLE behavior by platform

| Platform | BLE |
|----------|-----|
| Capacitor iOS/Android app | Native BLE via `@capacitor-community/bluetooth-le` |
| Android Chrome (web) | Web Bluetooth |
| Desktop Chrome/Edge | Web Bluetooth |
| iPhone/iPad Safari | Manual HR entry only |

## Sync CSS from Phase 1 HTML

If you change styles in `../sprint-trainer.html`:

```bash
npm run extract-css
npm run build
```

## Permissions (already configured)

- **iOS** `Info.plist`: `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`
- **Android** `AndroidManifest.xml`: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`

## App ID

- Bundle ID: `com.tenkicks.roadwork`
- Display name: `10 Kicks Roadwork`
## PWA-first direction

The main athlete-facing product is now **10 Kicks: Ring Ready**, an installable Progressive Web App. The Android and iOS Capacitor projects can stay available later for native BLE improvements, but the PWA is the primary path for sharing the app by link and Add to Home Screen.

Completed sessions are saved locally first and added to an offline sync queue. When the Google Apps Script endpoint is ready, set it at build time with:

```bash
VITE_RING_READY_SYNC_URL="https://script.google.com/macros/s/.../exec" npm run build
```

The submitted payload is designed for a master-sheet intake tab such as `Ring Ready Submissions`, which can then be merged into the existing `Athlete Raw Data` pipeline.
