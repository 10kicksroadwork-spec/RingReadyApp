-- Reconcile production proof security with canonical migration 003.
-- Attachments must only be created via create_workout_proof_attachment RPC.
--
-- Run after scripts/migrations/012_set_workout_proof_cleared.sql

drop policy if exists workout_attachments_insert_own on public.workout_attachments;
drop policy if exists workout_attachments_update_own on public.workout_attachments;

revoke insert, update on table public.workout_attachments from authenticated;
