-- Ops backfill: Matthew Taylor Week 2 Sprint Intervals (manual HR capture)
-- Date: 2026-09-09
-- Scope: one athlete, one sprint workout only.
--
-- Provided intervals:
--   L1 164 -> 91  (drop 73)
--   L2 162 -> 98  (drop 64)
--   L3 163 -> 101 (drop 62)
--   L4 161 -> 98  (drop 63)
--   L5 169 -> 99  (drop 70)
--   L6 167 -> 109 (drop 58)
-- Average drop math: (73+64+62+63+70+58) / 6 = 65.0

begin;

with athlete as (
  select user_id
  from public.athlete_profiles
  where athlete_name = 'Matthew Taylor'
  limit 1
),
upsert_sprint as (
  insert into public.sprint_sessions (
    user_id,
    session_id,
    session_at,
    week_index,
    workout_index,
    workout_type,
    hr_source,
    reps_planned,
    intervals_completed,
    avg_drop,
    peak_hr,
    session_json
  )
  select
    athlete.user_id,
    'ops:2026-09-09:matthew-taylor:week-2:sprint-intervals',
    timezone('utc', now()),
    1, -- week 2 (0-based indexing)
    0, -- Sprint Intervals slot
    'Sprint Intervals',
    'manual',
    6,
    6,
    65.0,
    169,
    jsonb_build_object(
      'source', 'ops_manual_backfill',
      'enteredAt', timezone('utc', now()),
      'enteredBy', 'cursor-agent',
      'notes', 'Week 2 sprint timer outage backfill from coach-provided manual HR values',
      'intervals', jsonb_build_array(
        jsonb_build_object('lap', 1, 'sprintHr', 164, 'recoveryHr', 91,  'drop', 73),
        jsonb_build_object('lap', 2, 'sprintHr', 162, 'recoveryHr', 98,  'drop', 64),
        jsonb_build_object('lap', 3, 'sprintHr', 163, 'recoveryHr', 101, 'drop', 62),
        jsonb_build_object('lap', 4, 'sprintHr', 161, 'recoveryHr', 98,  'drop', 63),
        jsonb_build_object('lap', 5, 'sprintHr', 169, 'recoveryHr', 99,  'drop', 70),
        jsonb_build_object('lap', 6, 'sprintHr', 167, 'recoveryHr', 109, 'drop', 58)
      ),
      'computed', jsonb_build_object(
        'averageDrop', 65.0,
        'peakSprintHr', 169,
        'minRecoveryHr', 91,
        'maxRecoveryHr', 109
      )
    )
  from athlete
  on conflict (user_id, session_id)
  do update set
    session_at = excluded.session_at,
    week_index = excluded.week_index,
    workout_index = excluded.workout_index,
    workout_type = excluded.workout_type,
    hr_source = excluded.hr_source,
    reps_planned = excluded.reps_planned,
    intervals_completed = excluded.intervals_completed,
    avg_drop = excluded.avg_drop,
    peak_hr = excluded.peak_hr,
    session_json = excluded.session_json,
    updated_at = timezone('utc', now())
  returning user_id
),
upsert_note as (
  insert into public.coach_notes (
    athlete_user_id,
    note,
    updated_at
  )
  select
    upsert_sprint.user_id,
    'Ops backfill 2026-09-09: Week 2 Sprint Intervals manually entered. Laps=6, peakHR=169, avgDrop=65.0. No proof attachment synthesized.',
    timezone('utc', now())
  from upsert_sprint
  on conflict (athlete_user_id)
  do update set
    note = case
      when coalesce(public.coach_notes.note, '') = '' then excluded.note
      when public.coach_notes.note ilike '%Week 2 Sprint Intervals manually entered%' then public.coach_notes.note
      else public.coach_notes.note || E'\n' || excluded.note
    end,
    updated_at = excluded.updated_at
)
select
  s.user_id,
  s.session_id,
  s.week_index,
  s.workout_index,
  s.intervals_completed,
  s.peak_hr,
  s.avg_drop
from public.sprint_sessions s
where s.session_id = 'ops:2026-09-09:matthew-taylor:week-2:sprint-intervals';

commit;
