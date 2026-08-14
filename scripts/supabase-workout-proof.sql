-- Ring Ready private workout-proof staging and evidence metadata.
-- Run after scripts/supabase-workout-data.sql.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workout-proof-staging',
  'workout-proof-staging',
  false,
  2621440,
  array['image/webp']::text[]
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
grant select, insert, update on table public.workout_attachments to authenticated;
grant select, update on table public.workout_attachments to service_role;
grant select on table public.athlete_profiles to service_role;

drop policy if exists workout_attachments_select_own on public.workout_attachments;
create policy workout_attachments_select_own on public.workout_attachments
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists workout_attachments_insert_own on public.workout_attachments;
create policy workout_attachments_insert_own on public.workout_attachments
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists workout_attachments_update_own on public.workout_attachments;
create policy workout_attachments_update_own on public.workout_attachments
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

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
alter table public.mile_tests add column if not exists test_key text not null default 'mile-test:baseline';
alter table public.mile_tests add column if not exists proof_policy_version integer;
alter table public.mile_tests add column if not exists attachment_id uuid references public.workout_attachments(id);

drop index if exists public.mile_tests_user_id_idx;
create unique index if not exists mile_tests_user_test_key_idx
  on public.mile_tests(user_id, test_key);
