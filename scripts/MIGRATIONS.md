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

## Fresh database

Paste and run each file in the Supabase SQL editor in order (000 through 007).

## Upgrade from existing production

These migrations use `if not exists` / `drop policy if exists` patterns and are safe to re-run. Skip steps already applied if tables and policies exist.

## Deploy order (proof + Sheets)

1. Supabase migrations 003 and 006 (atomic RPC + client record identity validation)
2. Production Apps Script receiver + proof handler
3. Compatible client deployment

## Production seeds

Canonical migrations 000–007 are schema-only. Environment-specific data lives under [../seeds/](../seeds/), e.g. [production-coach-roster-exclusions.sql](../seeds/production-coach-roster-exclusions.sql) (run after auth users exist).

## Deploy gate: proof authorization

```bash
RING_READY_REQUIRE_PROOF_TESTS=1 npm run test:proof-auth
```

Requires `RING_READY_SUPABASE_URL`, `RING_READY_SUPABASE_ANON_KEY`, `RING_READY_TEST_EMAIL`, and `RING_READY_TEST_PASSWORD`. Without credentials the script skips unless `RING_READY_REQUIRE_PROOF_TESTS=1` is set (then it fails).

## Legacy scripts

Older ad-hoc files live in [../legacy/](../legacy/) for reference only.
