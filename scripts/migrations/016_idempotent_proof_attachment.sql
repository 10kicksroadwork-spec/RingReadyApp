-- Idempotent proof attachment creation for safe mobile retries.
-- Run after scripts/migrations/015_clear_workout_completion_with_proof.sql

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
  existing public.workout_attachments%rowtype;
  current_replacement public.workout_attachments%rowtype;
  linked_id text := coalesce(trim(p_linked_record_id), '');
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

  if linked_id = '' then
    raise exception 'linked_record_id is required';
  end if;

  if exists (
    select 1
    from public.workout_completions wc
    where wc.user_id = caller_id
      and wc.client_record_id = linked_id
      and wc.week_index is not distinct from p_week_index
      and wc.workout_index is not distinct from p_workout_index
  ) then
    null;
  elsif exists (
    select 1
    from public.sprint_sessions ss
    where ss.user_id = caller_id
      and ss.session_id = linked_id
      and ss.week_index is not distinct from p_week_index
      and ss.workout_index is not distinct from p_workout_index
  ) then
    null;
  elsif exists (
    select 1
    from public.mile_tests mt
    where mt.user_id = caller_id
      and mt.client_record_id = linked_id
      and mt.test_key = p_proof_key
  ) then
    null;
  else
    raise exception 'linked_record_id not found or context mismatch for caller';
  end if;

  perform pg_advisory_xact_lock(hashtext(caller_id::text || ':' || p_proof_key));

  select *
  into existing
  from public.workout_attachments
  where user_id = caller_id
    and storage_path = p_storage_path
  limit 1;

  if existing.id is not null then
    if existing.proof_key = p_proof_key
       and existing.linked_record_id = linked_id then
      if existing.is_current = true then
        return existing;
      end if;

      select *
      into current_replacement
      from public.workout_attachments
      where user_id = caller_id
        and proof_key = p_proof_key
        and linked_record_id = linked_id
        and is_current = true
      limit 1;

      if current_replacement.id is not null then
        return current_replacement;
      end if;

      raise exception 'proof attempt superseded';
    end if;

    raise exception 'idempotency key conflict for storage_path';
  end if;

  update public.workout_attachments
  set is_current = false, updated_at = now()
  where user_id = caller_id
    and proof_key = p_proof_key
    and is_current = true;

  begin
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
      linked_id,
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
  exception
    when unique_violation then
      select *
      into existing
      from public.workout_attachments
      where user_id = caller_id
        and storage_path = p_storage_path
      limit 1;

      if existing.id is not null
         and existing.proof_key = p_proof_key
         and existing.linked_record_id = linked_id then
        if existing.is_current = true then
          return existing;
        end if;

        select *
        into current_replacement
        from public.workout_attachments
        where user_id = caller_id
          and proof_key = p_proof_key
          and linked_record_id = linked_id
          and is_current = true
        limit 1;

        if current_replacement.id is not null then
          return current_replacement;
        end if;

        raise exception 'proof attempt superseded';
      end if;

      raise exception 'idempotency key conflict for storage_path';
  end;
end;
$function$;

revoke all on function public.create_workout_proof_attachment(
  text, text, text, text, text, integer, integer, integer, integer, integer, integer, text, text
) from public;
grant execute on function public.create_workout_proof_attachment(
  text, text, text, text, text, integer, integer, integer, integer, integer, integer, text, text
) to authenticated;
