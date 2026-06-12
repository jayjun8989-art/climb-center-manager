-- Admin password: grabon / wkaqhek2222 (safe to run repeatedly)

create extension if not exists pgcrypto;

update auth.users
set
  encrypted_password = crypt('wkaqhek2222', gen_salt('bf')),
  email = 'grabon@oncle.local',
  raw_user_meta_data = '{"login_id":"grabon","display_name":"Admin"}'::jsonb,
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where id = '22222222-2222-2222-2222-222222222201';

update auth.identities
set identity_data = jsonb_build_object('sub', user_id::text, 'email', 'grabon@oncle.local'),
    updated_at = now()
where user_id = '22222222-2222-2222-2222-222222222201';

notify pgrst, 'reload schema';
