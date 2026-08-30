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

## 4b. Coach dashboard access

Run this third SQL file so Gene and Daniel can open the in-app coach roster and see every fighter who logs in the PWA:

```text
scripts/supabase-coach-access.sql
```

Until that file is run, coaches will sign in but the roster will be empty (or show a permission error). Gene (`gene.byard@gmail.com`) and Daniel (`10kicksroadwork@gmail.com`) both see every fighter with a Ring Ready account and can both write the shared coach note. Athletes are unchanged: they still only see their own data. The Google Sheets dashboard can stay in use for deeper charts.

If a coach account was created with **Add user** and cannot sign in on a new device, run `scripts/supabase-set-coach-password.sql` after replacing the password placeholder.

Password reset from the app sign-in screen uses Supabase Auth email links. In Supabase → Authentication → URL Configuration, set **Site URL** to `https://ring-ready-app.vercel.app` and add that same origin under **Redirect URLs** so “Forgot password?” links open the app’s set-new-password screen.

## 4c. Coach roster exclusions

Run this after the coach access script to hide specific test or personal fighter accounts from the coach roster:

```text
scripts/supabase-coach-roster-exclusions.sql
```

That creates `coach_roster_exclusions` and currently hides:

- `d.a.friend108@gmail.com` — Daniel's athlete-side test account
- `kellimbergmann@gmail.com` — Kelli Bergmann
- `ryankfisch@gmail.com` — Ryan Fisch
- `simonbhyard@gmail.com` — Simon Byard

To hide someone else later, insert another row into `coach_roster_exclusions` with their auth `user_id`.

## 4d. Coach camp start dates

Run this so coaches can set when each fighter's roadwork begins:

```text
scripts/supabase-coach-camp-start.sql
```

On the athlete detail screen, set a start date (for example `2026-08-24`). Missing-workout flags then follow the program calendar: Week 1 Monday is the start date, Tuesday is the next day, and so on. Sessions that have not reached their day yet stay off the missing list.

## 4e. Athlete default modality

Run this so profiles can store a camp default modality (Running by default):

```text
scripts/supabase-athlete-default-modality.sql
```

Athletes can change Default Modality on their profile. Anything other than running should be coach-approved before camp starts. Until this SQL runs, local profile saves still work; cloud profile saves with a non-default modality may fail.

## 4f. Clean slate (archive camp + reset)

Run this so athletes and coaches can archive a finished camp and clear live workouts for the next one:

```text
scripts/supabase-camp-clean-slate.sql
```

That creates `camp_archives`, adds `camp_reset_at` on profiles, and the `archive_and_reset_camp` RPC. Profile → **Start New Camp (Clean Slate)** archives then clears workouts (keeps name + HR). Coaches can also run it from an athlete’s detail screen. Until this SQL runs, the buttons will fail with a database error.

## 5. Private workout proof

Run this second migration in Supabase SQL Editor:

```text
scripts/supabase-workout-proof.sql
```

It creates the private staging bucket, attachment records and RLS policies, then adds proof fields to workout, sprint and Mile Test records. Do not make the bucket public.

If proof uploads fail on iPhone with a MIME type error, also run:

```text
scripts/supabase-workout-proof-mime-fix.sql
```

That allows JPEG and PNG in the staging bucket (iOS Safari cannot encode WebP from canvas).

Add `scripts/RingReadyWorkoutProof.gs` as a new file in the existing master-sheet Apps Script project. Keep the existing receiver and legacy extraction functions. In the current `doPost` dispatcher, pass proof events to the add-on:

```js
if (payload.eventType === 'workout_proof') {
  rrHandleWorkoutProofEvent(payload);
}
```

In Apps Script Project Settings, create these Script Properties:

```text
RING_READY_SUPABASE_URL
RING_READY_SUPABASE_SERVICE_ROLE_KEY
RING_READY_DRIVE_ROOT_FOLDER_ID
```

The URL is the Supabase project URL. The service-role key belongs only in Apps Script Properties; never put it in GitHub, Vercel or a `VITE_` variable. Create a private Drive folder named `Ring Ready Workout Proof` and use the folder ID from its URL.

Run this once from Apps Script and approve its permissions:

```js
rrSetupWorkoutProofs()
```

That creates the audit tab, adds coach-facing proof columns and installs the 15-minute retry trigger. Redeploy the existing Apps Script web app afterward so the new `workout_proof` handler is live.

To retry missed transfers manually:

```js
rrSyncPendingWorkoutProofs()
```
