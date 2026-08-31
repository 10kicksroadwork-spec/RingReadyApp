-- Ring Ready core schema (fresh-database safe)
-- Run first on an empty Supabase project.

create extension if not exists pgcrypto;

grant usage on schema public to anon, authenticated;

create table if not exists public.athlete_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_name text not null default '',
  age integer check (age is null or age between 1 and 120),
  gender text not null default '',
  gender_detail text not null default '',
  training_tenure text not null default '',
  fight_date date,
  camp_length integer not null default 7 check (camp_length in (4, 7)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_info (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal_weight numeric,
  target_date date,
  max_hr integer check (max_hr is null or max_hr between 1 and 999),
  resting_hr integer check (resting_hr is null or resting_hr between 1 and 999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  completion_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sprint_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mile_tests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_key text not null default 'mile-test:baseline',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on table
  public.athlete_profiles,
  public.hr_info,
  public.workout_completions,
  public.sprint_sessions,
  public.mile_tests
to authenticated;

alter table public.athlete_profiles enable row level security;
alter table public.hr_info enable row level security;
alter table public.workout_completions enable row level security;
alter table public.sprint_sessions enable row level security;
alter table public.mile_tests enable row level security;

drop policy if exists athlete_profiles_select_own on public.athlete_profiles;
create policy athlete_profiles_select_own on public.athlete_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists athlete_profiles_insert_own on public.athlete_profiles;
create policy athlete_profiles_insert_own on public.athlete_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists athlete_profiles_update_own on public.athlete_profiles;
create policy athlete_profiles_update_own on public.athlete_profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists hr_info_select_own on public.hr_info;
create policy hr_info_select_own on public.hr_info
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists hr_info_insert_own on public.hr_info;
create policy hr_info_insert_own on public.hr_info
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists hr_info_update_own on public.hr_info;
create policy hr_info_update_own on public.hr_info
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
