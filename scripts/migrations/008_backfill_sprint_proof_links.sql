-- Backfill sprint_sessions.attachment_id from current workout_attachments.
-- Run after scripts/migrations/007_proof_pending.sql

update public.sprint_sessions ss
set
  attachment_id = wa.id,
  updated_at = now()
from public.workout_attachments wa
where ss.attachment_id is null
  and ss.user_id = wa.user_id
  and wa.linked_record_id = ss.session_id
  and wa.is_current = true
  and wa.completion_cleared = false;
