-- Generic workout clear joins the assigned-workout authority boundary (staging / testable —
-- DO NOT apply to production until a code-clean review promotes the contract).
--
-- clear_workout_completion_with_proof must never bypass the shared per-assignment lock
-- used by assigned Mile Save/Skip/Clear. Any stale or legacy client that calls the generic
-- clear for a Mile slot now serializes with assigned Mile transitions and removes subordinate
-- program:* mile detail before deleting the canonical workout completion.

create or replace function public.clear_workout_completion_with_proof(
  p_week_index integer,
  p_workout_index integer,
  p_attachment_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_completion_id uuid;
  v_client_record_id text;
  v_db_attachment_id uuid;
  v_attachment_id uuid;
  v_completion_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  -- Same assignment lock as assigned Mile Save/Skip/Clear — acquired before any
  -- workout_completions / mile_tests / workout_attachments mutation.
  perform public.lock_assigned_workout_transition(p_week_index, p_workout_index);

  v_completion_key := p_week_index::text || ':' || p_workout_index::text;

  select
    wc.id,
    wc.client_record_id,
    wc.attachment_id
  into
    v_completion_id,
    v_client_record_id,
    v_db_attachment_id
  from public.workout_completions wc
  where wc.user_id = v_user_id
    and (
      wc.completion_key = v_completion_key
      or (
        wc.week_index = p_week_index
        and wc.workout_index = p_workout_index
      )
    )
  order by
    case
      when wc.completion_key = v_completion_key then 0
      else 1
    end,
    wc.updated_at desc
  limit 1
  for update;

  if not found then
    -- Repeating a committed clear is a success, including after a lost response.
    -- Still remove subordinate assigned Mile detail for this position.
    delete from public.mile_tests
    where user_id = v_user_id
      and test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$');
    return;
  end if;

  -- Recover the current authoritative proof for legacy/stranded rows whose
  -- completion attachment_id was never populated.
  if v_db_attachment_id is null
     and coalesce(v_client_record_id, '') <> ''
  then
    select wa.id
    into v_db_attachment_id
    from public.workout_attachments wa
    where wa.user_id = v_user_id
      and wa.linked_record_id = v_client_record_id
      and wa.is_current = true
    order by wa.uploaded_at desc
    limit 1;
  end if;

  if
    p_attachment_id is not null
    and v_db_attachment_id is not null
    and p_attachment_id <> v_db_attachment_id
  then
    raise exception 'Attachment does not match workout completion';
  end if;

  v_attachment_id := coalesce(v_db_attachment_id, p_attachment_id);

  if v_attachment_id is not null then
    update public.workout_attachments wa
    set
      completion_cleared = true,
      updated_at = now()
    where wa.id = v_attachment_id
      and wa.user_id = v_user_id
      and (
        v_db_attachment_id is not null
        or (
          coalesce(v_client_record_id, '') <> ''
          and wa.linked_record_id = v_client_record_id
        )
      );

    if not found then
      raise exception 'Workout proof does not match completion';
    end if;
  end if;

  -- Prefer session_id = client_record_id. For legacy rows with a missing/stale
  -- client_record_id, fall back to the known attachment + assignment only.
  -- Never broadly clear every historical Sprint in the same week/workout.
  update public.sprint_sessions
  set attachment_id = null,
      proof_policy_version = null,
      session_json = coalesce(session_json, '{}'::jsonb)
        - 'attachment' - 'proofPolicyVersion' - 'completedAt' - 'completionKey',
      updated_at = now()
  where user_id = v_user_id
    and (
      (
        coalesce(v_client_record_id, '') <> ''
        and session_id = v_client_record_id
      )
      or (
        v_attachment_id is not null
        and attachment_id = v_attachment_id
        and week_index = p_week_index
        and workout_index = p_workout_index
      )
    );

  -- Subordinate assigned Mile detail must not outlive the canonical completion.
  delete from public.mile_tests
  where user_id = v_user_id
    and test_key ~ ('^program:[0-9]+:' || p_week_index::text || ':' || p_workout_index::text || '$');

  delete from public.workout_completions
  where id = v_completion_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Workout completion clear failed';
  end if;
end;
$function$;

revoke all
  on function public.clear_workout_completion_with_proof(integer, integer, uuid)
  from public;

grant execute
  on function public.clear_workout_completion_with_proof(integer, integer, uuid)
  to authenticated;
