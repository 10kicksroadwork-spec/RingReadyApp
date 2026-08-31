-- Stable client-visible record identities for proof linkage validation.
-- Run after scripts/migrations/005_roster_meta.sql

alter table public.workout_completions
  add column if not exists client_record_id text not null default '';

alter table public.mile_tests
  add column if not exists client_record_id text not null default '';

create unique index if not exists workout_completions_user_client_record_id_idx
  on public.workout_completions(user_id, client_record_id)
  where client_record_id <> '';

create unique index if not exists mile_tests_user_client_record_id_idx
  on public.mile_tests(user_id, client_record_id)
  where client_record_id <> '';

create or replace function public.create_workout_proof_attachment(
  p_proof_key text,
  p_linked_record_id text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size integer,
  p_width integer default null,
  p_height integer default null,
  p_camp_length integer default null,
  p_week_index integer default null,
  p_workout_index integer default null,
  p_workout_type text default '',
  p_day_of_week text default ''
)
returns public.workout_attachments
language plpgsql
security definer
set search_path = public
as $function$
declare
  caller_id uuid := auth.uid();
  inserted public.workout_attachments%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(trim(p_proof_key), '') = '' then
    raise exception 'proof_key is required';
  end if;

  if coalesce(trim(p_storage_path), '') = '' then
    raise exception 'storage_path is required';
  end if;

  if p_storage_path not like caller_id::text || '/%' then
    raise exception 'storage_path must belong to the authenticated user';
  end if;

  if p_file_size is null or p_file_size <= 0 or p_file_size > 2621440 then
    raise exception 'file_size out of range';
  end if;

  if p_mime_type not in ('image/webp', 'image/jpeg', 'image/png') then
    raise exception 'unsupported mime_type';
  end if;

  if coalesce(trim(p_linked_record_id), '') = '' then
    raise exception 'linked_record_id is required';
  end if;

  if exists (
    select 1
    from public.workout_completions wc
    where wc.user_id = caller_id
      and wc.client_record_id = trim(p_linked_record_id)
      and wc.week_index is not distinct from p_week_index
      and wc.workout_index is not distinct from p_workout_index
  ) then
    null;
  elsif exists (
    select 1
    from public.sprint_sessions ss
    where ss.user_id = caller_id
      and ss.session_id = trim(p_linked_record_id)
      and ss.week_index is not distinct from p_week_index
      and ss.workout_index is not distinct from p_workout_index
  ) then
    null;
  elsif exists (
    select 1
    from public.mile_tests mt
    where mt.user_id = caller_id
      and mt.client_record_id = trim(p_linked_record_id)
      and mt.test_key = p_proof_key
  ) then
    null;
  else
    raise exception 'linked_record_id not found or context mismatch for caller';
  end if;

  update public.workout_attachments
  set is_current = false, updated_at = now()
  where user_id = caller_id
    and proof_key = p_proof_key
    and is_current = true;

  insert into public.workout_attachments (
    user_id,
    proof_key,
    linked_record_id,
    camp_length,
    week_index,
    workout_index,
    workout_type,
    day_of_week,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    file_size,
    width,
    height,
    transfer_status,
    transfer_attempts,
    transfer_error,
    drive_file_id,
    drive_url,
    is_current,
    completion_cleared,
    uploaded_at,
    updated_at
  ) values (
    caller_id,
    p_proof_key,
    coalesce(p_linked_record_id, ''),
    p_camp_length,
    p_week_index,
    p_workout_index,
    coalesce(p_workout_type, ''),
    coalesce(p_day_of_week, ''),
    'workout-proof-staging',
    p_storage_path,
    coalesce(nullif(trim(p_original_filename), ''), 'workout-proof.webp'),
    p_mime_type,
    p_file_size,
    p_width,
    p_height,
    'pending',
    0,
    '',
    '',
    '',
    true,
    false,
    now(),
    now()
  )
  returning * into inserted;

  return inserted;
end;
$function$;

revoke all on function public.create_workout_proof_attachment(
  text, text, text, text, text, integer, integer, integer, integer, integer, integer, text, text
) from public;
grant execute on function public.create_workout_proof_attachment(
  text, text, text, text, text, integer, integer, integer, integer, integer, integer, text, text
) to authenticated;
