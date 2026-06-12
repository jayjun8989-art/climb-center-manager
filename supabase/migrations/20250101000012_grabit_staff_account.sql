-- GRABIT staff account: login id grabit / password grabit
-- Supabase sign-in email: grabit@oncle.local
-- Role: staff on GRABIT only (re-run safe)

create extension if not exists pgcrypto;

do $$
declare
  v_user_id uuid := '22222222-2222-2222-2222-222222222202';
  v_email text := 'grabit@oncle.local';
  v_password text := 'grabit';
begin
  insert into auth.users (
    id,
    instance_id,
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
    email_change,
    email_change_token_new,
    email_change_token_current,
    reauthentication_token,
    phone_change,
    phone_change_token
  ) values (
    v_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"login_id":"grabit","display_name":"GRABIT Staff"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  )
  on conflict (id) do update set
    encrypted_password = excluded.encrypted_password,
    email = excluded.email,
    email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
    raw_user_meta_data = excluded.raw_user_meta_data,
    confirmation_token = '',
    recovery_token = '',
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    reauthentication_token = '',
    phone_change = '',
    phone_change_token = '',
    updated_at = now();

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
    v_user_id,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email),
    'email',
    v_user_id::text,
    now(),
    now(),
    now()
  )
  on conflict (provider, provider_id) do update set
    user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

  insert into public.profiles (id, display_name)
  values (v_user_id, 'GRABIT Staff')
  on conflict (id) do update set display_name = excluded.display_name;
end $$;

delete from public.user_center_roles
where user_id = '22222222-2222-2222-2222-222222222202'
  and center_id = '11111111-1111-1111-1111-111111111001';

insert into public.user_center_roles (user_id, center_id, role)
values
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111002', 'staff')
on conflict (user_id, center_id) do update set role = excluded.role;

notify pgrst, 'reload schema';
