# Supabase migrations

Run these **in order** on a fresh or partially migrated project. Do not run files under `scripts/legacy/` or root `scripts/supabase-*.sql` (deprecated copies live in `scripts/legacy/`).

| Order | File | Purpose |
|------:|------|---------|
| 1 | [000_core_schema.sql](./migrations/000_core_schema.sql) | CREATE TABLE + athlete RLS on profiles and HR |
| 2 | [001_workout_data.sql](./migrations/001_workout_data.sql) | Workout columns, indexes, workout-table RLS |
| 3 | [002_coach_access.sql](./migrations/002_coach_access.sql) | Coach read policies and roster RPC |
| 4 | [003_workout_proof.sql](./migrations/003_workout_proof.sql) | Proof bucket, atomic attachment RPC |
| 5 | [004_camp_reset.sql](./migrations/004_camp_reset.sql) | Clean slate archive RPC |
| 6 | [005_roster_meta.sql](./migrations/005_roster_meta.sql) | Camp start, exclusions, athlete modality |
| 7 | [006_client_record_ids.sql](./migrations/006_client_record_ids.sql) | Client record IDs + contextual proof RPC |
| 8 | [007_proof_pending.sql](./migrations/007_proof_pending.sql) | Pending-proof staging flag + test cleanup RPC |
| 9 | [008_backfill_sprint_proof_links.sql](./migrations/008_backfill_sprint_proof_links.sql) | Backfill sprint attachment_id from current proofs |
| 10 | [009_coach_attachment_access.sql](./migrations/009_coach_attachment_access.sql) | Coach SELECT on workout_attachments (fixes 002→003 ordering gap) |
| 11 | [010_completed_at_nullable.sql](./migrations/010_completed_at_nullable.sql) | Allow null `completed_at` for pending-proof staging rows |
| 12 | [011_mile_test_staging_nullable.sql](./migrations/011_mile_test_staging_nullable.sql) | Allow null `saved_at`/`distance`/`total_minutes` for mile-test staging |
| 13 | [012_set_workout_proof_cleared.sql](./migrations/012_set_workout_proof_cleared.sql) | Reconcile `set_workout_proof_cleared` RPC on legacy production |
| 14 | [013_attachment_write_revoke.sql](./migrations/013_attachment_write_revoke.sql) | Revoke direct authenticated INSERT/UPDATE on workout_attachments |
| 15 | [014_workout_modality_output.sql](./migrations/014_workout_modality_output.sql) | First-class modality/output/watts columns on workout_completions |
| 16 | [015_clear_workout_completion_with_proof.sql](./migrations/015_clear_workout_completion_with_proof.sql) | Transactional completion clear + proof attachment reconcile RPC |

## Fresh database

Paste and run each file in the Supabase SQL editor in order. Follow this table for the current canonical sequence.

## Upgrade from existing production

These migrations use `if not exists` / `drop policy if exists` patterns and are safe to re-run. Skip steps already applied if tables and policies exist.

For the Sprint proof-gap hotfix on an existing database that already ran 000–007, run **008** then **009** in the Supabase SQL editor before deploying the coach hotfix client.

## Production deployment procedure

1. Apply Supabase migrations **000–015** in the table above (required through attachment write revoke, modality output columns, and transactional clear RPC).
2. Configure production Apps Script Script Property `RING_READY_SYNC_RELAY_SECRET` matching the Vercel relay environment.
3. Deploy the compatible client to Vercel with client-side:
   - `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
4. Configure server-only Vercel env for the authenticated relay:
   - `RING_READY_APPS_SCRIPT_SYNC_URL` (Apps Script `/exec` URL — **not** exposed to the browser)
   - `RING_READY_SYNC_RELAY_SECRET`
   - `RING_READY_SUPABASE_URL` / `RING_READY_SUPABASE_ANON_KEY` (JWT validation for `/api/sync`)
5. Run the extended live proof contract gate (see below) against production credentials **before promoting production**.
6. GitHub merge gate: require the **quality** job on PRs to `main`.
7. Production deploy gate: require **production-contract** to pass on `main` before Vercel promotes production (configure Vercel to wait for this check — it intentionally does not run on PR branches).
8. Protect `main`: PR required, status checks required, no force push, no branch deletion.

## Production seeds

Canonical migrations are schema-only. This file is the source of truth for migration order. Environment-specific data lives under [../seeds/](../seeds/), e.g. [production-coach-roster-exclusions.sql](../seeds/production-coach-roster-exclusions.sql) (run after auth users exist).

## Deploy gate: production contract

```bash
RING_READY_REQUIRE_PROOF_TESTS=1 npm run test:proof-auth
```

Verifies proof authorization **and** migrations **014** (modality/output columns) and **015** (transactional clear RPC).

Requires `RING_READY_SUPABASE_URL`, `RING_READY_SUPABASE_ANON_KEY`, `RING_READY_TEST_EMAIL`, and `RING_READY_TEST_PASSWORD`. Without credentials the script skips unless `RING_READY_REQUIRE_PROOF_TESTS=1` is set (then it fails).

This job is a **production deploy gate**, not a PR merge gate. Configure Vercel production promotion to depend on it passing on `main`.

## Legacy scripts

Older ad-hoc files live in [../legacy/](../legacy/) for reference only.
