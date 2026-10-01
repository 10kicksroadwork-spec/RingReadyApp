-- Manual ingest: Jordan Tillman sprint session (app reset during set 5)
-- Run once in Supabase SQL Editor.
--
-- Athlete user_id: f2695e2c-fd60-4832-b90f-dad96dee5845
-- Source: coach-entered HR pairs after phone lock reset the timer.
--
-- Reps (sprint bpm -> rest bpm @ 60s):
--   170-144 | 171-147 | 169-149 | 172-149 | 176-144
--
-- Default target: Week 1 Monday sprint (5x150 m, 90s rest).
-- Change v_week_index / v_workout_index below if this was a different week.

do $ingest$
declare
  v_athlete uuid := 'f2695e2c-fd60-4832-b90f-dad96dee5845';
  v_session_id text := 'manual-ingest-jordan-sprint-2026-08-31';
  v_completion_key text := '0:0';
  v_week_index integer := 0;
  v_workout_index integer := 0;
  v_session_at timestamptz := timestamptz '2026-08-31 12:00:00+00';
  v_reps_planned integer := 5;
  v_rest_seconds integer := 90;
  v_target_bpm integer := 172;
  v_target_pct numeric := 90;
  v_athlete_max_hr integer;
  v_avg_drop numeric := 25;
  v_peak_hr integer := 176;
  v_session_record jsonb;
  v_completion_record jsonb;
begin
  if not exists (select 1 from auth.users where id = v_athlete) then
    raise exception 'User % not found in auth.users', v_athlete;
  end if;

  select nullif(h.max_hr, 0)
  into v_athlete_max_hr
  from public.hr_info h
  where h.user_id = v_athlete
  limit 1;

  v_athlete_max_hr := coalesce(v_athlete_max_hr, 183);

  v_session_record := jsonb_build_object(
    'id', v_session_id,
    'date', v_session_at,
    'completedAt', v_session_at,
    'completionKey', v_completion_key,
    'avgDrop', v_avg_drop,
    'peakHR', v_peak_hr,
    'note', 'Manual SQL ingest — timer reset during set 5 after phone lock (2026-08-31).',
    'cfg', jsonb_build_object(
      'reps', v_reps_planned,
      'rest', v_rest_seconds,
      'maxHR', v_athlete_max_hr,
      'targetPct', v_target_pct,
      'workoutContext', jsonb_build_object(
        'weekIndex', v_week_index,
        'workoutIndex', v_workout_index,
        'weekLabel', 'Week 1',
        'weekTitle', 'Foundation',
        'weekTab', 'Week 1 (Foundation)',
        'dayOfWeek', 'Monday',
        'workoutType', 'Sprint Intervals',
        'description', '5x150 m Sprints (90 Second rest). Focus on fast but controlled reps. Record HR after 60 seconds rest',
        'warmup', '5 min easy jog; 2x60 m strides; 2x60 m A-skips; 5 min run at 85% MaxHR.',
        'targetZone', '90-95%',
        'targetBPM', v_target_bpm,
        'targetPct', v_target_pct,
        'maxHr', v_athlete_max_hr,
        'reps', v_reps_planned,
        'restSeconds', v_rest_seconds,
        'distanceMeters', 150
      )
    ),
    'data', jsonb_build_array(
      jsonb_build_object('sprintHR', 170, 'restHR', 144, 'drop', 26, 'suspicious', false),
      jsonb_build_object('sprintHR', 171, 'restHR', 147, 'drop', 24, 'suspicious', false),
      jsonb_build_object('sprintHR', 169, 'restHR', 149, 'drop', 20, 'suspicious', false),
      jsonb_build_object('sprintHR', 172, 'restHR', 149, 'drop', 23, 'suspicious', false),
      jsonb_build_object('sprintHR', 176, 'restHR', 144, 'drop', 32, 'suspicious', false)
    )
  );

  v_completion_record := v_session_record;

  insert into public.sprint_sessions (
    user_id,
    session_id,
    session_at,
    week_index,
    workout_index,
    workout_type,
    hr_source,
    reps_planned,
    rest_seconds,
    max_hr,
    target_pct,
    target_bpm,
    intervals_completed,
    avg_drop,
    peak_hr,
    session_json,
    updated_at
  ) values (
    v_athlete,
    v_session_id,
    v_session_at,
    v_week_index,
    v_workout_index,
    'Sprint Intervals',
    'manual-ingest',
    v_reps_planned,
    v_rest_seconds,
    v_athlete_max_hr,
    v_target_pct,
    v_target_bpm,
    5,
    v_avg_drop,
    v_peak_hr,
    v_session_record,
    now()
  )
  on conflict (user_id, session_id) do update set
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
    session_json = excluded.session_json,
    updated_at = now();

  insert into public.workout_completions (
    user_id,
    completion_key,
    week_index,
    workout_index,
    week_label,
    week_title,
    day_of_week,
    workout_type,
    description,
    warmup,
    target_zone,
    target_bpm,
    completed_at,
    record_json,
    updated_at
  ) values (
    v_athlete,
    v_completion_key,
    v_week_index,
    v_workout_index,
    'Week 1',
    'Foundation',
    'Monday',
    'Sprint Intervals',
    '5x150 m Sprints (90 Second rest). Focus on fast but controlled reps. Record HR after 60 seconds rest',
    '5 min easy jog; 2x60 m strides; 2x60 m A-skips; 5 min run at 85% MaxHR.',
    '90-95%',
    v_target_bpm,
    v_session_at,
    v_completion_record,
    now()
  )
  on conflict (user_id, completion_key) do update set
    week_index = excluded.week_index,
    workout_index = excluded.workout_index,
    week_label = excluded.week_label,
    week_title = excluded.week_title,
    day_of_week = excluded.day_of_week,
    workout_type = excluded.workout_type,
    description = excluded.description,
    warmup = excluded.warmup,
    target_zone = excluded.target_zone,
    target_bpm = excluded.target_bpm,
    completed_at = excluded.completed_at,
    record_json = excluded.record_json,
    updated_at = now();

  raise notice 'Ingested Jordan Tillman sprint session (% intervals, avg drop %, peak %).',
    5, v_avg_drop, v_peak_hr;
end;
$ingest$;

-- Verify
select
  session_id,
  session_at,
  week_index,
  workout_index,
  intervals_completed,
  avg_drop,
  peak_hr,
  session_json -> 'data' as intervals
from public.sprint_sessions
where user_id = 'f2695e2c-fd60-4832-b90f-dad96dee5845'
  and session_id = 'manual-ingest-jordan-sprint-2026-08-31';

select
  completion_key,
  completed_at,
  workout_type,
  record_json -> 'avgDrop' as avg_drop,
  record_json -> 'peakHR' as peak_hr
from public.workout_completions
where user_id = 'f2695e2c-fd60-4832-b90f-dad96dee5845'
  and completion_key = '0:0';
