-- Ring Ready coach camp start dates
-- Run after scripts/migrations/002_coach_access.sql
--
-- Lets coaches set when each fighter's roadwork camp begins so missing-workout
-- flags only count sessions that are due on the calendar.

create table if not exists public.coach_athlete_meta (
  athlete_user_id uuid primary key references auth.users(id) on delete cascade,
  camp_start_date date,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.coach_athlete_meta enable row level security;
grant select, insert, update on table public.coach_athlete_meta to authenticated;

drop policy if exists coach_athlete_meta_select_coach on public.coach_athlete_meta;
create policy coach_athlete_meta_select_coach
  on public.coach_athlete_meta
  for select to authenticated
  using (public.is_coach());

drop policy if exists coach_athlete_meta_insert_coach on public.coach_athlete_meta;
create policy coach_athlete_meta_insert_coach
  on public.coach_athlete_meta
  for insert to authenticated
  with check (public.is_coach());

drop policy if exists coach_athlete_meta_update_coach on public.coach_athlete_meta;
create policy coach_athlete_meta_update_coach
  on public.coach_athlete_meta
  for update to authenticated
  using (public.is_coach())
  with check (public.is_coach());
-- Ring Ready coach roster exclusions
-- Run after scripts/migrations/002_coach_access.sql
--
-- Hides specific auth accounts from the in-app coach roster. Athletes are
-- unchanged: excluded users can still log in and use the fighter app.

create table if not exists public.coach_roster_exclusions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  label text not null default '',
  created_at timestamptz not null default now()
);

alter table public.coach_roster_exclusions enable row level security;
grant select on table public.coach_roster_exclusions to authenticated;

drop policy if exists coach_roster_exclusions_select_coach on public.coach_roster_exclusions;
create policy coach_roster_exclusions_select_coach
  on public.coach_roster_exclusions
  for select to authenticated
  using (public.is_coach());

-- Production roster exclusions are seeded separately; see scripts/seeds/production-coach-roster-exclusions.sql
-- Ring Ready default modality on athlete profiles
-- Run in Supabase SQL Editor after the base athlete_profiles table exists.
--
-- Lets athletes store a camp default modality. Running remains the app default.

alter table public.athlete_profiles
  add column if not exists default_modality text not null default 'running';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'athlete_profiles_default_modality_check'
  ) then
    alter table public.athlete_profiles
      add constraint athlete_profiles_default_modality_check
      check (default_modality in ('running', 'assault_bike', 'rower', 'stationary_bike'));
  end if;
end $$;

update public.athlete_profiles
set default_modality = 'running'
where default_modality is null
   or default_modality not in ('running', 'assault_bike', 'rower', 'stationary_bike');
