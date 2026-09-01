-- Ring Ready coach roster access
-- Run after scripts/migrations/001_workout_data.sql
--
-- Allows Gene and Daniel to read every fighter's training data and to
-- write shared coach notes. Athletes still only see their own rows.

create or replace function public.is_coach()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'gene.byard@gmail.com',
    '10kicksroadwork@gmail.com'
  );
$$;

revoke all on function public.is_coach() from public;
grant execute on function public.is_coach() to authenticated;

-- Lets coaches match roster names to the email used in the PWA.
-- Returns every auth account while the caller is a coach so the app can
-- hide coach logins from the fighter roster.
create or replace function public.coach_roster_identities()
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, lower(u.email::text)
  from auth.users u
  where public.is_coach();
$$;

revoke all on function public.coach_roster_identities() from public;
grant execute on function public.coach_roster_identities() to authenticated;

alter table public.athlete_profiles enable row level security;
alter table public.hr_info enable row level security;

drop policy if exists athlete_profiles_select_coach on public.athlete_profiles;
create policy athlete_profiles_select_coach
  on public.athlete_profiles
  for select to authenticated
  using (public.is_coach());

drop policy if exists hr_info_select_coach on public.hr_info;
create policy hr_info_select_coach
  on public.hr_info
  for select to authenticated
  using (public.is_coach());

drop policy if exists workout_completions_select_coach on public.workout_completions;
create policy workout_completions_select_coach
  on public.workout_completions
  for select to authenticated
  using (public.is_coach());

drop policy if exists sprint_sessions_select_coach on public.sprint_sessions;
create policy sprint_sessions_select_coach
  on public.sprint_sessions
  for select to authenticated
  using (public.is_coach());

drop policy if exists mile_tests_select_coach on public.mile_tests;
create policy mile_tests_select_coach
  on public.mile_tests
  for select to authenticated
  using (public.is_coach());

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'workout_attachments'
  ) then
    execute $policy$
      drop policy if exists workout_attachments_select_coach on public.workout_attachments
    $policy$;
    execute $policy$
      create policy workout_attachments_select_coach
        on public.workout_attachments
        for select to authenticated
        using (public.is_coach())
    $policy$;
  end if;
end $$;

create table if not exists public.coach_notes (
  athlete_user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.coach_notes enable row level security;
grant select, insert, update on table public.coach_notes to authenticated;

drop policy if exists coach_notes_select_coach on public.coach_notes;
create policy coach_notes_select_coach
  on public.coach_notes
  for select to authenticated
  using (public.is_coach());

drop policy if exists coach_notes_insert_coach on public.coach_notes;
create policy coach_notes_insert_coach
  on public.coach_notes
  for insert to authenticated
  with check (public.is_coach());

drop policy if exists coach_notes_update_coach on public.coach_notes;
create policy coach_notes_update_coach
  on public.coach_notes
  for update to authenticated
  using (public.is_coach())
  with check (public.is_coach());
