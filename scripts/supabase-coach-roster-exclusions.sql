-- Ring Ready coach roster exclusions
-- Run in Supabase SQL Editor after scripts/supabase-coach-access.sql
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

insert into public.coach_roster_exclusions (user_id, email, label)
values
  (
    '81c1f795-cd72-416d-b56d-4c3578a7c7f9',
    'd.a.friend108@gmail.com',
    'Daniel athlete test account'
  ),
  (
    '0c4d24e9-9778-456f-b046-970f32235fff',
    'kellimbergmann@gmail.com',
    'Kelli Bergmann'
  )
on conflict (user_id) do update
set
  email = excluded.email,
  label = excluded.label;
