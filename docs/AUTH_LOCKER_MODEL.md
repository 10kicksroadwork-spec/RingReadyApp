# Auth locker model

RingReady authorization is a **per-athlete locker** model. There is no separate “locker” table or claim — ownership is always `user_id = auth.uid()` under Row Level Security, with a small coach read surface and a proof-RPC write exception.

This document is the Foxtrot stability-phase contract. Do not invent parallel permission shortcuts in client code.

## Roles

| Role | How identified | What they can do |
|------|----------------|------------------|
| **Athlete** | Any authenticated user that is not on the coach allowlist | CRUD **only** rows where `user_id = auth.uid()` (subject to table policies) |
| **Coach** | JWT email in `public.is_coach()` **and** mirrored `COACH_EMAILS` in `src/coach-access.js` | Extra **SELECT** across athlete lockers; write coach-only tables (`coach_notes`, `coach_athlete_meta`, exclusions) |

`athlete_name` is **display metadata**, never an authorization key.

## Athlete locker (RLS)

Canonical migrations enable RLS and own-row policies on:

- `athlete_profiles`, `hr_info` (`000`)
- `workout_completions`, `sprint_sessions`, `mile_tests` (`001`)
- `workout_attachments` (SELECT own; direct INSERT/UPDATE revoked — see proof exception)
- `camp_archives` (own or coach) (`004`)

Client code in `src/auth.js` always scopes queries with the signed-in `user.id`. That is defense in depth on top of RLS, not a replacement for it.

Athletes **cannot**:

- read another athlete’s locker
- write `workout_attachments` directly (table grants + policies revoke authenticated INSERT/UPDATE)
- read coach-only tables

## Coach access

### Database

`scripts/migrations/002_coach_access.sql` defines:

```sql
public.is_coach()  -- JWT email allowlist
```

Coach **SELECT** policies use `using (public.is_coach())` on profiles, HR, completions, sprints, mile tests, and (after `009`) attachments.

`coach_roster_identities()` is **SECURITY DEFINER**: returns `auth.users` id/email **only when** `is_coach()` is true, so the dashboard can hide coach logins from the fighter roster.

Coach-only write surfaces: `coach_notes`, later `coach_athlete_meta` / `coach_roster_exclusions` (`005`).

### Client

`src/coach-access.js` mirrors:

- `COACH_EMAILS` ↔ SQL `is_coach()` emails (must stay identical)
- `ROSTER_EXCLUDED_*` ↔ `scripts/seeds/production-coach-roster-exclusions.sql` (must stay in sync for production)

`isCoachUser()` in `src/auth.js` is UI/routing only. **Database enforcement is RLS + `is_coach()`.** Never grant coach powers by client flag alone.

`loadCoachRosterPayload()` fans out SELECTs. A consolidated `coach_roster_snapshot` RPC is **explicitly deferred** (see comment in `auth.js`). Soft-fail per source is intentional resilience, not a permission bypass.

### Storage vs Drive

Coaches do **not** get Storage SELECT on `workout-proof-staging`. They see attachment **metadata** (and `drive_url` after transfer). Binary coach copies come from Apps Script → private Google Drive using the service account / script identity — never the athlete anon key.

## Proof upload exception (transactional RPCs)

`workout_attachments` is the intentional exception to “athletes write their locker via table DML”:

1. Athlete uploads a blob to Storage under `{auth.uid()}/…`
2. Athlete calls **`create_workout_proof_attachment`** (SECURITY DEFINER)
3. RPC re-checks caller auth, path ownership, mime/size, and **owned linked record + context** (`006` / `016`)
4. Row is inserted/updated as definer; authenticated direct INSERT/UPDATE remain revoked (`003`, `013`)

Related RPCs (also SECURITY DEFINER, ownership-checked):

| RPC | Role |
|-----|------|
| `create_workout_proof_attachment` | Sole path to create/replace current proof rows (`016` idempotent same-path retries) |
| `set_workout_proof_cleared` | Mark proof cleared (`012`) |
| `clear_workout_completion_with_proof` | Transactional completion delete + proof reconcile (`015`) |
| `cleanup_test_workout_proof_attachments` | Layer C / contract cleanup only |
| `archive_and_reset_camp` | Coach clean-slate archive (`004`) |

**Rule:** Do not reintroduce authenticated INSERT/UPDATE policies on `workout_attachments`. Do not let the client pair an arbitrary owned attachment to another workout outside these RPCs.

## Sync relay vs locker auth

```text
Athlete browser  →  JWT  →  /api/sync  →  Apps Script (service)
```

`/api/sync` validates the athlete JWT with the anon key, then forwards to Apps Script with a **server-only** relay secret. That path exports to Sheets / Drive; it does **not** widen Supabase RLS. Service-role / script credentials must never ship in the Vite bundle.

## Logout and account switch

On explicit logout and on `SIGNED_OUT` auth events, the client must:

1. Capture the leaving `user_id` **before** the session is cleared
2. Clear that user’s sync queue + sprint checkpoint
3. Clear **all** shared athlete locker keys (`ATHLETE_SHARED_STORAGE_KEYS` in `src/account-switch.js`)
4. Clear legacy unscoped sync queue + quarantine
5. Reset in-memory week/SC/modality, selected coach athlete, and HR connection state

On Athlete A → Athlete B sign-in, `prepareAccountSwitchSafety()` clears the shared locker when the owner marker differs (or fail-closed when shared data exists with no owner). Per-user queues/checkpoints for B are preserved.

`ringReadyAuthUserId` may remain as the last owner marker for switch detection.

## Adding a coach or exclusion

1. Update `public.is_coach()` in a **new** numbered migration (do not edit history casually on production without a forward migration).
2. Update `COACH_EMAILS` in `src/coach-access.js` in the **same PR**.
3. For roster exclusions: update `scripts/seeds/production-coach-roster-exclusions.sql` **and** `ROSTER_EXCLUDED_*` constants together; apply the seed on production after the auth users exist.
4. Run `tests/auth-locker-model.test.js` (allowlist/exclusion sync gate).

## Out of scope (do not sneak into Foxtrot follow-ups without review)

- Moving coach identity from JWT email to `app_metadata` roles (good long-term; requires coordinated migration)
- Implementing `coach_roster_snapshot`
- Promoting legacy denormalized `athlete_name` columns from `scripts/legacy/` into the canonical chain
- Changing proof upload RPC semantics, SW caching, hydration, completion identity, sprint checkpoint resume rules, or iOS audio recovery (frozen post–Golden Athlete Flow / real-iPhone certification)

## Migration map (auth-touching)

| Migration | Auth relevance |
|-----------|----------------|
| `000`–`001` | Athlete own-row RLS |
| `002` | `is_coach`, coach SELECT, identities RPC, coach notes |
| `003` | Attachment RLS + proof RPC + Storage own policies |
| `004` | Archives RLS + camp reset RPC |
| `005` | Coach meta / exclusions policies |
| `006` | Contextual ownership in proof RPC |
| `009` | Coach attachment SELECT (fixes `002`→`003` order gap) |
| `012`–`013` | Cleared RPC + attachment write revoke harden |
| `015`–`016` | Transactional clear + idempotent proof create |
