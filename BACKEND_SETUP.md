# Ring Ready Backend Setup

The PWA queues backend event types through an authenticated relay in production:

```text
Athlete browser  →  JWT  →  /api/sync  →  shared server secret  →  Apps Script
```

Direct browser → Apps Script (`no-cors`, `VITE_RING_READY_SYNC_URL`, `?syncUrl=`) is **deprecated** for production.

## Auth vs relay

Athletes and coaches talk to Supabase with the **anon key + user JWT**. Row access is enforced by the locker-model RLS policies (see [docs/AUTH_LOCKER_MODEL.md](docs/AUTH_LOCKER_MODEL.md)). The `/api/sync` relay only validates that JWT and forwards export/proof-transfer events to Apps Script with a **server-only** secret — it does not widen Supabase permissions. Apps Script uses privileged credentials solely for Sheets/Drive proof copy, never from the browser bundle.

## Event types

- `profile_update`
- `hr_info_update`
- `mile_test`
- `sprint_session`
- `daily_workout`
- `workout_proof`

## 1. Add the Apps Script receiver

Copy `scripts/RingReadyWebApp.gs` and `scripts/RingReadyWorkoutProof.gs` into the Apps Script project bound to the coach/master Google Sheet.

In Apps Script, run:

```js
rrSetupBackendSheets()
rrSetupWorkoutProofs()
```

That creates or verifies receiver tabs, coach-facing proof columns, and the 15-minute proof retry trigger.

Optional quick test from Apps Script:

```js
rrTestBackendReceiver()
```

If `Athlete Raw Data` is rebuilt by older extraction tools and PWA rows disappear, run:

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

Store this URL **server-side only** — do not expose it in `VITE_*` variables.

## 3. Configure the authenticated relay (production)

### Vercel server environment

```text
RING_READY_APPS_SCRIPT_SYNC_URL=https://script.google.com/macros/s/.../exec
RING_READY_SYNC_RELAY_SECRET=<shared-secret>
RING_READY_SUPABASE_URL=https://your-project.supabase.co
RING_READY_SUPABASE_ANON_KEY=<anon-key>
```

### Apps Script Script Properties

```text
RING_READY_SUPABASE_URL
RING_READY_SUPABASE_SERVICE_ROLE_KEY
RING_READY_DRIVE_ROOT_FOLDER_ID
RING_READY_SYNC_RELAY_SECRET
```

`RING_READY_SYNC_RELAY_SECRET` must match the Vercel value. The relay rejects requests without it.

### Athlete client (production)

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Do **not** set `VITE_RING_READY_SYNC_URL` in production. The client posts to `/api/sync`, which validates the athlete JWT and forwards to Apps Script with the relay secret.

## 4. Supabase database migrations

Follow the **canonical ordered migrations** in [`scripts/MIGRATIONS.md`](scripts/MIGRATIONS.md). Run each file in the Supabase SQL editor in order on a fresh or partially migrated project.

Do **not** run deprecated one-off scripts under `scripts/legacy/` or root `scripts/supabase-*.sql` on production.

Environment-specific seed data lives under [`scripts/seeds/`](scripts/seeds/) and runs after auth users exist.

### Deploy gate (before client deploy)

```bash
npm run lint
npm test
npm run build
RING_READY_REQUIRE_PROOF_TESTS=1 npm run test:proof-auth
```

Requires `RING_READY_SUPABASE_URL`, `RING_READY_SUPABASE_ANON_KEY`, `RING_READY_TEST_EMAIL`, and `RING_READY_TEST_PASSWORD` in the GitHub Environment `production-contract`. Missing credentials **fail** the gate.

### Branch protection

Protect `main`: PR required, `quality` status check required, block force push and branch deletion.

If a coach account was created with **Add user** and cannot sign in on a new device, see [`scripts/legacy/supabase-set-coach-password.sql`](scripts/legacy/supabase-set-coach-password.sql).

Password reset uses Supabase Auth email links. In Supabase → Authentication → URL Configuration, set **Site URL** to `https://ring-ready-app.vercel.app` and add that origin under **Redirect URLs**.

## 5. Private workout proof (Apps Script)

In the `doPost` dispatcher:

```js
if (payload.eventType === 'workout_proof') {
  rrHandleWorkoutProofEvent(payload);
}
```

Relay-triggered proof transfers require `payload.userId` (set by `/api/sync` from the athlete JWT) and bind attachment lookup to that user. Completed proofs are idempotent on replay — a lost acknowledgement does not downgrade a successful transfer.

Create a private Drive folder named `Ring Ready Workout Proof` and use its ID for `RING_READY_DRIVE_ROOT_FOLDER_ID`.

To retry missed transfers manually:

```js
rrSyncPendingWorkoutProofs()
```

Redeploy the Apps Script web app after updating proof handlers.
