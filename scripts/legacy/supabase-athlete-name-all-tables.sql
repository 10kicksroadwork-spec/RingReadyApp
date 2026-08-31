-- DEPRECATED: use scripts/migrations/ — see scripts/MIGRATIONS.md

-- Add athlete_name to all fighter-linked tables for Supabase Table Editor.
-- Run once in Supabase SQL Editor (after workout-data + coach-access scripts).
--
-- Each table gets an athlete_name column that auto-fills on insert and backfills
-- existing rows. Names refresh when athlete_profiles.athlete_name changes.
--
-- Skips athlete_profiles (that table already stores the canonical name).

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

create or replace function public.trg_set_athlete_name_from_user_id()
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

create or replace function public.trg_set_athlete_name_from_athlete_user_id()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  new.athlete_name := public.resolve_athlete_display_name(new.athlete_user_id);
  return new;
end;
$$;

create or replace function public.refresh_all_athlete_name_columns()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  resolved_name text := public.resolve_athlete_display_name(new.user_id);
begin
  update public.workout_attachments
  set athlete_name = resolved_name, updated_at = now()
  where user_id = new.user_id;

  update public.workout_completions
  set athlete_name = resolved_name, updated_at = now()
  where user_id = new.user_id;

  update public.sprint_sessions
  set athlete_name = resolved_name, updated_at = now()
  where user_id = new.user_id;

  update public.mile_tests
  set athlete_name = resolved_name, updated_at = now()
  where user_id = new.user_id;

  update public.hr_info
  set athlete_name = resolved_name, updated_at = now()
  where user_id = new.user_id;

  update public.camp_archives
  set athlete_name = resolved_name
  where user_id = new.user_id;

  update public.coach_notes
  set athlete_name = resolved_name, updated_at = now()
  where athlete_user_id = new.user_id;

  update public.coach_athlete_meta
  set athlete_name = resolved_name, updated_at = now()
  where athlete_user_id = new.user_id;

  update public.coach_roster_exclusions
  set athlete_name = resolved_name
  where user_id = new.user_id;

  return new;
end;
$$;

drop trigger if exists athlete_profiles_refresh_all_athlete_names_trg on public.athlete_profiles;
drop trigger if exists athlete_profiles_refresh_attachment_names_trg on public.athlete_profiles;

create trigger athlete_profiles_refresh_all_athlete_names_trg
  after insert or update of athlete_name
  on public.athlete_profiles
  for each row
  execute function public.refresh_all_athlete_name_columns();

-- user_id tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'workout_attachments',
    'workout_completions',
    'sprint_sessions',
    'mile_tests',
    'hr_info',
    'coach_roster_exclusions'
  ]
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      execute format(
        'alter table public.%I add column if not exists athlete_name text not null default %L',
        tbl,
        ''
      );
      execute format('drop trigger if exists %I on public.%I', tbl || '_set_athlete_name_trg', tbl);
      execute format(
        'create trigger %I before insert or update of user_id on public.%I for each row execute function public.trg_set_athlete_name_from_user_id()',
        tbl || '_set_athlete_name_trg',
        tbl
      );
      execute format(
        'update public.%I set athlete_name = public.resolve_athlete_display_name(user_id) where coalesce(trim(athlete_name), %L) = %L',
        tbl,
        '',
        ''
      );
    end if;
  end loop;
end $$;

-- athlete_user_id tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array['coach_notes', 'coach_athlete_meta']
  loop
    if exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      execute format(
        'alter table public.%I add column if not exists athlete_name text not null default %L',
        tbl,
        ''
      );
      execute format('drop trigger if exists %I on public.%I', tbl || '_set_athlete_name_trg', tbl);
      execute format(
        'create trigger %I before insert or update of athlete_user_id on public.%I for each row execute function public.trg_set_athlete_name_from_athlete_user_id()',
        tbl || '_set_athlete_name_trg',
        tbl
      );
      execute format(
        'update public.%I set athlete_name = public.resolve_athlete_display_name(athlete_user_id) where coalesce(trim(athlete_name), %L) = %L',
        tbl,
        '',
        ''
      );
    end if;
  end loop;
end $$;

-- camp_archives already has athlete_name; keep it synced.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'camp_archives'
  ) then
    alter table public.camp_archives
      add column if not exists athlete_name text not null default '';

    drop trigger if exists camp_archives_set_athlete_name_trg on public.camp_archives;
    create trigger camp_archives_set_athlete_name_trg
      before insert or update of user_id
      on public.camp_archives
      for each row
      execute function public.trg_set_athlete_name_from_user_id();

    update public.camp_archives
    set athlete_name = public.resolve_athlete_display_name(user_id)
    where coalesce(trim(athlete_name), '') = '';
  end if;
end $$;

-- Optional read-only browse view (Table Editor → workout_attachments_with_athlete).
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
