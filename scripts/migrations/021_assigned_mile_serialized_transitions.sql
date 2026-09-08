-- Assigned Mile serialized state transitions (staging / testable — DO NOT apply to production
-- until Review B3+ promotes the contract).
--
-- Replaces 019/020 Save / Skip / Clear so all three share ONE transaction-level assignment lock
-- keyed by (auth.uid, week_index, workout_index) before touching workout_completions, mile_tests,
-- or workout_attachments.
--
-- Canonical authority: workout_completions.
-- Subordinate detail: mile_tests.
-- Legal committed states only:
--   COMPLETED: WC completed + matching Mile + correct proof linkage
--   SKIPPED:   WC skipped + NO Mile + prior proof retired
--   CLEARED:   NO WC + NO Mile + proof cleared

-- User-scoped lock primitive. Triggers and other server-side callers run for a row's
-- owner rather than for auth.uid(), so the athlete-facing wrapper delegates here.
create or replace function public.lock_assigned_workout_transition_for(
  p_user_id uuid,
  p_week_index integer,
  p_workout_index integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  -- Shared by save / skip / clear so concurrent transitions serialize as one state machine.
  perform pg_advisory_xact_lock(
    hashtext(p_user_id::text),
    hashtext('assigned:' || p_week_index::text || ':' || p_workout_index::text)
  );
end;
$$;

revoke all on function public.lock_assigned_workout_transition_for(uuid, integer, integer) from public;

create or replace function public.lock_assigned_workout_transition(
  p_week_index integer,
  p_workout_index integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.lock_assigned_workout_transition_for(auth.uid(), p_week_index, p_workout_index);
end;
$$;

revoke all on function public.lock_assigned_workout_transition(integer, integer) from public;
grant execute on function public.lock_assigned_workout_transition(integer, integer) to authenticated;

-- Resolve ONE semantic workout_completions row for an assignment position.
--
-- week/workout position is CANONICAL; completion_key is a convenience identity.
-- Mirrors findWorkoutCompletionIdentity / keyRowDisagreesWithCanonicalPosition in
-- src/workout-completion-identity.js:
--
--   key row + position row, same id                     -> valid
--   key row + position row, different ids               -> conflict
--   position row only                                   -> valid positional authority
--   key row only, stored position absent (legacy)       -> supported recovery
--   key row only, stored position != requested position -> conflict
--   neither                                             -> null
--
-- A key hit stored at another assignment must never be silently moved into, or
-- deleted on behalf of, the requested assignment.
create or replace function public.resolve_assigned_workout_completion_id_for(
  p_user_id uuid,
  p_week_index integer,
  p_workout_index integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completion_key text := p_week_index::text || ':' || p_workout_index::text;
  v_by_key_id uuid;
  v_by_key_week integer;
  v_by_key_workout integer;
  v_by_position uuid;
begin
  if p_user_id is null then
    raise exception 'not authenticated';
  end if;
  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  select wc.id, wc.week_index, wc.workout_index
  into v_by_key_id, v_by_key_week, v_by_key_workout
  from public.workout_completions wc
  where wc.user_id = p_user_id
    and wc.completion_key = v_completion_key
  order by wc.updated_at desc nulls last
  limit 1;

  select wc.id
  into v_by_position
  from public.workout_completions wc
  where wc.user_id = p_user_id
    and wc.week_index = p_week_index
    and wc.workout_index = p_workout_index
  order by
    case when wc.completion_key = v_completion_key then 0 else 1 end,
    wc.updated_at desc nulls last
  limit 1;

  if v_by_key_id is not null
     and v_by_position is not null
     and v_by_key_id is distinct from v_by_position
  then
    raise exception
      'Assigned workout identity conflict: completion_key and week/workout resolve to different rows (key=%, position=%)',
      v_by_key_id, v_by_position;
  end if;

  if v_by_key_id is not null
     and v_by_position is null
     and (v_by_key_week is not null or v_by_key_workout is not null)
     and (
       v_by_key_week is distinct from p_week_index
       or v_by_key_workout is distinct from p_workout_index
     )
  then
    raise exception
      'Assigned workout identity conflict: completion_key row % is stored at assignment %:% but %:% was requested',
      v_by_key_id, v_by_key_week, v_by_key_workout, p_week_index, p_workout_index;
  end if;

  return coalesce(v_by_key_id, v_by_position);
end;
$$;

revoke all on function public.resolve_assigned_workout_completion_id_for(uuid, integer, integer) from public;

create or replace function public.resolve_assigned_workout_completion_id(
  p_week_index integer,
  p_workout_index integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.resolve_assigned_workout_completion_id_for(
    auth.uid(),
    p_week_index,
    p_workout_index
  );
end;
$$;

revoke all on function public.resolve_assigned_workout_completion_id(integer, integer) from public;
grant execute on function public.resolve_assigned_workout_completion_id(integer, integer) to authenticated;

create or replace function public.retire_assigned_workout_proof(
  p_user_id uuid,
  p_completion_id uuid,
  p_client_record_id text,
  p_attachment_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attachment_id uuid := p_attachment_id;
begin
  if v_attachment_id is null and coalesce(p_client_record_id, '') <> '' then
    select wa.id
    into v_attachment_id
    from public.workout_attachments wa
    where wa.user_id = p_user_id
      and wa.linked_record_id = p_client_record_id
      and wa.is_current = true
    order by wa.uploaded_at desc
    limit 1;
  end if;

  if v_attachment_id is null then
    return;
  end if;

  update public.workout_attachments wa
  set
    completion_cleared = true,
    updated_at = now()
  where wa.id = v_attachment_id
    and wa.user_id = p_user_id;
end;
$$;

revoke all on function public.retire_assigned_workout_proof(uuid, uuid, text, uuid) from public;

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
  v_modality text := coalesce(nullif(trim(p_modality), ''), 'running');
  v_output_type text := coalesce(nullif(trim(p_output_type), ''), 'distance');
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

  perform public.lock_assigned_workout_transition(p_week_index, p_workout_index);

  v_completion_key := p_week_index::text || ':' || p_workout_index::text;
  v_completion_id := public.resolve_assigned_workout_completion_id(p_week_index, p_workout_index);

  if v_completion_id is not null then
    update public.workout_completions
    set
      client_record_id = v_client_record_id,
      completion_key = v_completion_key,
      week_index = p_week_index,
      workout_index = p_workout_index,
      week_label = coalesce(p_week_label, week_label, ''),
      week_title = coalesce(p_week_title, week_title, ''),
      day_of_week = coalesce(p_day_of_week, day_of_week, ''),
      workout_type = coalesce(p_workout_type, workout_type, ''),
      description = coalesce(p_description, description, ''),
      warmup = coalesce(p_warmup, warmup, ''),
      target_zone = coalesce(p_target_zone, target_zone, ''),
      target_bpm = coalesce(p_target_bpm, target_bpm),
      total_minutes = p_total_minutes,
      total_seconds = p_total_seconds,
      avg_bpm = p_avg_bpm,
      max_bpm = p_max_bpm,
      modality = v_modality,
      output_type = v_output_type,
      output_value = v_output_value,
      avg_watts = null,
      distance = p_distance,
      completed_at = v_saved_at,
      proof_policy_version = p_proof_policy_version,
      attachment_id = coalesce(p_attachment_id, attachment_id),
      proof_pending = false,
      record_json = coalesce(p_record_json, record_json, '{}'::jsonb),
      updated_at = now()
    where id = v_completion_id
      and user_id = v_uid;
  else
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
      v_modality,
      v_output_type,
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
    returning id into v_completion_id;
  end if;

  -- Subordinate Mile detail: keep exactly one matching program:* row for this assignment.
  delete from public.mile_tests
  where user_id = v_uid
    and test_key is distinct from v_test_key
    and test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$');

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
  v_existing_client_record_id text;
  v_existing_attachment_id uuid;
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

  perform public.lock_assigned_workout_transition(p_week_index, p_workout_index);

  v_completion_key := p_week_index::text || ':' || p_workout_index::text;
  v_completion_id := public.resolve_assigned_workout_completion_id(p_week_index, p_workout_index);

  if v_completion_id is not null then
    select client_record_id, attachment_id
    into v_existing_client_record_id, v_existing_attachment_id
    from public.workout_completions
    where id = v_completion_id
      and user_id = v_uid;

    perform public.retire_assigned_workout_proof(
      v_uid,
      v_completion_id,
      coalesce(v_existing_client_record_id, v_client_record_id),
      v_existing_attachment_id
    );
  end if;

  -- Remove subordinate Mile detail before writing SKIPPED assignment.
  if v_test_key is not null then
    delete from public.mile_tests
    where user_id = v_uid
      and test_key = v_test_key;
  end if;

  delete from public.mile_tests
  where user_id = v_uid
    and test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$');

  if v_completion_id is not null then
    update public.workout_completions
    set
      client_record_id = v_client_record_id,
      completion_key = v_completion_key,
      week_index = p_week_index,
      workout_index = p_workout_index,
      week_label = coalesce(p_week_label, week_label, ''),
      week_title = coalesce(p_week_title, week_title, ''),
      day_of_week = coalesce(p_day_of_week, day_of_week, ''),
      workout_type = coalesce(p_workout_type, workout_type, ''),
      description = coalesce(p_description, description, ''),
      warmup = coalesce(p_warmup, warmup, ''),
      target_zone = coalesce(p_target_zone, target_zone, ''),
      target_bpm = coalesce(p_target_bpm, target_bpm),
      total_minutes = null,
      total_seconds = null,
      avg_bpm = null,
      max_bpm = null,
      distance = null,
      modality = null,
      output_type = null,
      output_value = null,
      avg_watts = null,
      completed_at = v_completed_at,
      proof_policy_version = null,
      attachment_id = null,
      proof_pending = false,
      record_json = coalesce(p_record_json, '{}'::jsonb),
      updated_at = now()
    where id = v_completion_id
      and user_id = v_uid;
  else
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
    returning id into v_completion_id;
  end if;

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

create or replace function public.clear_assigned_mile_with_proof(
  p_test_key text,
  p_week_index integer,
  p_workout_index integer,
  p_attachment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_test_key text := nullif(trim(coalesce(p_test_key, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  -- Same assignment lock as Save/Skip — acquired before any table mutation.
  perform public.lock_assigned_workout_transition(p_week_index, p_workout_index);

  if v_test_key is not null then
    delete from public.mile_tests
    where user_id = v_uid
      and test_key = v_test_key;
  end if;

  delete from public.mile_tests
  where user_id = v_uid
    and (
      test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$')
    );

  perform public.clear_workout_completion_with_proof(
    p_week_index,
    p_workout_index,
    p_attachment_id
  );
end;
$$;

revoke all on function public.clear_assigned_mile_with_proof(text, integer, integer, uuid) from public;
grant execute on function public.clear_assigned_mile_with_proof(text, integer, integer, uuid) to authenticated;
