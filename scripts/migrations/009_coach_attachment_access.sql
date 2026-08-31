-- Ring Ready
-- 009_coach_attachment_access.sql
--
-- Ensures coach accounts can read workout_attachments.
--
-- Required because 002_coach_access.sql runs before
-- 003_workout_proof.sql creates workout_attachments, so the conditional
-- coach policy in migration 002 may never be created.
--
-- Safe to run repeatedly.
-- Run after 008_backfill_sprint_proof_links.sql.

alter table public.workout_attachments enable row level security;

grant select
on table public.workout_attachments
to authenticated;

drop policy if exists workout_attachments_select_coach
on public.workout_attachments;

create policy workout_attachments_select_coach
on public.workout_attachments
for select
to authenticated
using (public.is_coach());

comment on policy workout_attachments_select_coach
on public.workout_attachments
is 'Allows authenticated Ring Ready coach accounts to read athlete workout proof metadata.';
