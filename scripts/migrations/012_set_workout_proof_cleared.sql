-- Reconcile production databases that were created from legacy SQL and
-- never received the canonical set_workout_proof_cleared() RPC.
--
-- Canonical source originally lives in 003_workout_proof.sql.
-- CREATE OR REPLACE makes this migration safe for databases that
-- already have the correct function.

create or replace function public.set_workout_proof_cleared(
  attachment_id uuid,
  cleared boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.workout_attachments
  set
    completion_cleared = coalesce(cleared, false),
    updated_at = now()
  where id = attachment_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Attachment not found or not owned by caller';
  end if;
end;
$function$;

revoke all
  on function public.set_workout_proof_cleared(uuid, boolean)
  from public;

grant execute
  on function public.set_workout_proof_cleared(uuid, boolean)
  to authenticated;
