-- Ring Ready workout-data cloud sync support
-- Run this in Supabase SQL Editor after the base tables exist.

create extension if not exists pgcrypto;

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on table
  public.athlete_profiles,
  public.hr_info,
  public.workout_completions,
  public.sprint_sessions,
  public.mile_tests
to authenticated;

alter table public.workout_completions enable row level security;
alter table public.sprint_sessions enable row level security;
alter table public.mile_tests enable row level security;

alter table public.workout_completions add column if not exists id uuid default gen_random_uuid();
alter table public.workout_completions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.workout_completions add column if not exists completion_key text not null default '';
alter table public.workout_completions add column if not exists week_index integer;
alter table public.workout_completions add column if not exists workout_index integer;
alter table public.workout_completions add column if not exists week_label text;
alter table public.workout_completions add column if not exists week_title text;
alter table public.workout_completions add column if not exists day_of_week text;
alter table public.workout_completions add column if not exists workout_type text;
alter table public.workout_completions add column if not exists description text;
alter table public.workout_completions add column if not exists warmup text;
alter table public.workout_completions add column if not exists target_zone text;
alter table public.workout_completions add column if not exists target_bpm integer;
alter table public.workout_completions add column if not exists total_minutes numeric;
alter table public.workout_completions add column if not exists total_seconds integer;
alter table public.workout_completions add column if not exists avg_bpm integer check (avg_bpm is null or avg_bpm between 1 and 999);
alter table public.workout_completions add column if not exists max_bpm integer check (max_bpm is null or max_bpm between 1 and 999);
alter table public.workout_completions add column if not exists distance numeric;
alter table public.workout_completions add column if not exists completed_at timestamptz;
alter table public.workout_completions add column if not exists record_json jsonb not null default '{}'::jsonb;
alter table public.workout_completions add column if not exists created_at timestamptz not null default now();
alter table public.workout_completions add column if not exists updated_at timestamptz not null default now();

create unique index if not exists workout_completions_user_completion_key_idx
  on public.workout_completions(user_id, completion_key);

alter table public.sprint_sessions add column if not exists id uuid default gen_random_uuid();
alter table public.sprint_sessions add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.sprint_sessions add column if not exists session_id text not null default '';
alter table public.sprint_sessions add column if not exists session_at timestamptz;
alter table public.sprint_sessions add column if not exists week_index integer;
alter table public.sprint_sessions add column if not exists workout_index integer;
alter table public.sprint_sessions add column if not exists workout_type text;
alter table public.sprint_sessions add column if not exists hr_source text;
alter table public.sprint_sessions add column if not exists reps_planned integer;
alter table public.sprint_sessions add column if not exists rest_seconds integer;
alter table public.sprint_sessions add column if not exists max_hr integer check (max_hr is null or max_hr between 1 and 999);
alter table public.sprint_sessions add column if not exists target_pct numeric;
alter table public.sprint_sessions add column if not exists target_bpm integer;
alter table public.sprint_sessions add column if not exists intervals_completed integer;
alter table public.sprint_sessions add column if not exists avg_drop numeric;
alter table public.sprint_sessions add column if not exists peak_hr integer check (peak_hr is null or peak_hr between 1 and 999);
alter table public.sprint_sessions add column if not exists session_json jsonb not null default '{}'::jsonb;
alter table public.sprint_sessions add column if not exists created_at timestamptz not null default now();
alter table public.sprint_sessions add column if not exists updated_at timestamptz not null default now();

create unique index if not exists sprint_sessions_user_session_id_idx
  on public.sprint_sessions(user_id, session_id);

alter table public.mile_tests add column if not exists id uuid default gen_random_uuid();
alter table public.mile_tests add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.mile_tests add column if not exists saved_at timestamptz;
alter table public.mile_tests add column if not exists distance numeric;
alter table public.mile_tests add column if not exists total_minutes numeric;
alter table public.mile_tests add column if not exists total_seconds integer;
alter table public.mile_tests add column if not exists pace_min_per_mile numeric;
alter table public.mile_tests add column if not exists avg_bpm integer check (avg_bpm is null or avg_bpm between 1 and 999);
alter table public.mile_tests add column if not exists max_bpm integer check (max_bpm is null or max_bpm between 1 and 999);
alter table public.mile_tests add column if not exists result_json jsonb not null default '{}'::jsonb;
alter table public.mile_tests add column if not exists hr_info_json jsonb;
alter table public.mile_tests add column if not exists test_context_json jsonb;
alter table public.mile_tests add column if not exists created_at timestamptz not null default now();
alter table public.mile_tests add column if not exists updated_at timestamptz not null default now();

create unique index if not exists mile_tests_user_id_idx
  on public.mile_tests(user_id);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_completions' and policyname = 'workout_completions_select_own') then
    create policy workout_completions_select_own on public.workout_completions for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_completions' and policyname = 'workout_completions_insert_own') then
    create policy workout_completions_insert_own on public.workout_completions for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_completions' and policyname = 'workout_completions_update_own') then
    create policy workout_completions_update_own on public.workout_completions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workout_completions' and policyname = 'workout_completions_delete_own') then
    create policy workout_completions_delete_own on public.workout_completions for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sprint_sessions' and policyname = 'sprint_sessions_select_own') then
    create policy sprint_sessions_select_own on public.sprint_sessions for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sprint_sessions' and policyname = 'sprint_sessions_insert_own') then
    create policy sprint_sessions_insert_own on public.sprint_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sprint_sessions' and policyname = 'sprint_sessions_update_own') then
    create policy sprint_sessions_update_own on public.sprint_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mile_tests' and policyname = 'mile_tests_select_own') then
    create policy mile_tests_select_own on public.mile_tests for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mile_tests' and policyname = 'mile_tests_insert_own') then
    create policy mile_tests_insert_own on public.mile_tests for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mile_tests' and policyname = 'mile_tests_update_own') then
    create policy mile_tests_update_own on public.mile_tests for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;