-- Add athlete_name to workout_attachments for Supabase Table Editor.
-- Run once in Supabase SQL Editor after scripts/supabase-workout-proof.sql.
--
-- After this, open Table Editor → workout_attachments and you'll see athlete_name
-- as the first column on every row (auto-filled on insert + backfilled for existing rows).

alter table public.workout_attachments
  add column if not exists athlete_name text not null default '';

create or replace function public.resolve_athlete_display_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    nullif(trim(p.athlete_name), ''),
    nullif(trim(lower(u.email::text)), ''),
    target_user_id::text
  )
  from (select target_user_id as uid) x
  left join public.athlete_profiles p on p.user_id = x.uid
  left join auth.users u on u.id = x.uid;
$$;

revoke all on function public.resolve_athlete_display_name(uuid) from public;
grant execute on function public.resolve_athlete_display_name(uuid) to authenticated, service_role;

create or replace function public.workout_attachments_set_athlete_name()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  new.athlete_name := public.resolve_athlete_display_name(new.user_id);
  return new;
end;
$$;

drop trigger if exists workout_attachments_set_athlete_name_trg on public.workout_attachments;
create trigger workout_attachments_set_athlete_name_trg
  before insert or update of user_id
  on public.workout_attachments
  for each row
  execute function public.workout_attachments_set_athlete_name();

create or replace function public.refresh_workout_attachment_athlete_names()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update public.workout_attachments wa
  set
    athlete_name = public.resolve_athlete_display_name(wa.user_id),
    updated_at = now()
  where wa.user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists athlete_profiles_refresh_attachment_names_trg on public.athlete_profiles;
create trigger athlete_profiles_refresh_attachment_names_trg
  after insert or update of athlete_name
  on public.athlete_profiles
  for each row
  execute function public.refresh_workout_attachment_athlete_names();

-- Backfill existing rows (e.g. Marcus mile-test proof).
update public.workout_attachments wa
set athlete_name = public.resolve_athlete_display_name(wa.user_id)
where coalesce(trim(wa.athlete_name), '') = ''
   or wa.athlete_name = wa.user_id::text;

-- Optional: browse view with email + week label (shows as its own Table Editor entry).
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
  case
    when wa.week_index is null then 'Mile Test'
    else 'Week ' || (wa.week_index + 1)::text
  end as week_label,
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
