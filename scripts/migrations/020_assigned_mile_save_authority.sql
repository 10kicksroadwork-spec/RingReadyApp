-- Assigned Mile save lifecycle (staging / testable — DO NOT apply to production in Review B2).
-- Atomically upsert subordinate mile_tests detail + canonical workout_completions completed row.
-- Replaces any prior skipped assignment for the same week/workout identity.
-- Idempotent on (user_id, test_key) and (user_id, completion_key) for lost-response retries.

create or replace function public.save_assigned_mile_result(
  p_test_key text,
  p_week_index integer,
  p_workout_index integer,
  p_client_record_id text,
  p_distance numeric,
  p_total_minutes numeric,
  p_total_seconds integer,
  p_avg_bpm integer,
  p_max_bpm integer,
  p_pace_min_per_mile numeric default null,
  p_saved_at timestamptz default now(),
  p_attachment_id uuid default null,
  p_proof_policy_version integer default null,
  p_result_json jsonb default '{}'::jsonb,
  p_hr_info_json jsonb default null,
  p_test_context_json jsonb default null,
  p_record_json jsonb default '{}'::jsonb,
  p_week_label text default null,
  p_week_title text default null,
  p_day_of_week text default null,
  p_workout_type text default null,
  p_description text default null,
  p_warmup text default null,
  p_target_zone text default null,
  p_target_bpm integer default null,
  p_modality text default 'running',
  p_output_type text default 'distance',
  p_output_value numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_test_key text := trim(coalesce(p_test_key, ''));
  v_client_record_id text := trim(coalesce(p_client_record_id, ''));
  v_completion_key text;
  v_saved_at timestamptz := coalesce(p_saved_at, now());
  v_mile_id uuid;
  v_completion_id uuid;
  v_output_value numeric := coalesce(p_output_value, p_distance);
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if v_test_key = '' then
    raise exception 'test_key is required';
  end if;

  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  if v_client_record_id = '' then
    raise exception 'client_record_id is required';
  end if;

  if p_distance is null or p_total_minutes is null or p_avg_bpm is null or p_max_bpm is null then
    raise exception 'Mile result fields are required';
  end if;

  v_completion_key := p_week_index::text || ':' || p_workout_index::text;

  -- Canonical assignment row: completed (replaces skip / prior completed).
  insert into public.workout_completions as wc (
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
    total_minutes,
    total_seconds,
    avg_bpm,
    max_bpm,
    modality,
    output_type,
    output_value,
    avg_watts,
    distance,
    completed_at,
    proof_policy_version,
    attachment_id,
    proof_pending,
    record_json,
    updated_at
  ) values (
    v_uid,
    v_client_record_id,
    v_completion_key,
    p_week_index,
    p_workout_index,
    coalesce(p_week_label, ''),
    coalesce(p_week_title, ''),
    coalesce(p_day_of_week, ''),
    coalesce(p_workout_type, ''),
    coalesce(p_description, ''),
    coalesce(p_warmup, ''),
    coalesce(p_target_zone, ''),
    p_target_bpm,
    p_total_minutes,
    p_total_seconds,
    p_avg_bpm,
    p_max_bpm,
    coalesce(nullif(trim(p_modality), ''), 'running'),
    coalesce(nullif(trim(p_output_type), ''), 'distance'),
    v_output_value,
    null,
    p_distance,
    v_saved_at,
    p_proof_policy_version,
    p_attachment_id,
    false,
    coalesce(p_record_json, '{}'::jsonb),
    now()
  )
  on conflict (user_id, completion_key) do update
  set
    client_record_id = excluded.client_record_id,
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
    total_minutes = excluded.total_minutes,
    total_seconds = excluded.total_seconds,
    avg_bpm = excluded.avg_bpm,
    max_bpm = excluded.max_bpm,
    modality = excluded.modality,
    output_type = excluded.output_type,
    output_value = excluded.output_value,
    avg_watts = excluded.avg_watts,
    distance = excluded.distance,
    completed_at = excluded.completed_at,
    proof_policy_version = excluded.proof_policy_version,
    attachment_id = coalesce(excluded.attachment_id, wc.attachment_id),
    proof_pending = false,
    record_json = excluded.record_json,
    updated_at = now()
  returning id into v_completion_id;

  -- Also reconcile legacy position-unique rows that may not share completion_key.
  update public.workout_completions
  set
    client_record_id = v_client_record_id,
    completion_key = v_completion_key,
    week_label = coalesce(p_week_label, week_label),
    week_title = coalesce(p_week_title, week_title),
    day_of_week = coalesce(p_day_of_week, day_of_week),
    workout_type = coalesce(p_workout_type, workout_type),
    description = coalesce(p_description, description),
    warmup = coalesce(p_warmup, warmup),
    target_zone = coalesce(p_target_zone, target_zone),
    target_bpm = coalesce(p_target_bpm, target_bpm),
    total_minutes = p_total_minutes,
    total_seconds = p_total_seconds,
    avg_bpm = p_avg_bpm,
    max_bpm = p_max_bpm,
    modality = coalesce(nullif(trim(p_modality), ''), 'running'),
    output_type = coalesce(nullif(trim(p_output_type), ''), 'distance'),
    output_value = v_output_value,
    distance = p_distance,
    completed_at = v_saved_at,
    proof_policy_version = p_proof_policy_version,
    attachment_id = coalesce(p_attachment_id, attachment_id),
    proof_pending = false,
    record_json = coalesce(p_record_json, record_json),
    updated_at = now()
  where user_id = v_uid
    and week_index = p_week_index
    and workout_index = p_workout_index
    and id is distinct from v_completion_id;

  insert into public.mile_tests as mt (
    user_id,
    client_record_id,
    test_key,
    saved_at,
    distance,
    total_minutes,
    total_seconds,
    pace_min_per_mile,
    avg_bpm,
    max_bpm,
    proof_policy_version,
    attachment_id,
    proof_pending,
    result_json,
    hr_info_json,
    test_context_json,
    updated_at
  ) values (
    v_uid,
    v_client_record_id,
    v_test_key,
    v_saved_at,
    p_distance,
    p_total_minutes,
    p_total_seconds,
    p_pace_min_per_mile,
    p_avg_bpm,
    p_max_bpm,
    p_proof_policy_version,
    p_attachment_id,
    false,
    coalesce(p_result_json, '{}'::jsonb),
    p_hr_info_json,
    p_test_context_json,
    now()
  )
  on conflict (user_id, test_key) do update
  set
    client_record_id = excluded.client_record_id,
    saved_at = excluded.saved_at,
    distance = excluded.distance,
    total_minutes = excluded.total_minutes,
    total_seconds = excluded.total_seconds,
    pace_min_per_mile = excluded.pace_min_per_mile,
    avg_bpm = excluded.avg_bpm,
    max_bpm = excluded.max_bpm,
    proof_policy_version = excluded.proof_policy_version,
    attachment_id = coalesce(excluded.attachment_id, mt.attachment_id),
    proof_pending = false,
    result_json = excluded.result_json,
    hr_info_json = excluded.hr_info_json,
    test_context_json = excluded.test_context_json,
    updated_at = now()
  returning id into v_mile_id;

  return jsonb_build_object(
    'completion_id', v_completion_id,
    'mile_id', v_mile_id,
    'client_record_id', v_client_record_id,
    'test_key', v_test_key,
    'completion_key', v_completion_key,
    'status', 'completed'
  );
end;
$$;

revoke all on function public.save_assigned_mile_result(
  text, integer, integer, text, numeric, numeric, integer, integer, integer, numeric,
  timestamptz, uuid, integer, jsonb, jsonb, jsonb, jsonb,
  text, text, text, text, text, text, text, integer, text, text, numeric
) from public;

grant execute on function public.save_assigned_mile_result(
  text, integer, integer, text, numeric, numeric, integer, integer, integer, numeric,
  timestamptz, uuid, integer, jsonb, jsonb, jsonb, jsonb,
  text, text, text, text, text, text, text, integer, text, text, numeric
) to authenticated;

-- Skip an assigned Mile: canonical skipped completion + remove subordinate mile detail.
create or replace function public.skip_assigned_mile(
  p_test_key text,
  p_week_index integer,
  p_workout_index integer,
  p_client_record_id text,
  p_record_json jsonb default '{}'::jsonb,
  p_week_label text default null,
  p_week_title text default null,
  p_day_of_week text default null,
  p_workout_type text default null,
  p_description text default null,
  p_warmup text default null,
  p_target_zone text default null,
  p_target_bpm integer default null,
  p_completed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_test_key text := nullif(trim(coalesce(p_test_key, '')), '');
  v_client_record_id text := trim(coalesce(p_client_record_id, ''));
  v_completion_key text;
  v_completed_at timestamptz := coalesce(p_completed_at, now());
  v_completion_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  if v_client_record_id = '' then
    raise exception 'client_record_id is required';
  end if;

  v_completion_key := p_week_index::text || ':' || p_workout_index::text;

  if v_test_key is not null then
    delete from public.mile_tests
    where user_id = v_uid
      and test_key = v_test_key;
  end if;

  delete from public.mile_tests
  where user_id = v_uid
    and test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$');

  insert into public.workout_completions as wc (
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
    total_minutes,
    total_seconds,
    avg_bpm,
    max_bpm,
    distance,
    completed_at,
    proof_policy_version,
    attachment_id,
    proof_pending,
    record_json,
    updated_at
  ) values (
    v_uid,
    v_client_record_id,
    v_completion_key,
    p_week_index,
    p_workout_index,
    coalesce(p_week_label, ''),
    coalesce(p_week_title, ''),
    coalesce(p_day_of_week, ''),
    coalesce(p_workout_type, ''),
    coalesce(p_description, ''),
    coalesce(p_warmup, ''),
    coalesce(p_target_zone, ''),
    p_target_bpm,
    null,
    null,
    null,
    null,
    null,
    v_completed_at,
    null,
    null,
    false,
    coalesce(p_record_json, '{}'::jsonb),
    now()
  )
  on conflict (user_id, completion_key) do update
  set
    client_record_id = excluded.client_record_id,
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
    total_minutes = null,
    total_seconds = null,
    avg_bpm = null,
    max_bpm = null,
    distance = null,
    modality = null,
    output_type = null,
    output_value = null,
    avg_watts = null,
    completed_at = excluded.completed_at,
    proof_policy_version = null,
    attachment_id = null,
    proof_pending = false,
    record_json = excluded.record_json,
    updated_at = now()
  returning id into v_completion_id;

  return jsonb_build_object(
    'completion_id', v_completion_id,
    'client_record_id', v_client_record_id,
    'test_key', v_test_key,
    'completion_key', v_completion_key,
    'status', 'skipped'
  );
end;
$$;

revoke all on function public.skip_assigned_mile(
  text, integer, integer, text, jsonb, text, text, text, text, text, text, text, integer, timestamptz
) from public;

grant execute on function public.skip_assigned_mile(
  text, integer, integer, text, jsonb, text, text, text, text, text, text, text, integer, timestamptz
) to authenticated;
