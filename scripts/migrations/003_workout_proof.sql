-- Ring Ready private workout-proof staging and evidence metadata.
-- Run after scripts/migrations/001_workout_data.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workout-proof-staging',
  'workout-proof-staging',
  false,
  2621440,
  array['image/webp', 'image/jpeg', 'image/png']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.workout_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proof_key text not null,
  linked_record_id text not null default '',
  camp_length integer check (camp_length is null or camp_length in (4, 7)),
  week_index integer,
  workout_index integer,
  workout_type text not null default '',
  day_of_week text not null default '',
  storage_bucket text not null default 'workout-proof-staging',
  storage_path text not null,
  original_filename text not null default 'workout-proof.webp',
  mime_type text not null default 'image/webp',
  file_size integer not null check (file_size > 0 and file_size <= 2621440),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  transfer_status text not null default 'pending' check (transfer_status in ('pending', 'processing', 'complete', 'failed')),
  transfer_attempts integer not null default 0,
  transfer_error text not null default '',
  drive_file_id text not null default '',
  drive_url text not null default '',
  is_current boolean not null default true,
  completion_cleared boolean not null default false,
  uploaded_at timestamptz not null default now(),
  transferred_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, storage_path)
);

create unique index if not exists workout_attachments_current_proof_idx
  on public.workout_attachments(user_id, proof_key)
  where is_current;

create index if not exists workout_attachments_transfer_status_idx
  on public.workout_attachments(transfer_status, uploaded_at);

alter table public.workout_attachments enable row level security;
grant select on table public.workout_attachments to authenticated;
grant select, update on table public.workout_attachments to service_role;
grant select on table public.athlete_profiles to service_role;

drop policy if exists workout_attachments_select_own on public.workout_attachments;
create policy workout_attachments_select_own on public.workout_attachments
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists workout_attachments_insert_own on public.workout_attachments;
drop policy if exists workout_attachments_update_own on public.workout_attachments;

revoke insert, update on table public.workout_attachments from authenticated;

drop policy if exists workout_proof_storage_select_own on storage.objects;
create policy workout_proof_storage_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'workout-proof-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists workout_proof_storage_insert_own on storage.objects;
create policy workout_proof_storage_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'workout-proof-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists workout_proof_storage_update_own on storage.objects;
create policy workout_proof_storage_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'workout-proof-staging' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'workout-proof-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists workout_proof_storage_delete_own on storage.objects;
create policy workout_proof_storage_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'workout-proof-staging' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.workout_completions add column if not exists proof_policy_version integer;
alter table public.workout_completions add column if not exists attachment_id uuid references public.workout_attachments(id);
alter table public.sprint_sessions add column if not exists proof_policy_version integer;
alter table public.sprint_sessions add column if not exists attachment_id uuid references public.workout_attachments(id);
alter table public.mile_tests add column if not exists proof_policy_version integer;
alter table public.mile_tests add column if not exists attachment_id uuid references public.workout_attachments(id);

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

create or replace function public.set_workout_proof_cleared(attachment_id uuid, cleared boolean)
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
  set completion_cleared = coalesce(cleared, false), updated_at = now()
  where id = attachment_id and user_id = auth.uid();
  if not found then
    raise exception 'Attachment not found or not owned by caller';
  end if;
end;
$function$;

revoke all on function public.set_workout_proof_cleared(uuid, boolean) from public;
grant execute on function public.set_workout_proof_cleared(uuid, boolean) to authenticated;

drop function if exists public.prepare_workout_proof_upload(text);
