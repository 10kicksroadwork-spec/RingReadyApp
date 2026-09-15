-- Ring Ready coach notification acknowledgement watermark
-- Run after scripts/migrations/005_roster_meta.sql (coach_athlete_meta).
--
-- Lets coaches mark current athlete alerts as reviewed without deleting or
-- mutating workout completions, proof attachments, or HR values.
--
-- Client contract: notifications_cleared_at is a watermark, not an ignore
-- switch. An alert is ACTIVE only when its source event is newer than this
-- timestamp (or when the watermark is null). Editing an old completion after
-- acknowledgement must re-surface via updated_at.
--
-- Existing coach-only RLS on coach_athlete_meta (SELECT/INSERT/UPDATE via
-- public.is_coach()) covers these columns. Athletes cannot read or write them.
-- Backward compatible: both columns are nullable with no default rewrite.

alter table public.coach_athlete_meta
  add column if not exists notifications_cleared_at timestamptz;

alter table public.coach_athlete_meta
  add column if not exists notifications_cleared_by uuid references auth.users(id);

comment on column public.coach_athlete_meta.notifications_cleared_at is
  'Watermark: coach-reviewed alerts at or before this instant. New or edited issues after this remain active.';

comment on column public.coach_athlete_meta.notifications_cleared_by is
  'auth.users.id of the coach who last set notifications_cleared_at.';
