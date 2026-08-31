-- DEPRECATED: see scripts/MIGRATIONS.md for canonical migrations.
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
