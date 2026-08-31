-- Production-only seed: coach roster exclusions
-- Run manually on production AFTER the affected auth.users rows exist.
-- Not part of canonical migrations 000–005.

insert into public.coach_roster_exclusions (user_id, email, label)
select v.user_id, v.email, v.label
from (
  values
    ('81c1f795-cd72-416d-b56d-4c3578a7c7f9'::uuid, 'd.a.friend108@gmail.com', 'Daniel athlete test account'),
    ('0c4d24e9-9778-456f-b046-970f32235fff'::uuid, 'kellimbergmann@gmail.com', 'Kelli Bergmann'),
    ('05a75ab0-ebac-4a2b-b959-6820225bd028'::uuid, 'ryankfisch@gmail.com', 'Ryan Fisch'),
    ('77481fd7-1411-4799-96bb-42daa347ab6a'::uuid, 'simonbhyard@gmail.com', 'Simon Byard')
) as v(user_id, email, label)
join auth.users u on u.id = v.user_id
on conflict (user_id) do update
set
  email = excluded.email,
  label = excluded.label;
