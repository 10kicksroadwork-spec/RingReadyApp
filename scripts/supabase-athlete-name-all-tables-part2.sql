-- Part 2 of 2: columns, triggers, backfill (plain SQL — no DO blocks).
-- Run after scripts/supabase-athlete-name-all-tables-part1.sql
-- Skip any block below if that table does not exist in your project yet.

alter table public.workout_attachments add column if not exists athlete_name text not null default '';
drop trigger if exists workout_attachments_set_athlete_name_trg on public.workout_attachments;
create trigger workout_attachments_set_athlete_name_trg before insert or update of user_id on public.workout_attachments for each row execute function public.trg_set_athlete_name_from_user_id();
update public.workout_attachments set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.workout_completions add column if not exists athlete_name text not null default '';
drop trigger if exists workout_completions_set_athlete_name_trg on public.workout_completions;
create trigger workout_completions_set_athlete_name_trg before insert or update of user_id on public.workout_completions for each row execute function public.trg_set_athlete_name_from_user_id();
update public.workout_completions set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.sprint_sessions add column if not exists athlete_name text not null default '';
drop trigger if exists sprint_sessions_set_athlete_name_trg on public.sprint_sessions;
create trigger sprint_sessions_set_athlete_name_trg before insert or update of user_id on public.sprint_sessions for each row execute function public.trg_set_athlete_name_from_user_id();
update public.sprint_sessions set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.mile_tests add column if not exists athlete_name text not null default '';
drop trigger if exists mile_tests_set_athlete_name_trg on public.mile_tests;
create trigger mile_tests_set_athlete_name_trg before insert or update of user_id on public.mile_tests for each row execute function public.trg_set_athlete_name_from_user_id();
update public.mile_tests set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.hr_info add column if not exists athlete_name text not null default '';
drop trigger if exists hr_info_set_athlete_name_trg on public.hr_info;
create trigger hr_info_set_athlete_name_trg before insert or update of user_id on public.hr_info for each row execute function public.trg_set_athlete_name_from_user_id();
update public.hr_info set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.camp_archives add column if not exists athlete_name text not null default '';
drop trigger if exists camp_archives_set_athlete_name_trg on public.camp_archives;
create trigger camp_archives_set_athlete_name_trg before insert or update of user_id on public.camp_archives for each row execute function public.trg_set_athlete_name_from_user_id();
update public.camp_archives set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.coach_roster_exclusions add column if not exists athlete_name text not null default '';
drop trigger if exists coach_roster_exclusions_set_athlete_name_trg on public.coach_roster_exclusions;
create trigger coach_roster_exclusions_set_athlete_name_trg before insert or update of user_id on public.coach_roster_exclusions for each row execute function public.trg_set_athlete_name_from_user_id();
update public.coach_roster_exclusions set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.coach_notes add column if not exists athlete_name text not null default '';
drop trigger if exists coach_notes_set_athlete_name_trg on public.coach_notes;
create trigger coach_notes_set_athlete_name_trg before insert or update of athlete_user_id on public.coach_notes for each row execute function public.trg_set_athlete_name_from_athlete_user_id();
update public.coach_notes set athlete_name = public.resolve_athlete_display_name(athlete_user_id) where coalesce(trim(athlete_name), '') = '';

alter table public.coach_athlete_meta add column if not exists athlete_name text not null default '';
drop trigger if exists coach_athlete_meta_set_athlete_name_trg on public.coach_athlete_meta;
create trigger coach_athlete_meta_set_athlete_name_trg before insert or update of athlete_user_id on public.coach_athlete_meta for each row execute function public.trg_set_athlete_name_from_athlete_user_id();
update public.coach_athlete_meta set athlete_name = public.resolve_athlete_display_name(athlete_user_id) where coalesce(trim(athlete_name), '') = '';

create or replace view public.workout_attachments_with_athlete
with (security_invoker = true)
as
select
  wa.athlete_name,
  lower(u.email::text) as athlete_email,
  wa.id,
  wa.user_id,
  wa.proof_key,
  wa.workout_type,
  case when wa.week_index is null then 'Mile Test' else 'Week ' || (wa.week_index + 1)::text end as week_label,
  wa.week_index,
  wa.workout_index,
  wa.day_of_week,
  wa.original_filename,
  wa.mime_type,
  wa.file_size,
  wa.transfer_status,
  wa.drive_url,
  wa.is_current,
  wa.completion_cleared,
  wa.uploaded_at,
  wa.transferred_at,
  wa.storage_path,
  wa.linked_record_id,
  wa.created_at,
  wa.updated_at
from public.workout_attachments wa
left join auth.users u on u.id = wa.user_id;

grant select on public.workout_attachments_with_athlete to authenticated, service_role;
