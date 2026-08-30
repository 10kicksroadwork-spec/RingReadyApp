-- Ad-hoc query: list current workout proofs with athlete names.
-- For Table Editor columns on all tables, run instead:
--   scripts/supabase-athlete-name-all-tables.sql
--
-- That adds athlete_name on every fighter-linked table (visible in Table Editor).

-- Current proof files only (one per proof_key per athlete)
select
  coalesce(nullif(trim(p.athlete_name), ''), u.email, wa.user_id::text) as athlete_name,
  lower(u.email::text) as athlete_email,
  wa.id as attachment_id,
  wa.proof_key,
  wa.workout_type,
  case
    when wa.week_index is null then 'Mile Test'
    else 'Week ' || (wa.week_index + 1)::text
  end as week_label,
  wa.week_index,
  wa.workout_index,
  wa.day_of_week,
  wa.original_filename,
  wa.mime_type,
  wa.file_size,
  wa.transfer_status,
  wa.drive_url,
  wa.is_current,
  wa.completion_cleared,
  wa.uploaded_at,
  wa.transferred_at,
  wa.storage_path
from public.workout_attachments wa
left join public.athlete_profiles p on p.user_id = wa.user_id
left join auth.users u on u.id = wa.user_id
where wa.is_current = true
order by wa.uploaded_at desc;


-- All attachment rows (including replaced/historical uploads)
-- select
--   coalesce(nullif(trim(p.athlete_name), ''), u.email, wa.user_id::text) as athlete_name,
--   lower(u.email::text) as athlete_email,
--   wa.*
-- from public.workout_attachments wa
-- left join public.athlete_profiles p on p.user_id = wa.user_id
-- left join auth.users u on u.id = wa.user_id
-- order by wa.uploaded_at desc;


-- Lookup one athlete by name (example: Marcus)
-- select
--   coalesce(nullif(trim(p.athlete_name), ''), u.email, wa.user_id::text) as athlete_name,
--   wa.proof_key,
--   wa.workout_type,
--   wa.transfer_status,
--   wa.drive_url,
--   wa.uploaded_at,
--   wa.storage_path,
--   wa.id as attachment_id
-- from public.workout_attachments wa
-- left join public.athlete_profiles p on p.user_id = wa.user_id
-- left join auth.users u on u.id = wa.user_id
-- where wa.is_current = true
--   and coalesce(nullif(trim(p.athlete_name), ''), u.email, '') ilike '%marcus%'
-- order by wa.uploaded_at desc;
