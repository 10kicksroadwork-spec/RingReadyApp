# Supabase migrations

Run these **in order** on a fresh or partially migrated project. Do not run files under `scripts/legacy/`.

| Order | File | Purpose |
|------:|------|---------|
| 1 | [001_baseline.sql](./migrations/001_baseline.sql) | Workout tables, RLS, `mile_tests.test_key` |
| 2 | [002_coach_access.sql](./migrations/002_coach_access.sql) | Coach read policies and roster RPC |
| 3 | [003_workout_proof.sql](./migrations/003_workout_proof.sql) | Proof bucket, attachments, proof RPCs |
| 4 | [004_camp_reset.sql](./migrations/004_camp_reset.sql) | Clean slate archive RPC |
| 5 | [005_roster_meta.sql](./migrations/005_roster_meta.sql) | Camp start, exclusions, athlete modality |

## Fresh database

Paste and run each file in the Supabase SQL editor in order.

## Upgrade from existing production

These migrations use `if not exists` / `drop policy if exists` patterns and are safe to re-run. Skip steps already applied if tables and policies exist.

## Legacy scripts

Older ad-hoc files live in [../legacy/](../legacy/) for reference only.
