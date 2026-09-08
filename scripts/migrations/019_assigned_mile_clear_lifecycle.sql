-- Assigned Mile clear lifecycle (staging / testable — DO NOT apply to production in Review B2).
-- Atomically clear mile_tests detail + canonical workout_completions assignment (+ proof).
-- workout_completions remains the assignment authority; mile_tests is subordinate detail.

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

  -- Prefer explicit test_key; also clear any program:* key for this assignment position.
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
