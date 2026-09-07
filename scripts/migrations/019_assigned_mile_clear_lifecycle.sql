-- Assigned Mile clear lifecycle (staging / testable — DO NOT apply to production in Review B).
-- Prefer composing existing clear_workout_completion_with_proof with an owned mile_tests delete.
-- This RPC is optional client hardening for one atomic call; athletes can already DELETE own
-- mile_tests rows and clear assignment completions via 015/018.

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
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if p_test_key is not null and length(trim(p_test_key)) > 0 then
    delete from public.mile_tests
    where user_id = v_uid
      and test_key = trim(p_test_key);
  end if;

  perform public.clear_workout_completion_with_proof(
    p_week_index,
    p_workout_index,
    p_attachment_id
  );
end;
$$;

revoke all on function public.clear_assigned_mile_with_proof(text, integer, integer, uuid) from public;
grant execute on function public.clear_assigned_mile_with_proof(text, integer, integer, uuid) to authenticated;
