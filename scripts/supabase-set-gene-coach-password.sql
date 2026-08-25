-- Set password for Gene's coach account
-- Run in Supabase SQL Editor.
--
-- Email:    gene.byard@gmail.com
-- Password: Gene10kicks
--
-- This is Gene's coach login (roster / notes), separate from his athlete
-- account (10kicksmuaythai@gmail.com).
--
-- Steps:
-- 1. Run this once in the SQL Editor.
-- 2. Sign in at https://ring-ready-app.vercel.app with
--    gene.byard@gmail.com / Gene10kicks
--
-- Safe to re-run: resets the password and confirms the email.

do $$
declare
  coach_email text := 'gene.byard@gmail.com';
  new_password text := 'Gene10kicks';
  updated_count integer;
begin
  update auth.users
  set
    encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    confirmation_token = '',
    recovery_token = '',
    email_change_token_new = '',
    email_change = '',
    invited_at = null,
    raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    updated_at = now()
  where lower(email) = lower(coach_email);

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception 'No auth user found for %. Create the user in Authentication first, then re-run.', coach_email;
  end if;

  raise notice 'Password set for %', coach_email;
end $$;
