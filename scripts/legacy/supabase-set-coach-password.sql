-- DEPRECATED: use scripts/migrations/ — see scripts/MIGRATIONS.md

-- Set a password for 10kicksroadwork@gmail.com
-- Run in Supabase SQL Editor (Authentication users created via "Add user"
-- often cannot sign in on a new device until a password is set and the
-- email is confirmed).
--
-- 1. Replace CHANGE_ME_BEFORE_RUNNING with a password of at least 8 characters.
-- 2. Run this once.
-- 3. Sign in on the phone with 10kicksroadwork@gmail.com and that password.
-- 4. Change the password later from the dashboard if you want.

do $$
declare
  new_password text := 'CHANGE_ME_BEFORE_RUNNING';
  updated_count integer;
begin
  if new_password = 'CHANGE_ME_BEFORE_RUNNING' or length(new_password) < 8 then
    raise exception 'Replace CHANGE_ME_BEFORE_RUNNING with a password of at least 8 characters before running.';
  end if;

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
  where lower(email) = '10kicksroadwork@gmail.com';

  get diagnostics updated_count = row_count;

  if updated_count = 0 then
    raise exception 'No auth user found for 10kicksroadwork@gmail.com';
  end if;
end $$;
