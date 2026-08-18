-- Ring Ready coach camp start dates
-- Run in Supabase SQL Editor after scripts/supabase-coach-access.sql
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
