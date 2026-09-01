-- Align legacy production mile_tests constraints with the canonical
-- proof-staging contract used by buildProvisionalMileTestCloudPayload().
--
-- Run after scripts/migrations/010_completed_at_nullable.sql
--
-- Provisional mile-test identity rows intentionally contain:
--   saved_at      = null
--   distance      = null
--   total_minutes = null

alter table public.mile_tests
  alter column saved_at drop not null;

alter table public.mile_tests
  alter column saved_at drop default;

alter table public.mile_tests
  alter column distance drop not null;

alter table public.mile_tests
  alter column distance drop default;

alter table public.mile_tests
  alter column total_minutes drop not null;

alter table public.mile_tests
  alter column total_minutes drop default;
