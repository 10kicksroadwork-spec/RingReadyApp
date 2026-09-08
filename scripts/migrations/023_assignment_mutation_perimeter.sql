-- Assigned Mile mutation authority perimeter (staging / testable — DO NOT apply to production
-- until a code-clean review promotes the contract).
--
-- 019-022 made assigned Mile Save/Skip/Clear server-authoritative for clients that call the
-- new RPCs. Already-loaded clients (production e85e989 and earlier) still write
-- public.mile_tests / public.workout_completions directly, so the per-assignment advisory lock
-- is cooperative rather than enforced: a stale tab can leave illegal committed states such as
-- "assignment skipped but Mile detail survives" or "no assignment but Mile detail present".
--
-- This migration makes the assignment state machine mandatory at the DML boundary. Direct
-- writes join the same advisory lock and converge server-side into the only legal states:
--
--   COMPLETED: canonical workout_completions + matching program:* mile_tests + agreed CURRENT proof
--   SKIPPED:   canonical workout_completions + NO program:* mile_tests + retired proof
--   CLEARED:   no canonical workout_completions + no program:* mile_tests
--
-- Convergence is preferred over rejection so a stale athlete still gets a truthful success
-- instead of a dead-end failure. The only fail-closed case is an ambiguous assignment identity,
-- where guessing would destroy or move the wrong authoritative completion.
--
-- Proof freshness is part of the same perimeter: a non-null incoming attachment_id is trusted
-- only when workout_attachments still shows it as current, not completion-cleared, owned by the
-- athlete, and belonging to the assignment/proof identity. A stale client that resaves a
-- retired proof keeps the current canonical proof and still saves metrics. If both the incoming
-- and WC-referenced proofs are already non-current (replacement handoff window), the resolver
-- looks up the assignment's actual unique current proof — it never returns a candidate that
-- failed authority. Relational columns and JSON mirrors stay synchronized.
--
-- Deliberately preserved:
--   * standalone mile-test:baseline rows (never assignment-scoped)
--   * proof_pending = true provisional identity staging and its rollback delete
--   * every existing SECURITY DEFINER RPC path (019-022) — triggers are idempotent there
--   * athlete RLS policies; nothing is revoked
--   * legitimate old-client proof replacement (incoming current attachment is accepted)

-- program:<camp>:<week>:<workout> -> [week, workout]; null for any non-assignment test key.
create or replace function public.assigned_mile_slot(p_test_key text)
returns integer[]
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_test_key, '') ~ '^program:[0-9]+:[0-9]+:[0-9]+$'
      then array[
        split_part(p_test_key, ':', 3)::integer,
        split_part(p_test_key, ':', 4)::integer
      ]
    else null
  end;
$$;

revoke all on function public.assigned_mile_slot(text) from public;
grant execute on function public.assigned_mile_slot(text) to authenticated;

-- Final (non-staging) assignment Mile detail. Provisional proof staging rows carry
-- proof_pending = true and a null saved_at and must stay outside the state machine.
create or replace function public.is_final_assigned_mile_detail(
  p_test_key text,
  p_proof_pending boolean,
  p_saved_at timestamptz
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.assigned_mile_slot(p_test_key) is not null
    and coalesce(p_proof_pending, false) = false
    and p_saved_at is not null;
$$;

revoke all on function public.is_final_assigned_mile_detail(text, boolean, timestamptz) from public;

-- Same skip semantics as isSkippedAssignmentRow() in src/auth.js.
create or replace function public.assigned_workout_is_skipped(p_record_json jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_record_json->>'status', '') = 'skipped'
    or coalesce(p_record_json->'workoutLog'->>'status', '') = 'skipped'
    or coalesce(p_record_json->>'type', '') = 'daily-workout-skip';
$$;

revoke all on function public.assigned_workout_is_skipped(jsonb) from public;

create or replace function public.assignment_has_mile_detail(
  p_user_id uuid,
  p_week_index integer,
  p_workout_index integer
)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mile_tests mt
    where mt.user_id = p_user_id
      and mt.test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$')
      and coalesce(mt.proof_pending, false) = false
  );
$$;

revoke all on function public.assignment_has_mile_detail(uuid, integer, integer) from public;

-- Client-shaped attachment mirror used by athlete mappers (result_json / record_json).
create or replace function public.assigned_mile_attachment_mirror(p_attachment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_attachment_id is null then null
    else (
      select jsonb_build_object(
        'id', wa.id,
        'proofKey', wa.proof_key,
        'storagePath', wa.storage_path,
        'originalFilename', wa.original_filename,
        'mimeType', wa.mime_type,
        'fileSize', wa.file_size,
        'width', wa.width,
        'height', wa.height,
        'transferStatus', wa.transfer_status,
        'driveFileId', coalesce(wa.drive_file_id, ''),
        'driveUrl', coalesce(wa.drive_url, ''),
        'uploadedAt', wa.uploaded_at
      )
      from public.workout_attachments wa
      where wa.id = p_attachment_id
    )
  end;
$$;

revoke all on function public.assigned_mile_attachment_mirror(uuid) from public;

-- True when the attachment is still the athlete's authoritative current proof for this
-- assignment identity (proof_key and/or week/workout and/or linked record id).
create or replace function public.is_authoritative_assigned_mile_attachment(
  p_user_id uuid,
  p_attachment_id uuid,
  p_test_key text,
  p_week_index integer,
  p_workout_index integer,
  p_client_record_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workout_attachments wa
    where wa.id = p_attachment_id
      and wa.user_id = p_user_id
      and wa.is_current = true
      and wa.completion_cleared = false
      and (
        wa.proof_key = p_test_key
        or (
          wa.week_index is not distinct from p_week_index
          and wa.workout_index is not distinct from p_workout_index
        )
        or (
          coalesce(trim(coalesce(p_client_record_id, '')), '') <> ''
          and wa.linked_record_id = trim(p_client_record_id)
        )
      )
  );
$$;

revoke all on function public.is_authoritative_assigned_mile_attachment(uuid, uuid, text, integer, integer, text) from public;

-- Resolve which attachment_id may become canonical for a final assigned Mile write.
-- Prefer authoritative incoming, then authoritative WC canonical. If neither supplied
-- candidate is still current, look up the assignment's actual current proof. Never return
-- an attachment that failed is_authoritative_assigned_mile_attachment().
create or replace function public.resolve_assigned_mile_attachment_id(
  p_user_id uuid,
  p_incoming_attachment_id uuid,
  p_canonical_attachment_id uuid,
  p_test_key text,
  p_week_index integer,
  p_workout_index integer,
  p_client_record_id text
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_current_ids uuid[];
  v_current_count integer;
begin
  if p_incoming_attachment_id is not null
     and public.is_authoritative_assigned_mile_attachment(
       p_user_id,
       p_incoming_attachment_id,
       p_test_key,
       p_week_index,
       p_workout_index,
       p_client_record_id
     )
  then
    return p_incoming_attachment_id;
  end if;

  if p_canonical_attachment_id is not null
     and public.is_authoritative_assigned_mile_attachment(
       p_user_id,
       p_canonical_attachment_id,
       p_test_key,
       p_week_index,
       p_workout_index,
       p_client_record_id
     )
  then
    return p_canonical_attachment_id;
  end if;

  select coalesce(array_agg(wa.id order by wa.uploaded_at desc nulls last, wa.id), '{}'::uuid[])
  into v_current_ids
  from public.workout_attachments wa
  where wa.user_id = p_user_id
    and wa.is_current = true
    and wa.completion_cleared = false
    and (
      wa.proof_key = p_test_key
      or (
        wa.week_index is not distinct from p_week_index
        and wa.workout_index is not distinct from p_workout_index
      )
      or (
        coalesce(trim(coalesce(p_client_record_id, '')), '') <> ''
        and wa.linked_record_id = trim(p_client_record_id)
      )
    );

  v_current_count := coalesce(cardinality(v_current_ids), 0);

  if v_current_count = 1 then
    return v_current_ids[1];
  end if;

  if v_current_count = 0 then
    -- Neither supplied candidate is authoritative and no current replacement exists.
    -- Never finalize on a known-retired attachment id.
    return null;
  end if;

  raise exception
    'ambiguous current assigned mile proof for user % assignment %:% (test_key %)',
    p_user_id,
    p_week_index,
    p_workout_index,
    p_test_key
    using errcode = '22000';
end;
$function$;

revoke all on function public.resolve_assigned_mile_attachment_id(uuid, uuid, uuid, text, integer, integer, text) from public;

-- Keep relational proof columns and JSON mirrors on one attachment id / policy version.
create or replace function public.sync_assigned_mile_proof_mirrors(
  p_result_json jsonb,
  p_attachment_id uuid,
  p_proof_policy_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_next jsonb := coalesce(p_result_json, '{}'::jsonb);
  v_mirror jsonb;
begin
  if p_attachment_id is null then
    v_next := v_next - 'attachment';
  else
    v_mirror := public.assigned_mile_attachment_mirror(p_attachment_id);
    if v_mirror is null then
      v_next := v_next - 'attachment';
    else
      v_next := v_next || jsonb_build_object('attachment', v_mirror);
    end if;
  end if;

  if p_proof_policy_version is null then
    v_next := v_next - 'proofPolicyVersion';
  else
    v_next := v_next || jsonb_build_object('proofPolicyVersion', p_proof_policy_version);
  end if;

  return v_next;
end;
$function$;

revoke all on function public.sync_assigned_mile_proof_mirrors(jsonb, uuid, integer) from public;

-- BEFORE on mile_tests: join the assignment lock before the detail row lands, fail closed on
-- ambiguous identity, and never let subordinate detail contradict canonical CURRENT proof
-- linkage (or resurrect a retired attachment).
--
-- Known narrow tradeoff: a legacy upsert that takes the ON CONFLICT update path holds the
-- mile_tests row lock before this trigger fires, while the RPCs take the advisory lock first.
-- A stale client resaving the exact same assignment at the exact same moment a new client
-- clears it can therefore deadlock. PostgreSQL aborts one transaction (SQLSTATE 40P01) with
-- nothing committed, so the outcome stays legal and the athlete's retry succeeds. That is
-- strictly preferable to letting the unlocked write commit an illegal state.
create or replace function public.tg_assigned_mile_detail_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_slot integer[] := public.assigned_mile_slot(new.test_key);
  v_week integer;
  v_workout integer;
  v_completion_id uuid;
  v_wc_client_record_id text;
  v_wc_attachment_id uuid;
  v_wc_policy_version integer;
  v_incoming_attachment_id uuid;
  v_resolved_attachment_id uuid;
  v_client_record_id text;
begin
  if not public.is_final_assigned_mile_detail(new.test_key, new.proof_pending, new.saved_at) then
    return new;
  end if;

  v_week := v_slot[1];
  v_workout := v_slot[2];
  v_incoming_attachment_id := new.attachment_id;

  perform public.lock_assigned_workout_transition_for(new.user_id, v_week, v_workout);

  v_completion_id := public.resolve_assigned_workout_completion_id_for(
    new.user_id,
    v_week,
    v_workout
  );

  if v_completion_id is not null then
    select wc.client_record_id, wc.attachment_id, wc.proof_policy_version
    into v_wc_client_record_id, v_wc_attachment_id, v_wc_policy_version
    from public.workout_completions wc
    where wc.id = v_completion_id
      and wc.user_id = new.user_id;

    if coalesce(trim(coalesce(new.client_record_id, '')), '') = ''
       and coalesce(trim(coalesce(v_wc_client_record_id, '')), '') <> ''
    then
      new.client_record_id := v_wc_client_record_id;
    end if;
  end if;

  v_client_record_id := coalesce(
    nullif(trim(coalesce(new.client_record_id, '')), ''),
    nullif(trim(coalesce(v_wc_client_record_id, '')), '')
  );

  v_resolved_attachment_id := public.resolve_assigned_mile_attachment_id(
    new.user_id,
    v_incoming_attachment_id,
    v_wc_attachment_id,
    new.test_key,
    v_week,
    v_workout,
    v_client_record_id
  );

  new.attachment_id := v_resolved_attachment_id;

  -- Policy version follows the proof we kept: preserve WC when we refused a stale id,
  -- otherwise keep a legitimate incoming/current policy (or inherit WC).
  if v_resolved_attachment_id is null then
    new.proof_policy_version := null;
  elsif v_resolved_attachment_id is not distinct from v_wc_attachment_id
        and v_resolved_attachment_id is distinct from v_incoming_attachment_id
  then
    new.proof_policy_version := coalesce(v_wc_policy_version, new.proof_policy_version);
  else
    new.proof_policy_version := coalesce(new.proof_policy_version, v_wc_policy_version);
  end if;

  new.result_json := public.sync_assigned_mile_proof_mirrors(
    new.result_json,
    new.attachment_id,
    new.proof_policy_version
  );

  return new;
end;
$function$;

-- AFTER on mile_tests already resolved attachment authority + Mile result_json mirrors.
-- This AFTER trigger makes the canonical workout_completions prove the same Mile metrics
-- AND the same current proof (relational columns + record_json mirrors together).
create or replace function public.tg_assigned_mile_detail_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_slot integer[] := public.assigned_mile_slot(new.test_key);
  v_week integer;
  v_workout integer;
  v_completion_id uuid;
  v_completion_key text;
  v_client_record_id text;
  v_context jsonb;
  v_saved_at text;
  v_workout_log jsonb;
  v_record jsonb;
  v_next_record jsonb;
  v_wc_total_minutes numeric;
  v_wc_total_seconds integer;
  v_wc_avg_bpm integer;
  v_wc_max_bpm integer;
  v_wc_distance numeric;
  v_wc_modality text;
  v_wc_output_type text;
  v_wc_output_value numeric;
  v_wc_attachment_id uuid;
  v_wc_policy_version integer;
  v_wc_proof_pending boolean;
  v_wc_client_record_id text;
  v_wc_json_attachment_id text;
begin
  if not public.is_final_assigned_mile_detail(new.test_key, new.proof_pending, new.saved_at) then
    return null;
  end if;

  v_week := v_slot[1];
  v_workout := v_slot[2];
  v_completion_key := v_week::text || ':' || v_workout::text;

  -- Already held by the BEFORE trigger / calling RPC; re-acquiring in-transaction is a no-op.
  perform public.lock_assigned_workout_transition_for(new.user_id, v_week, v_workout);

  v_completion_id := public.resolve_assigned_workout_completion_id_for(
    new.user_id,
    v_week,
    v_workout
  );

  v_client_record_id := coalesce(
    nullif(trim(coalesce(new.client_record_id, '')), ''),
    new.id::text
  );
  v_saved_at := to_char(new.saved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_context := coalesce(new.test_context_json, '{}'::jsonb)
    || jsonb_build_object('weekIndex', v_week, 'workoutIndex', v_workout);
  v_workout_log := jsonb_build_object(
    'distance', new.distance,
    'totalMinutes', new.total_minutes,
    'totalSeconds', new.total_seconds,
    'avgBpm', new.avg_bpm,
    'maxBpm', new.max_bpm,
    'modality', 'running',
    'outputType', 'distance',
    'outputValue', new.distance,
    'completedAt', v_saved_at
  );

  if v_completion_id is null then
    -- Legacy clients save assigned Mile detail without any canonical completion.
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
      new.user_id,
      v_client_record_id,
      v_completion_key,
      v_week,
      v_workout,
      coalesce(v_context->>'weekLabel', v_context->>'weekTab', ''),
      coalesce(v_context->>'weekTitle', ''),
      coalesce(v_context->>'dayOfWeek', ''),
      coalesce(v_context->>'workoutType', 'Mile Test'),
      coalesce(v_context->>'description', ''),
      coalesce(v_context->>'warmup', ''),
      coalesce(v_context->>'targetZone', ''),
      nullif(v_context->>'targetBPM', '')::integer,
      new.total_minutes,
      new.total_seconds,
      new.avg_bpm,
      new.max_bpm,
      'running',
      'distance',
      new.distance,
      null,
      new.distance,
      new.saved_at,
      new.proof_policy_version,
      new.attachment_id,
      false,
      public.sync_assigned_mile_proof_mirrors(
        jsonb_build_object(
          'id', v_client_record_id,
          'testKey', new.test_key,
          'status', 'completed',
          'type', 'daily-workout-completion',
          'completedAt', v_saved_at,
          'workoutContext', v_context,
          'cfg', jsonb_build_object('workoutContext', v_context),
          'workoutLog', v_workout_log
        ),
        new.attachment_id,
        new.proof_policy_version
      ),
      now()
    );
    return null;
  end if;

  select
    wc.record_json,
    wc.total_minutes,
    wc.total_seconds,
    wc.avg_bpm,
    wc.max_bpm,
    wc.distance,
    wc.modality,
    wc.output_type,
    wc.output_value,
    wc.attachment_id,
    wc.proof_policy_version,
    wc.proof_pending,
    wc.client_record_id
  into
    v_record,
    v_wc_total_minutes,
    v_wc_total_seconds,
    v_wc_avg_bpm,
    v_wc_max_bpm,
    v_wc_distance,
    v_wc_modality,
    v_wc_output_type,
    v_wc_output_value,
    v_wc_attachment_id,
    v_wc_policy_version,
    v_wc_proof_pending,
    v_wc_client_record_id
  from public.workout_completions wc
  where wc.id = v_completion_id
    and wc.user_id = new.user_id
  for update;

  v_wc_json_attachment_id := nullif(trim(coalesce(v_record->'attachment'->>'id', '')), '');

  -- Canonical row already proves this Mile (the 019-022 RPC path); leave it alone only when
  -- relational proof AND JSON mirrors already agree with the resolved Mile proof.
  if not public.assigned_workout_is_skipped(v_record)
     and v_wc_total_minutes is not distinct from new.total_minutes
     and v_wc_total_seconds is not distinct from new.total_seconds
     and v_wc_avg_bpm is not distinct from new.avg_bpm
     and v_wc_max_bpm is not distinct from new.max_bpm
     and v_wc_distance is not distinct from new.distance
     and v_wc_modality is not distinct from 'running'
     and v_wc_output_type is not distinct from 'distance'
     and v_wc_output_value is not distinct from new.distance
     and v_wc_attachment_id is not distinct from new.attachment_id
     and v_wc_policy_version is not distinct from new.proof_policy_version
     and v_wc_json_attachment_id is not distinct from (new.attachment_id::text)
     and (
       new.proof_policy_version is null
       or nullif(v_record->>'proofPolicyVersion', '')::integer is not distinct from new.proof_policy_version
     )
     -- Proof linkage resolves through client_record_id, so the pair may not drift.
     and v_wc_client_record_id is not distinct from v_client_record_id
     and coalesce(v_wc_proof_pending, false) = false
  then
    return null;
  end if;

  v_next_record :=
    public.sync_assigned_mile_proof_mirrors(
      (coalesce(v_record, '{}'::jsonb) - 'skipReason' - 'skipReasonLabel' - 'coachApproved')
      || jsonb_build_object(
        'id', v_client_record_id,
        'testKey', new.test_key,
        'status', 'completed',
        'type', 'daily-workout-completion',
        'completedAt', v_saved_at,
        'workoutContext', coalesce(v_record->'workoutContext', '{}'::jsonb) || v_context,
        'cfg', jsonb_build_object(
          'workoutContext',
          coalesce(v_record->'cfg'->'workoutContext', '{}'::jsonb) || v_context
        ),
        'workoutLog',
          (
            coalesce(v_record->'workoutLog', '{}'::jsonb)
            - 'status' - 'skipReason' - 'skipReasonLabel' - 'coachApproved'
          ) || v_workout_log
      ),
      new.attachment_id,
      new.proof_policy_version
    );

  update public.workout_completions
  set
    client_record_id = v_client_record_id,
    completion_key = v_completion_key,
    week_index = v_week,
    workout_index = v_workout,
    total_minutes = new.total_minutes,
    total_seconds = new.total_seconds,
    avg_bpm = new.avg_bpm,
    max_bpm = new.max_bpm,
    modality = 'running',
    output_type = 'distance',
    output_value = new.distance,
    avg_watts = null,
    distance = new.distance,
    completed_at = new.saved_at,
    -- BEFORE already chose the authoritative attachment; do not prefer a stale incoming id.
    attachment_id = new.attachment_id,
    proof_policy_version = new.proof_policy_version,
    proof_pending = false,
    record_json = v_next_record,
    updated_at = now()
  where id = v_completion_id
    and user_id = new.user_id;

  return null;
end;
$function$;

-- BEFORE on workout_completions: force SKIPPED assigned-Mile rows to drop result metrics and
-- proof linkage, whichever client wrote them.
--
-- Deliberately does NOT take the assignment advisory lock. PostgreSQL locks the target row
-- before BEFORE-ROW triggers fire, so locking here would invert lock order against the RPCs
-- (advisory lock first, then row lock) and turn benign races into deadlocks. workout_completions
-- races are already serialized by the row lock plus the positional unique constraint, and the
-- AFTER trigger converges subordinate detail inside whichever transaction commits.
create or replace function public.tg_assigned_workout_before()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.week_index is null or new.workout_index is null then
    return new;
  end if;

  if public.assigned_workout_is_skipped(new.record_json)
     and public.assignment_has_mile_detail(new.user_id, new.week_index, new.workout_index)
  then
    new.total_minutes := null;
    new.total_seconds := null;
    new.avg_bpm := null;
    new.max_bpm := null;
    new.distance := null;
    new.modality := null;
    new.output_type := null;
    new.output_value := null;
    new.avg_watts := null;
    new.proof_policy_version := null;
    new.attachment_id := null;
    new.proof_pending := false;
  end if;

  return new;
end;
$function$;

-- AFTER on workout_completions: subordinate Mile detail and its proof must not outlive a
-- SKIPPED or CLEARED assignment, whichever client produced the transition.
create or replace function public.tg_assigned_workout_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid;
  v_week integer;
  v_workout integer;
  v_pattern text;
  v_detail record;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_week := old.week_index;
    v_workout := old.workout_index;
  else
    v_user_id := new.user_id;
    v_week := new.week_index;
    v_workout := new.workout_index;
    if not public.assigned_workout_is_skipped(new.record_json) then
      return null;
    end if;
  end if;

  if v_week is null or v_workout is null then
    return null;
  end if;

  -- Non-Mile assignments keep their existing clear/skip behaviour untouched.
  if not public.assignment_has_mile_detail(v_user_id, v_week, v_workout) then
    return null;
  end if;

  v_pattern := '^program:[0-9]+:' || v_week::text || ':' || v_workout::text || '$';

  for v_detail in
    select mt.client_record_id, mt.attachment_id
    from public.mile_tests mt
    where mt.user_id = v_user_id
      and mt.test_key ~ v_pattern
      and coalesce(mt.proof_pending, false) = false
  loop
    perform public.retire_assigned_workout_proof(
      v_user_id,
      null,
      v_detail.client_record_id,
      v_detail.attachment_id
    );
  end loop;

  if tg_op <> 'INSERT' then
    perform public.retire_assigned_workout_proof(
      v_user_id,
      old.id,
      old.client_record_id,
      old.attachment_id
    );
  end if;

  -- Provisional proof staging rows are intentionally left in place.
  delete from public.mile_tests mt
  where mt.user_id = v_user_id
    and mt.test_key ~ v_pattern
    and coalesce(mt.proof_pending, false) = false;

  return null;
end;
$function$;

drop trigger if exists assigned_mile_detail_before on public.mile_tests;
create trigger assigned_mile_detail_before
  before insert or update on public.mile_tests
  for each row
  execute function public.tg_assigned_mile_detail_before();

drop trigger if exists assigned_mile_detail_after on public.mile_tests;
create trigger assigned_mile_detail_after
  after insert or update on public.mile_tests
  for each row
  execute function public.tg_assigned_mile_detail_after();

drop trigger if exists assigned_workout_before on public.workout_completions;
create trigger assigned_workout_before
  before insert or update or delete on public.workout_completions
  for each row
  execute function public.tg_assigned_workout_before();

drop trigger if exists assigned_workout_after on public.workout_completions;
create trigger assigned_workout_after
  after insert or update or delete on public.workout_completions
  for each row
  execute function public.tg_assigned_workout_after();
