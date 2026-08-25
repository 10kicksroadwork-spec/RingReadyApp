-- Create Gene Byard's athlete-side Ring Ready account
-- Run in Supabase SQL Editor.
--
-- This is a NEW athlete login, separate from Gene's coach account
-- (gene.byard@gmail.com). He will use this email to log roadwork.
--
-- Email:  10kicksmuaythai@gmail.com
-- Name:   Gene Byard
--
-- Steps:
-- 1. Replace CHANGE_ME_BEFORE_RUNNING (line below) with a password of at least 8 characters.
-- 2. Run this once in the SQL Editor.
-- 3. Gene signs in at https://ring-ready-app.vercel.app with
--    10kicksmuaythai@gmail.com and that password.
-- 4. He can finish Age / HR / Fight Date / Camp Length in Profile inside the app.
--
-- Safe to re-run: if the auth user already exists, it resets the password,
-- confirms the email, and refreshes the athlete profile name.

do $$
declare
  athlete_email text := '10kicksmuaythai@gmail.com';
  athlete_name text := 'Gene Byard';
  new_password text := 'CHANGE_ME_BEFORE_RUNNING';
  new_user_id uuid;
  existing_user_id uuid;
  auth_instance_id uuid;
begin
  if new_password = 'CHANGE_ME_BEFORE_RUNNING' or length(new_password) < 8 then
    raise exception 'Replace CHANGE_ME_BEFORE_RUNNING with a password of at least 8 characters before running.';
  end if;

  select id into auth_instance_id from auth.instances limit 1;
  if auth_instance_id is null then
    auth_instance_id := '00000000-0000-0000-0000-000000000000';
  end if;

  select id into existing_user_id
  from auth.users
  where lower(email) = lower(athlete_email)
  limit 1;

  if existing_user_id is null then
    new_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    ) values (
      auth_instance_id,
      new_user_id,
      'authenticated',
      'authenticated',
      lower(athlete_email),
      extensions.crypt(new_password, extensions.gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('athlete_name', athlete_name),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      new_user_id,
      jsonb_build_object(
        'sub', new_user_id::text,
        'email', lower(athlete_email),
        'email_verified', true
      ),
      'email',
      new_user_id::text,
      now(),
      now(),
      now()
    );
  else
    new_user_id := existing_user_id;

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
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('athlete_name', athlete_name),
      updated_at = now()
    where id = new_user_id;

    if not exists (
      select 1
      from auth.identities
      where user_id = new_user_id
        and provider = 'email'
    ) then
      insert into auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      ) values (
        gen_random_uuid(),
        new_user_id,
        jsonb_build_object(
          'sub', new_user_id::text,
          'email', lower(athlete_email),
          'email_verified', true
        ),
        'email',
        new_user_id::text,
        now(),
        now(),
        now()
      );
    end if;
  end if;

  insert into public.athlete_profiles (
    user_id,
    athlete_name,
    camp_length,
    default_modality,
    updated_at
  ) values (
    new_user_id,
    athlete_name,
    7,
    'running',
    now()
  )
  on conflict (user_id) do update
  set
    athlete_name = excluded.athlete_name,
    default_modality = coalesce(public.athlete_profiles.default_modality, 'running'),
    updated_at = now();

  raise notice 'Athlete account ready for % (%) as %', athlete_name, athlete_email, new_user_id;
end $$;
