-- DEPRECATED: see scripts/MIGRATIONS.md for canonical migrations.
-- Allow JPEG/PNG proof uploads from iOS Safari (canvas WebP encoding is unsupported).
-- Run once in Supabase SQL editor after scripts/supabase-workout-proof.sql.

update storage.buckets
set allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']::text[]
where id = 'workout-proof-staging';
