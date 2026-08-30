-- Part 1 of 2: functions + profile refresh trigger.
-- Run before scripts/supabase-athlete-name-all-tables-part2.sql

create or replace function public.resolve_athlete_display_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth
as $function$
  select coalesce(
    nullif(trim(p.athlete_name), ''),
    nullif(trim(lower(u.email::text)), ''),
    target_user_id::text
  )
  from (select target_user_id as uid) x
  left join public.athlete_profiles p on p.user_id = x.uid
  left join auth.users u on u.id = x.uid;
$function$;

revoke all on function public.resolve_athlete_display_name(uuid) from public;
grant execute on function public.resolve_athlete_display_name(uuid) to authenticated, service_role;

create or replace function public.trg_set_athlete_name_from_user_id()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
begin
  new.athlete_name := public.resolve_athlete_display_name(new.user_id);
  return new;
end;
$function$;

create or replace function public.trg_set_athlete_name_from_athlete_user_id()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
begin
  new.athlete_name := public.resolve_athlete_display_name(new.athlete_user_id);
  return new;
end;
$function$;

create or replace function public.refresh_all_athlete_name_columns()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $function$
declare
  resolved_name text := public.resolve_athlete_display_name(new.user_id);
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workout_attachments' and column_name = 'athlete_name') then
    update public.workout_attachments set athlete_name = resolved_name, updated_at = now() where user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'workout_completions' and column_name = 'athlete_name') then
    update public.workout_completions set athlete_name = resolved_name, updated_at = now() where user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sprint_sessions' and column_name = 'athlete_name') then
    update public.sprint_sessions set athlete_name = resolved_name, updated_at = now() where user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mile_tests' and column_name = 'athlete_name') then
    update public.mile_tests set athlete_name = resolved_name, updated_at = now() where user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_info' and column_name = 'athlete_name') then
    update public.hr_info set athlete_name = resolved_name, updated_at = now() where user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'camp_archives' and column_name = 'athlete_name') then
    update public.camp_archives set athlete_name = resolved_name where user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_notes' and column_name = 'athlete_name') then
    update public.coach_notes set athlete_name = resolved_name, updated_at = now() where athlete_user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_athlete_meta' and column_name = 'athlete_name') then
    update public.coach_athlete_meta set athlete_name = resolved_name, updated_at = now() where athlete_user_id = new.user_id;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coach_roster_exclusions' and column_name = 'athlete_name') then
    update public.coach_roster_exclusions set athlete_name = resolved_name where user_id = new.user_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists athlete_profiles_refresh_all_athlete_names_trg on public.athlete_profiles;
drop trigger if exists athlete_profiles_refresh_attachment_names_trg on public.athlete_profiles;

create trigger athlete_profiles_refresh_all_athlete_names_trg
  after insert or update of athlete_name
  on public.athlete_profiles
  for each row
  execute function public.refresh_all_athlete_name_columns();
