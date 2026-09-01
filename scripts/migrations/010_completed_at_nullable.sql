-- Allow provisional proof-staging rows without a completion timestamp.
-- Run after scripts/migrations/007_proof_pending.sql
--
-- Some production databases were created with completed_at NOT NULL DEFAULT now(),
-- which breaks ensureCloudWorkoutIdentity inserts that intentionally use null.

alter table public.workout_completions
  alter column completed_at drop not null;

alter table public.workout_completions
  alter column completed_at drop default;
