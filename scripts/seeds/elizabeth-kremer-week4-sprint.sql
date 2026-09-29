-- Manual backfill: Elizabeth Kremer, Week 4 Monday sprint.
-- Phone died, so the 5x150 m reps were logged by hand as sprint HR - rest HR:
--   155-119, 161-132, 160-129, 164-139, 161-133
-- Drops: 36, 29, 31, 25, 28. Rounded average drop: 30. Peak sprint HR: 164.
--
-- Week 4 is week_index 3, Monday sprint is workout_index 0 (same slot as her
-- other camp weeks). Target BPM 174 is her Karvonen midpoint of the 90-95% zone
-- at max HR 185 / resting HR 37, matching her other sprint rows.
--
-- Session time is approximate (Monday 2026-09-21 21:00 UTC). The phone did not
-- record a timestamp. No workout photo is attached; proof stays empty.
--
-- Run the whole file as one statement in the Supabase SQL editor.
-- Safe to re-run: it only updates this backfill id, and it stops if a different
-- Week 4 sprint or Monday completion is already stored.
-- Uses dollar-quoting so the SQL editor does not mangle newline escape strings.

do $backfill$
declare
  athlete uuid := 'd0cc92f3-c9c7-44cb-a87a-599635061c7b';
  backfill_id text := 'manual-backfill:w4:sprints:elizabeth-kremer';
  session_at timestamptz := timestamptz '2026-09-21 21:00:00+00';
  warmup_copy text := $warmup$5 min easy jog; 2x80 m strides; 2x40 m A skips; 1x40 m B skips; 5 min run at 85%.

Take a couple minutes of rest before the sprints.

Cooldown (after the sprints): 5 min walk$warmup$;
  description_copy text := $desc$5x150 m Sprints (90s rest). Record HR after 60 seconds rest$desc$;
  session_json jsonb;
  record_json jsonb;
begin
  if not exists (
    select 1
    from public.athlete_profiles
    where user_id = athlete
      and athlete_name = 'Elizabeth Kremer'
  ) then
    raise exception 'Elizabeth Kremer profile not found for %', athlete;
  end if;

  if exists (
    select 1
    from public.sprint_sessions
    where user_id = athlete
      and week_index = 3
      and workout_index = 0
      and session_id is distinct from backfill_id
  ) then
    raise exception 'Week 4 sprint already has a different session; not overwriting';
  end if;

  if exists (
    select 1
    from public.workout_completions
    where user_id = athlete
      and week_index = 3
      and workout_index = 0
      and client_record_id is distinct from backfill_id
  ) then
    raise exception 'Week 4 Monday completion already exists; not overwriting';
  end if;

  session_json := jsonb_build_object(
    'id', backfill_id,
    'date', to_char(session_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
    'hrSource', 'manual',
    'note', 'Phone died during the workout. Sprint HR and rest HR entered manually.',
    'avgDrop', 30,
    'peakHR', 164,
    'cfg', jsonb_build_object(
      'reps', 5,
      'rest', 90,
      'maxHR', 185,
      'targetPct', 92.5,
      'workoutContext', jsonb_build_object(
        'reps', 5,
        'maxHr', 185,
        'warmup', warmup_copy,
        'weekTab', 'Week 4 (Deload)',
        'dayOfWeek', 'Monday',
        'targetBPM', 174,
        'targetPct', 92.5,
        'weekIndex', 3,
        'weekLabel', 'Week 4',
        'weekTitle', 'Deload',
        'targetZone', '90-95%',
        'description', description_copy,
        'restSeconds', 90,
        'workoutType', 'Sprint Intervals',
        'sprintConfig', jsonb_build_object(
          'reps', 5,
          'restSeconds', 90,
          'distanceMeters', 150,
          'restCaptureSeconds', 60
        ),
        'workoutIndex', 0,
        'distanceMeters', 150,
        'restCaptureSeconds', 60
      )
    ),
    'data', jsonb_build_array(
      jsonb_build_object('sprintHR', 155, 'restHR', 119, 'drop', 36, 'suspicious', false),
      jsonb_build_object('sprintHR', 161, 'restHR', 132, 'drop', 29, 'suspicious', false),
      jsonb_build_object('sprintHR', 160, 'restHR', 129, 'drop', 31, 'suspicious', false),
      jsonb_build_object('sprintHR', 164, 'restHR', 139, 'drop', 25, 'suspicious', false),
      jsonb_build_object('sprintHR', 161, 'restHR', 133, 'drop', 28, 'suspicious', false)
    )
  );

  insert into public.sprint_sessions (
    user_id,
    session_id,
    session_at,
    completed_at,
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
    proof_policy_version,
    attachment_id,
    updated_at
  )
  values (
    athlete,
    backfill_id,
    session_at,
    session_at,
    3,
    0,
    'Sprint Intervals',
    'manual',
    5,
    90,
    185,
    92.5,
    174,
    5,
    30,
    164,
    session_json,
    null,
    null,
    now()
  )
  on conflict (user_id, session_id) do update
  set
    session_at = excluded.session_at,
    completed_at = excluded.completed_at,
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
    proof_policy_version = excluded.proof_policy_version,
    attachment_id = excluded.attachment_id,
    updated_at = now();

  record_json := session_json || jsonb_build_object(
    'completedAt', to_char(session_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
    'completionKey', '3:0'
  );

  insert into public.workout_completions (
    user_id,
    client_record_id,
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
    max_bpm,
    modality,
    output_type,
    output_value,
    completed_at,
    proof_policy_version,
    attachment_id,
    proof_pending,
    record_json,
    updated_at
  )
  values (
    athlete,
    backfill_id,
    '3:0',
    3,
    0,
    'Week 4',
    'Deload',
    'Monday',
    'Sprint Intervals',
    description_copy,
    warmup_copy,
    '90-95%',
    174,
    164,
    'running',
    'distance',
    null,
    session_at,
    null,
    null,
    false,
    record_json,
    now()
  )
  on conflict (user_id, week_index, workout_index) do update
  set
    client_record_id = excluded.client_record_id,
    completion_key = excluded.completion_key,
    week_label = excluded.week_label,
    week_title = excluded.week_title,
    day_of_week = excluded.day_of_week,
    workout_type = excluded.workout_type,
    description = excluded.description,
    warmup = excluded.warmup,
    target_zone = excluded.target_zone,
    target_bpm = excluded.target_bpm,
    max_bpm = excluded.max_bpm,
    modality = excluded.modality,
    output_type = excluded.output_type,
    output_value = excluded.output_value,
    completed_at = excluded.completed_at,
    proof_policy_version = excluded.proof_policy_version,
    attachment_id = excluded.attachment_id,
    proof_pending = excluded.proof_pending,
    record_json = excluded.record_json,
    updated_at = now();
end;
$backfill$;

-- Review the stored reps after running.
select
  s.athlete_name,
  s.week_index,
  s.workout_index,
  s.intervals_completed,
  s.avg_drop,
  s.peak_hr,
  s.session_json -> 'data' as reps,
  c.completion_key,
  c.completed_at,
  c.proof_pending,
  c.attachment_id
from public.sprint_sessions s
join public.workout_completions c
  on c.user_id = s.user_id
 and c.week_index = s.week_index
 and c.workout_index = s.workout_index
where s.user_id = 'd0cc92f3-c9c7-44cb-a87a-599635061c7b'
  and s.session_id = 'manual-backfill:w4:sprints:elizabeth-kremer';
