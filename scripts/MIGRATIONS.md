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

## Fresh database

Paste and run each file in the Supabase SQL editor in order (000 through 005).

## Upgrade from existing production

These migrations use `if not exists` / `drop policy if exists` patterns and are safe to re-run. Skip steps already applied if tables and policies exist.

## Deploy order (proof + Sheets)

1. Supabase migration 003 (atomic RPC)
2. Production Apps Script receiver + proof handler
3. Compatible client deployment

## Legacy scripts

Older ad-hoc files live in [../legacy/](../legacy/) for reference only.
