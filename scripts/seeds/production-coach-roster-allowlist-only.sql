-- Production-only: coach roster allowlist (temporary)
-- Run manually in the Supabase SQL Editor on production.
--
-- Hides every athlete_profiles row from the coaches app EXCEPT the five
-- user_ids below. Excluded athletes can still log into the fighter app.
-- Safe to re-run when prior camp athletes log back in and reappear.
--
-- To restore a hidden athlete later: delete their row from
-- public.coach_roster_exclusions (or add their user_id to allowlist and re-run).
--
-- Keep static seed + client constants in sync for known exclusions:
--   scripts/seeds/production-coach-roster-exclusions.sql
--   src/coach-access.js (ROSTER_EXCLUDED_*)

begin;

create temporary table tmp_coach_roster_allowlist (
  user_id uuid primary key
) on commit drop;

insert into tmp_coach_roster_allowlist (user_id)
values
  ('610d28d7-d596-489a-acf7-aed0ed08a836'::uuid), -- Zahra Fadayi
  ('844ef032-5f6a-4824-b3aa-cbd548fb5c2d'::uuid), -- Emma Homan
  ('9413c3bb-ce45-4a77-86ae-24c2530b019a'::uuid), -- Malachi Brown
  ('a48dd036-ccec-4a7d-8efe-446e99eb5922'::uuid), -- Mason Cauthen
  ('cfbd6790-ddcf-44ea-b3dc-748698646d4a'::uuid); -- Stephen LaCour

-- Ensure the allowlisted five are visible on the coach roster.
delete from public.coach_roster_exclusions cre
using tmp_coach_roster_allowlist a
where cre.user_id = a.user_id;

-- Hide every other athlete profile from the coach roster.
insert into public.coach_roster_exclusions (user_id, email, label)
select
  ap.user_id,
  coalesce(u.email, ''),
  coalesce(
    nullif(trim(ap.athlete_name), ''),
    nullif(trim(u.email), ''),
    'Hidden from coach roster'
  )
from public.athlete_profiles ap
left join auth.users u on u.id = ap.user_id
where not exists (
  select 1
  from tmp_coach_roster_allowlist a
  where a.user_id = ap.user_id
)
on conflict (user_id) do update
set
  email = excluded.email,
  label = excluded.label;

commit;

-- Preview: who remains visible on the coach roster after this seed.
select
  ap.user_id,
  ap.athlete_name,
  coalesce(u.email, '') as email
from public.athlete_profiles ap
left join auth.users u on u.id = ap.user_id
where not exists (
  select 1
  from public.coach_roster_exclusions cre
  where cre.user_id = ap.user_id
)
order by ap.athlete_name nulls last, ap.user_id;
