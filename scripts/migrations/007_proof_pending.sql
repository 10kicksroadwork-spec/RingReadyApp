-- Explicit pending-proof staging state and scoped test cleanup RPC.
-- Run after scripts/migrations/006_client_record_ids.sql

alter table public.workout_completions
  add column if not exists proof_pending boolean not null default false;

alter table public.mile_tests
  add column if not exists proof_pending boolean not null default false;

create index if not exists workout_completions_proof_pending_idx
  on public.workout_completions(user_id, proof_pending)
  where proof_pending;

create index if not exists mile_tests_proof_pending_idx
  on public.mile_tests(user_id, proof_pending)
  where proof_pending;

create or replace function public.cleanup_test_workout_proof_attachments(p_attachment_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  caller_id uuid := auth.uid();
  deleted_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if p_attachment_ids is null or array_length(p_attachment_ids, 1) is null then
    return 0;
  end if;

  delete from public.workout_attachments
  where id = any(p_attachment_ids)
    and user_id = caller_id
    and (
      proof_key like 'auth-test:%'
      or proof_key like 'test-proof%'
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

revoke all on function public.cleanup_test_workout_proof_attachments(uuid[]) from public;
grant execute on function public.cleanup_test_workout_proof_attachments(uuid[]) to authenticated;
