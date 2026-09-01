-- Atomically clear a workout completion and mark its proof attachment cleared.
-- Replaces separate delete + set_workout_proof_cleared client calls.

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
  v_completion_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_week_index is null or p_workout_index is null then
    raise exception 'Week and workout index are required';
  end if;

  v_completion_key := p_week_index::text || ':' || p_workout_index::text;

  if p_attachment_id is not null then
    update public.workout_attachments
    set
      completion_cleared = true,
      updated_at = now()
    where id = p_attachment_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Attachment not found or not owned by caller';
    end if;
  end if;

  delete from public.workout_completions
  where user_id = v_user_id
    and (
      completion_key = v_completion_key
      or (week_index = p_week_index and workout_index = p_workout_index)
    );

  if not found then
    raise exception 'Workout completion not found or not owned by caller';
  end if;
end;
$function$;

revoke all
  on function public.clear_workout_completion_with_proof(integer, integer, uuid)
  from public;

grant execute
  on function public.clear_workout_completion_with_proof(integer, integer, uuid)
  to authenticated;
