-- DEPRECATED: see scripts/MIGRATIONS.md for canonical migrations.
-- Ring Ready clean slate: archive current camp, then reset live training
-- Run in Supabase SQL Editor after coach access + workout-data scripts.
--
-- What it does:
-- 1. Snapshots profile, HR, completions, sprints, mile test, camp start into camp_archives
-- 2. Deletes live training rows for that athlete
-- 3. Clears coach camp start date
-- 4. Sets athlete_profiles.camp_reset_at so devices discard stale local workouts
--
-- Keeps: name, profile fields, HR info, coach notes
--
-- App calls:
--   archive_and_reset_camp()           -- athlete on themselves
--   archive_and_reset_camp(user_id)    -- coach on a fighter

alter table public.athlete_profiles
  add column if not exists camp_reset_at timestamptz;

create table if not exists public.camp_archives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz not null default now(),
  archived_by uuid references auth.users(id),
  label text not null default '',
  athlete_name text not null default '',
  fight_date text,
  camp_length integer,
  camp_start_date date,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists camp_archives_user_archived_at_idx
  on public.camp_archives(user_id, archived_at desc);

alter table public.camp_archives enable row level security;
grant select, insert on table public.camp_archives to authenticated;

drop policy if exists camp_archives_select_own on public.camp_archives;
create policy camp_archives_select_own
  on public.camp_archives
  for select to authenticated
  using ((select auth.uid()) = user_id or public.is_coach());

drop policy if exists camp_archives_insert_own on public.camp_archives;
create policy camp_archives_insert_own
  on public.camp_archives
  for insert to authenticated
  with check ((select auth.uid()) = user_id or public.is_coach());

-- Allow athletes (and coaches via RPC) to delete their own sprint/mile rows.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sprint_sessions'
      and policyname = 'sprint_sessions_delete_own'
  ) then
    create policy sprint_sessions_delete_own
      on public.sprint_sessions
      for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'mile_tests'
      and policyname = 'mile_tests_delete_own'
  ) then
    create policy mile_tests_delete_own
      on public.mile_tests
      for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end $$;

create or replace function public.archive_and_reset_camp(target_user_id uuid default null, p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller uuid := auth.uid();
  athlete uuid;
  archive_id uuid;
  profile_row public.athlete_profiles%rowtype;
  hr_row public.hr_info%rowtype;
  meta_start date;
  snap jsonb;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;

  athlete := coalesce(target_user_id, caller);

  if athlete <> caller and not public.is_coach() then
    raise exception 'Only coaches can reset another athlete camp';
  end if;

  select * into profile_row
  from public.athlete_profiles
  where user_id = athlete;

  select * into hr_row
  from public.hr_info
  where user_id = athlete;

  select camp_start_date into meta_start
  from public.coach_athlete_meta
  where athlete_user_id = athlete;

  snap := jsonb_build_object(
    'profile', coalesce(to_jsonb(profile_row), '{}'::jsonb),
    'hr_info', coalesce(to_jsonb(hr_row), '{}'::jsonb),
    'camp_start_date', meta_start,
    'completions', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.completed_at nulls last, c.updated_at)
      from public.workout_completions c
      where c.user_id = athlete
    ), '[]'::jsonb),
    'sprints', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.session_at nulls last, s.updated_at)
      from public.sprint_sessions s
      where s.user_id = athlete
    ), '[]'::jsonb),
    'mile_tests', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.saved_at nulls last, m.updated_at)
      from public.mile_tests m
      where m.user_id = athlete
    ), '[]'::jsonb)
  );

  insert into public.camp_archives (
    user_id,
    archived_by,
    label,
    athlete_name,
    fight_date,
    camp_length,
    camp_start_date,
    snapshot
  ) values (
    athlete,
    caller,
    coalesce(nullif(trim(p_label), ''), 'Camp archive'),
    coalesce(profile_row.athlete_name, ''),
    profile_row.fight_date,
    profile_row.camp_length,
    meta_start,
    snap
  )
  returning id into archive_id;

  delete from public.workout_completions where user_id = athlete;
  delete from public.sprint_sessions where user_id = athlete;
  delete from public.mile_tests where user_id = athlete;

  update public.workout_attachments
  set
    completion_cleared = true,
    is_current = false,
    updated_at = now()
  where user_id = athlete
    and is_current = true;

  update public.coach_athlete_meta
  set
    camp_start_date = null,
    updated_by = caller,
    updated_at = now()
  where athlete_user_id = athlete;

  update public.athlete_profiles
  set
    camp_reset_at = now(),
    updated_at = now()
  where user_id = athlete;

  return archive_id;
end;
$$;

revoke all on function public.archive_and_reset_camp(uuid, text) from public;
grant execute on function public.archive_and_reset_camp(uuid, text) to authenticated;
