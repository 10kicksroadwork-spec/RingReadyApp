# 10 Kicks: Ring Ready

Installable PWA for fight-camp roadwork: sprint intervals, threshold runs, mile tests, workout proof, coach dashboard, and Supabase-backed athlete accounts.

## Architecture (2026)

```text
Athlete PWA  →  Supabase (authoritative)  →  Coach dashboard
                         ↓
              optional Google Sheets export (legacy sync)
```

| Layer | Role |
|-------|------|
| **Athlete app** | Vite PWA — local-first storage, BLE HR, session checkpoint/resume, proof upload |
| **Supabase** | Auth, RLS-scoped athlete data, private proof staging, clean-slate RPC |
| **Coach app** | In-app roster dashboard for coach accounts (live Supabase reads) |
| **Sheets bridge** | Optional `no-cors` dispatch for reporting — not authoritative sync |

## Project layout

```
src/
  app.js                 Sprint session state machine + checkpoint resume
  session-checkpoint.js  Account-scoped in-progress session persistence
  shell.js               Athlete shell, hydration, workout completion
  shell-cloud-merge.js   Timestamp-aware cloud merge helpers
  sync.js                User-scoped Sheets queue + honest delivery states
  auth.js                Supabase auth and cloud CRUD
  coach-preview.js       Coach roster dashboard
  hr-analytics.js        Shared threshold/zone scoring
  proof.js               Workout proof upload
scripts/
  migrations/            Canonical Supabase migration chain (see MIGRATIONS.md)
  legacy/                Deprecated one-off SQL (reference only)
```

## Requirements

- Node.js 20+
- Supabase project with migrations from `scripts/migrations/`
- Optional: Google Apps Script endpoint for Sheets export

## Environment

Copy `.env.example` to `.env.local`:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_RING_READY_SYNC_URL=https://script.google.com/macros/s/.../exec
```

The service-role key must **never** ship in the client bundle.

## Development

```bash
npm install
npm run dev
```

## Quality gates

```bash
npm run lint
npm test
npm run build
```

CI runs the same commands on push/PR (`.github/workflows/ci.yml`).

## Database setup

Run migrations in order — see [scripts/MIGRATIONS.md](scripts/MIGRATIONS.md).

## Native Capacitor (optional)

```bash
npm run cap:sync
npm run cap:ios      # macOS + Xcode
npm run cap:android  # Android Studio
```

Native builds improve BLE on iOS; the PWA remains the primary distribution path.

## App ID

- Bundle ID: `com.tenkicks.roadwork`
- Display name: `10 Kicks: Ring Ready`
