# Ring Ready Backend Setup

The PWA now queues four backend event types:

- `profile_update`
- `hr_info_update`
- `mile_test`
- `sprint_session`

## 1. Add the Apps Script receiver

Copy `Updated 7 Week with Mile Test/Master Code/RingReadyWebApp.gs` into the Apps Script project bound to the coach/master Google Sheet.

In Apps Script, run:

```js
rrSetupBackendSheets()
```

That creates or verifies the receiver tabs and the `Athlete Raw Data` bridge headers:

- `Ring Ready Raw Events`
- `Ring Ready Sprint Sessions`
- `Ring Ready Sprint Reps`
- `Ring Ready Mile Tests`
- `Ring Ready Profiles`
- `Ring Ready HR Info`
- `Athlete Raw Data` bridge rows for sprint sessions and mile tests

Optional quick test from Apps Script. This writes a test receiver event and a compatible `Athlete Raw Data` row:

```js
rrTestBackendReceiver()
```


If `Athlete Raw Data` is rebuilt by older extraction tools and the PWA rows disappear, run this from Apps Script to re-import all stored PWA sprint/mile events without duplicating rows:

```js
rrImportPwaReceiverToAthleteRawData()
```
## 2. Deploy as a Google Web App

In Apps Script:

1. Deploy > New deployment
2. Type: Web app
3. Execute as: Me
4. Who has access: Anyone with the link
5. Copy the `/exec` web app URL

## 3. Connect the PWA to that URL

For a build-time connection, set this Vite env var before building/deploying:

```bash
VITE_RING_READY_SYNC_URL="https://script.google.com/macros/s/.../exec"
```

For a no-code/test connection, open the PWA once with this query parameter:

```text
https://your-pwa-url.com/?syncUrl=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2F...%2Fexec
```

The app stores that endpoint locally, removes the query string from the address bar, and future saves will sync to the Sheet.

To clear the stored endpoint on a device:

```text
https://your-pwa-url.com/?clearSyncUrl=1
```

## Notes

The PWA still saves locally first. If the athlete is offline or the endpoint is not connected, the data stays in the local queue and can sync later.

Because Google Apps Script web apps do not provide normal browser CORS responses, the PWA sends requests in `no-cors` mode. That means the app can confirm the browser accepted the send, while the receiver tabs are the source of truth that the Sheet wrote the data.
## 4. Supabase workout data

After creating the Supabase tables, run this SQL file in Supabase SQL Editor before testing cloud workout history:

```text
scripts/supabase-workout-data.sql
```

It adds the workout completion, sprint session, and Mile Test columns used by the app, plus the indexes and RLS policies needed for each athlete to only read and write their own rows.