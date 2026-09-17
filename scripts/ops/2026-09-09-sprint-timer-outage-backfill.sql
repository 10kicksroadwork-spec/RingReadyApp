-- Ops backfill (NOT a schema migration): Sprint timer outage recovery
-- Date: 2026-09-09
-- Purpose: Insert coach-verified interval HR drops for athletes who completed
--          Sprint sessions while the in-app timer was malfunctioning.
--
-- Honest recovery rules:
--   - Writes sprint_sessions (+ coach_notes) only
--   - Does NOT invent workout_attachments / proof screenshots
--   - Does NOT clear missing-proof gaps
--   - Does NOT insert workout_completions (athletes can still finish with proof)
--
-- Name note: roster spelling is "Elizabeth Kremer" (not Kramer).
--
-- Run once in the Supabase SQL editor (service role / SQL editor).
-- Safe to re-run: upserts on (user_id, session_id).

begin;

-- ---------------------------------------------------------------------------
-- 1) Elizabeth Kremer — Week 2 Monday Sprint (6x150m)
--    Drops: 25, 17, 19, 13, 13, 31  → avg 19.67 → app rounds to 20
-- ---------------------------------------------------------------------------
with athlete as (
  select
    'd0cc92f3-c9c7-44cb-a87a-599635061c7b'::uuid as user_id,
    'Elizabeth Kremer'::text as athlete_name,
    185 as max_hr
),
payload as (
  select
    a.user_id,
    a.athlete_name,
    'coach-backfill-2026-09-elizabeth-w2-sprint'::text as session_id,
    timestamptz '2026-09-07 20:00:00+00' as session_at,
    1 as week_index,
    0 as workout_index,
    'Sprint Intervals'::text as workout_type,
    'manual-coach-backfill'::text as hr_source,
    6 as reps_planned,
    90 as rest_seconds,
    a.max_hr,
    92.5::numeric as target_pct,
    172 as target_bpm,
    6 as intervals_completed,
    20::numeric as avg_drop,
    171 as peak_hr,
    jsonb_build_object(
      'id', 'coach-backfill-2026-09-elizabeth-w2-sprint',
      'date', '2026-09-07T20:00:00.000Z',
      'avgDrop', 20,
      'peakHR', 171,
      'hrSource', 'manual-coach-backfill',
      'coachBackfill', jsonb_build_object(
        'reason', 'Sprint timer outage — coach-entered interval HRs',
        'enteredAt', '2026-09-09',
        'proofStatus', 'not_fabricated'
      ),
      'cfg', jsonb_build_object(
        'reps', 6,
        'rest', 90,
        'maxHR', a.max_hr,
        'targetPct', 92.5,
        'workoutContext', jsonb_build_object(
          'weekIndex', 1,
          'workoutIndex', 0,
          'weekLabel', 'Week 2',
          'weekTitle', 'Introducing High Intensity',
          'weekTab', 'Week 2 (Introducing High Intensity)',
          'dayOfWeek', 'Monday',
          'workoutType', 'Sprint Intervals',
          'description', '6x150 m sprints (90s rest). Record HR after 60 seconds rest',
          'warmup', '5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips; 5 min run at 85%.' || E'\n\n' || 'Take a couple minutes of rest before the sprints.' || E'\n\n' || 'Cooldown (after the sprints): 5 min walk',
          'targetZone', '90-95%',
          'targetBPM', 172,
          'targetPct', 92.5,
          'reps', 6,
          'restSeconds', 90,
          'distanceMeters', 150,
          'restCaptureSeconds', 60,
          'maxHr', a.max_hr,
          'sprintConfig', jsonb_build_object(
            'reps', 6,
            'restSeconds', 90,
            'distanceMeters', 150,
            'restCaptureSeconds', 60
          )
        )
      ),
      'data', jsonb_build_array(
        jsonb_build_object('sprintHR', 171, 'restHR', 146, 'drop', 25, 'suspicious', false),
        jsonb_build_object('sprintHR', 167, 'restHR', 150, 'drop', 17, 'suspicious', false),
        jsonb_build_object('sprintHR', 168, 'restHR', 149, 'drop', 19, 'suspicious', false),
        jsonb_build_object('sprintHR', 166, 'restHR', 153, 'drop', 13, 'suspicious', false),
        jsonb_build_object('sprintHR', 163, 'restHR', 153, 'drop', 13, 'suspicious', false),
        jsonb_build_object('sprintHR', 159, 'restHR', 128, 'drop', 31, 'suspicious', false)
      )
    ) as session_json
  from athlete a
)
insert into public.sprint_sessions as ss (
  user_id, athlete_name, session_id, session_at,
  week_index, workout_index, workout_type, hr_source,
  reps_planned, rest_seconds, max_hr, target_pct, target_bpm,
  intervals_completed, avg_drop, peak_hr,
  attachment_id, proof_policy_version, session_json, updated_at
)
select
  p.user_id, p.athlete_name, p.session_id, p.session_at,
  p.week_index, p.workout_index, p.workout_type, p.hr_source,
  p.reps_planned, p.rest_seconds, p.max_hr, p.target_pct, p.target_bpm,
  p.intervals_completed, p.avg_drop, p.peak_hr,
  null, null, p.session_json, now()
from payload p
on conflict (user_id, session_id) do update set
  athlete_name = excluded.athlete_name,
  session_at = excluded.session_at,
  week_index = excluded.week_index,
  workout_index = excluded.workout_index,
  workout_type = excluded.workout_type,
  hr_source = excluded.hr_source,
  reps_planned = excluded.reps_planned,
  rest_seconds = excluded.rest_seconds,
  max_hr = excluded.max_hr,
  target_pct = excluded.target_pct,
  target_bpm = excluded.target_bpm,
  intervals_completed = excluded.intervals_completed,
  avg_drop = excluded.avg_drop,
  peak_hr = excluded.peak_hr,
  attachment_id = null,
  proof_policy_version = null,
  session_json = excluded.session_json,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) Marcus Ingram — Week 1 Monday Sprint (5x150m)
--    Drops: 30, 38, 16, 20, 20  → avg 24.8 → app rounds to 25
-- ---------------------------------------------------------------------------
with athlete as (
  select
    'bd40a51c-8cc3-4f89-84be-5d99820207c4'::uuid as user_id,
    'Marcus Ingram'::text as athlete_name,
    189 as max_hr
),
payload as (
  select
    a.user_id,
    a.athlete_name,
    'coach-backfill-2026-09-marcus-w1-sprint'::text as session_id,
    timestamptz '2026-09-08 20:00:00+00' as session_at,
    0 as week_index,
    0 as workout_index,
    'Sprint Intervals'::text as workout_type,
    'manual-coach-backfill'::text as hr_source,
    5 as reps_planned,
    90 as rest_seconds,
    a.max_hr,
    92.5::numeric as target_pct,
    172 as target_bpm,
    5 as intervals_completed,
    25::numeric as avg_drop,
    185 as peak_hr,
    jsonb_build_object(
      'id', 'coach-backfill-2026-09-marcus-w1-sprint',
      'date', '2026-09-08T20:00:00.000Z',
      'avgDrop', 25,
      'peakHR', 185,
      'hrSource', 'manual-coach-backfill',
      'coachBackfill', jsonb_build_object(
        'reason', 'Sprint timer outage — coach-entered interval HRs',
        'enteredAt', '2026-09-09',
        'proofStatus', 'not_fabricated'
      ),
      'cfg', jsonb_build_object(
        'reps', 5,
        'rest', 90,
        'maxHR', a.max_hr,
        'targetPct', 92.5,
        'workoutContext', jsonb_build_object(
          'weekIndex', 0,
          'workoutIndex', 0,
          'weekLabel', 'Week 1',
          'weekTitle', 'Foundation',
          'weekTab', 'Week 1 (Foundation)',
          'dayOfWeek', 'Monday',
          'workoutType', 'Sprint Intervals',
          'description', '5x150 m Sprints (90 Second rest). Focus on fast but controlled reps. Record HR after 60 seconds rest',
          'warmup', '5 min easy jog; 2x60 m strides; 2x60 m A-skips; 5 min run at 85% MaxHR.' || E'\n\n' || 'Take a couple minutes of rest before the sprints.' || E'\n\n' || 'Cooldown (after the sprints): 5 min walk',
          'targetZone', '90-95%',
          'targetBPM', 172,
          'targetPct', 92.5,
          'reps', 5,
          'restSeconds', 90,
          'distanceMeters', 150,
          'restCaptureSeconds', 60,
          'maxHr', a.max_hr,
          'sprintConfig', jsonb_build_object(
            'reps', 5,
            'restSeconds', 90,
            'distanceMeters', 150,
            'restCaptureSeconds', 60
          )
        )
      ),
      'data', jsonb_build_array(
        jsonb_build_object('sprintHR', 178, 'restHR', 148, 'drop', 30, 'suspicious', false),
        jsonb_build_object('sprintHR', 177, 'restHR', 139, 'drop', 38, 'suspicious', false),
        jsonb_build_object('sprintHR', 180, 'restHR', 164, 'drop', 16, 'suspicious', false),
        jsonb_build_object('sprintHR', 185, 'restHR', 165, 'drop', 20, 'suspicious', false),
        jsonb_build_object('sprintHR', 185, 'restHR', 165, 'drop', 20, 'suspicious', false)
      )
    ) as session_json
  from athlete a
)
insert into public.sprint_sessions as ss (
  user_id, athlete_name, session_id, session_at,
  week_index, workout_index, workout_type, hr_source,
  reps_planned, rest_seconds, max_hr, target_pct, target_bpm,
  intervals_completed, avg_drop, peak_hr,
  attachment_id, proof_policy_version, session_json, updated_at
)
select
  p.user_id, p.athlete_name, p.session_id, p.session_at,
  p.week_index, p.workout_index, p.workout_type, p.hr_source,
  p.reps_planned, p.rest_seconds, p.max_hr, p.target_pct, p.target_bpm,
  p.intervals_completed, p.avg_drop, p.peak_hr,
  null, null, p.session_json, now()
from payload p
on conflict (user_id, session_id) do update set
  athlete_name = excluded.athlete_name,
  session_at = excluded.session_at,
  week_index = excluded.week_index,
  workout_index = excluded.workout_index,
  workout_type = excluded.workout_type,
  hr_source = excluded.hr_source,
  reps_planned = excluded.reps_planned,
  rest_seconds = excluded.rest_seconds,
  max_hr = excluded.max_hr,
  target_pct = excluded.target_pct,
  target_bpm = excluded.target_bpm,
  intervals_completed = excluded.intervals_completed,
  avg_drop = excluded.avg_drop,
  peak_hr = excluded.peak_hr,
  attachment_id = null,
  proof_policy_version = null,
  session_json = excluded.session_json,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) Kelly McMenamin — Week 1 Monday Sprint (5x150m)
--    Drops: 23 x5  → avg 23
-- ---------------------------------------------------------------------------
with athlete as (
  select
    '3a82e80a-0e82-4dc1-b617-55ebf9d2c464'::uuid as user_id,
    'Kelly McMenamin'::text as athlete_name,
    170 as max_hr
),
payload as (
  select
    a.user_id,
    a.athlete_name,
    'coach-backfill-2026-09-kelly-w1-sprint'::text as session_id,
    timestamptz '2026-09-07 20:00:00+00' as session_at,
    0 as week_index,
    0 as workout_index,
    'Sprint Intervals'::text as workout_type,
    'manual-coach-backfill'::text as hr_source,
    5 as reps_planned,
    90 as rest_seconds,
    a.max_hr,
    92.5::numeric as target_pct,
    172 as target_bpm,
    5 as intervals_completed,
    23::numeric as avg_drop,
    160 as peak_hr,
    jsonb_build_object(
      'id', 'coach-backfill-2026-09-kelly-w1-sprint',
      'date', '2026-09-07T20:00:00.000Z',
      'avgDrop', 23,
      'peakHR', 160,
      'hrSource', 'manual-coach-backfill',
      'coachBackfill', jsonb_build_object(
        'reason', 'Sprint timer outage — coach-entered interval HRs',
        'enteredAt', '2026-09-09',
        'proofStatus', 'not_fabricated'
      ),
      'cfg', jsonb_build_object(
        'reps', 5,
        'rest', 90,
        'maxHR', a.max_hr,
        'targetPct', 92.5,
        'workoutContext', jsonb_build_object(
          'weekIndex', 0,
          'workoutIndex', 0,
          'weekLabel', 'Week 1',
          'weekTitle', 'Foundation',
          'weekTab', 'Week 1 (Foundation)',
          'dayOfWeek', 'Monday',
          'workoutType', 'Sprint Intervals',
          'description', '5x150 m Sprints (90 Second rest). Focus on fast but controlled reps. Record HR after 60 seconds rest',
          'warmup', '5 min easy jog; 2x60 m strides; 2x60 m A-skips; 5 min run at 85% MaxHR.' || E'\n\n' || 'Take a couple minutes of rest before the sprints.' || E'\n\n' || 'Cooldown (after the sprints): 5 min walk',
          'targetZone', '90-95%',
          'targetBPM', 172,
          'targetPct', 92.5,
          'reps', 5,
          'restSeconds', 90,
          'distanceMeters', 150,
          'restCaptureSeconds', 60,
          'maxHr', a.max_hr,
          'sprintConfig', jsonb_build_object(
            'reps', 5,
            'restSeconds', 90,
            'distanceMeters', 150,
            'restCaptureSeconds', 60
          )
        )
      ),
      'data', jsonb_build_array(
        jsonb_build_object('sprintHR', 160, 'restHR', 137, 'drop', 23, 'suspicious', false),
        jsonb_build_object('sprintHR', 160, 'restHR', 137, 'drop', 23, 'suspicious', false),
        jsonb_build_object('sprintHR', 160, 'restHR', 137, 'drop', 23, 'suspicious', false),
        jsonb_build_object('sprintHR', 160, 'restHR', 137, 'drop', 23, 'suspicious', false),
        jsonb_build_object('sprintHR', 160, 'restHR', 137, 'drop', 23, 'suspicious', false)
      )
    ) as session_json
  from athlete a
)
insert into public.sprint_sessions as ss (
  user_id, athlete_name, session_id, session_at,
  week_index, workout_index, workout_type, hr_source,
  reps_planned, rest_seconds, max_hr, target_pct, target_bpm,
  intervals_completed, avg_drop, peak_hr,
  attachment_id, proof_policy_version, session_json, updated_at
)
select
  p.user_id, p.athlete_name, p.session_id, p.session_at,
  p.week_index, p.workout_index, p.workout_type, p.hr_source,
  p.reps_planned, p.rest_seconds, p.max_hr, p.target_pct, p.target_bpm,
  p.intervals_completed, p.avg_drop, p.peak_hr,
  null, null, p.session_json, now()
from payload p
on conflict (user_id, session_id) do update set
  athlete_name = excluded.athlete_name,
  session_at = excluded.session_at,
  week_index = excluded.week_index,
  workout_index = excluded.workout_index,
  workout_type = excluded.workout_type,
  hr_source = excluded.hr_source,
  reps_planned = excluded.reps_planned,
  rest_seconds = excluded.rest_seconds,
  max_hr = excluded.max_hr,
  target_pct = excluded.target_pct,
  target_bpm = excluded.target_bpm,
  intervals_completed = excluded.intervals_completed,
  avg_drop = excluded.avg_drop,
  peak_hr = excluded.peak_hr,
  attachment_id = null,
  proof_policy_version = null,
  session_json = excluded.session_json,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Coach notes (append outage context; do not invent proof)
-- ---------------------------------------------------------------------------
insert into public.coach_notes (athlete_user_id, athlete_name, note, updated_at)
values
  (
    'd0cc92f3-c9c7-44cb-a87a-599635061c7b',
    'Elizabeth Kremer',
    '2026-09-09: Week 2 Sprint intervals backfilled after timer outage (avg drop 20). Proof screenshot still missing — not fabricated.',
    now()
  ),
  (
    'bd40a51c-8cc3-4f89-84be-5d99820207c4',
    'Marcus Ingram',
    '2026-09-09: Week 1 Sprint intervals backfilled after timer outage (avg drop 25). Proof screenshot still missing — not fabricated.',
    now()
  ),
  (
    '3a82e80a-0e82-4dc1-b617-55ebf9d2c464',
    'Kelly McMenamin',
    '2026-09-09: Week 1 Sprint intervals backfilled after timer outage (avg drop 23). Proof screenshot still missing — not fabricated.',
    now()
  )
on conflict (athlete_user_id) do update set
  note = case
    when coalesce(public.coach_notes.note, '') = '' then excluded.note
    when position(excluded.note in public.coach_notes.note) > 0 then public.coach_notes.note
    else public.coach_notes.note || E'\n\n' || excluded.note
  end,
  athlete_name = excluded.athlete_name,
  updated_at = now();

-- Verification
select
  ap.athlete_name,
  ss.week_index,
  ss.workout_index,
  ss.session_id,
  ss.intervals_completed,
  ss.avg_drop,
  ss.peak_hr,
  ss.attachment_id,
  ss.hr_source,
  jsonb_array_length(ss.session_json->'data') as interval_rows
from public.sprint_sessions ss
join public.athlete_profiles ap on ap.user_id = ss.user_id
where ss.session_id in (
  'coach-backfill-2026-09-elizabeth-w2-sprint',
  'coach-backfill-2026-09-marcus-w1-sprint',
  'coach-backfill-2026-09-kelly-w1-sprint'
)
order by ap.athlete_name;

commit;
