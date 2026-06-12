-- Default accounts (safe to run repeatedly in Supabase SQL Editor).
-- Admin (both centers): grabon / wkaqhek2222
-- ONCLE staff: oncle / oncle
-- GRABIT staff: grabit / grabit

create extension if not exists pgcrypto;

do $$
declare
  rec record;
begin
  for rec in
    select *
    from (
      values
        (
          '22222222-2222-2222-2222-222222222201'::uuid,
          'grabon@oncle.local',
          'wkaqhek2222',
          '{"login_id":"grabon","display_name":"Admin"}'::jsonb,
          'Admin'
        ),
        (
          '22222222-2222-2222-2222-222222222203'::uuid,
          'oncle@oncle.local',
          'oncle',
          '{"login_id":"oncle","display_name":"ONCLE Staff"}'::jsonb,
          'ONCLE Staff'
        ),
        (
          '22222222-2222-2222-2222-222222222202'::uuid,
          'grabit@oncle.local',
          'grabit',
          '{"login_id":"grabit","display_name":"GRABIT Staff"}'::jsonb,
          'GRABIT Staff'
        )
    ) as t(id, email, password, meta, display_name)
  loop
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
      rec.id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      rec.email,
      crypt(rec.password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      rec.meta,
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
      raw_app_meta_data = excluded.raw_app_meta_data,
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
      rec.id,
      rec.id,
      jsonb_build_object('sub', rec.id::text, 'email', rec.email),
      'email',
      rec.id::text,
      now(),
      now(),
      now()
    )
    on conflict (provider, provider_id) do update set
      user_id = excluded.user_id,
      identity_data = excluded.identity_data,
      updated_at = now();

    insert into public.profiles (id, display_name)
    values (rec.id, rec.display_name)
    on conflict (id) do update set display_name = excluded.display_name;
  end loop;
end $$;

update auth.users
set
  email = 'legacy-admin-' || id::text || '@oncle.local',
  updated_at = now()
where email in ('admin@oncle.local')
  and id <> '22222222-2222-2222-2222-222222222201'::uuid;

update auth.users
set
  email = 'legacy-oncle-' || id::text || '@oncle.local',
  updated_at = now()
where email = 'oncle@oncle.local'
  and id <> '22222222-2222-2222-2222-222222222203'::uuid;

update auth.users
set
  email = 'legacy-grabit-' || id::text || '@oncle.local',
  updated_at = now()
where email = 'grabit@oncle.local'
  and id <> '22222222-2222-2222-2222-222222222202'::uuid;

update auth.users
set
  email = 'grabon@oncle.local',
  encrypted_password = crypt('wkaqhek2222', gen_salt('bf')),
  raw_user_meta_data = '{"login_id":"grabon","display_name":"Admin"}'::jsonb,
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where id = '22222222-2222-2222-2222-222222222201';

update auth.users
set
  email = 'oncle@oncle.local',
  encrypted_password = crypt('oncle', gen_salt('bf')),
  raw_user_meta_data = '{"login_id":"oncle","display_name":"ONCLE Staff"}'::jsonb,
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where id = '22222222-2222-2222-2222-222222222203';

update auth.users
set
  email = 'grabit@oncle.local',
  encrypted_password = crypt('grabit', gen_salt('bf')),
  raw_user_meta_data = '{"login_id":"grabit","display_name":"GRABIT Staff"}'::jsonb,
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  updated_at = now()
where id = '22222222-2222-2222-2222-222222222202';

update auth.identities
set identity_data = jsonb_build_object('sub', user_id::text, 'email', 'grabon@oncle.local'),
    updated_at = now()
where user_id = '22222222-2222-2222-2222-222222222201';

update auth.identities
set identity_data = jsonb_build_object('sub', user_id::text, 'email', 'oncle@oncle.local'),
    updated_at = now()
where user_id = '22222222-2222-2222-2222-222222222203';

update auth.identities
set identity_data = jsonb_build_object('sub', user_id::text, 'email', 'grabit@oncle.local'),
    updated_at = now()
where user_id = '22222222-2222-2222-2222-222222222202';

delete from public.user_center_roles
where user_id in (
  '22222222-2222-2222-2222-222222222202',
  '22222222-2222-2222-2222-222222222203'
)
and center_id = '11111111-1111-1111-1111-111111111001'
and role = 'staff';

insert into public.user_center_roles (user_id, center_id, role)
values
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111001', 'owner'),
  ('22222222-2222-2222-2222-222222222201', '11111111-1111-1111-1111-111111111002', 'owner'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111001', 'staff'),
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111002', 'staff')
on conflict (user_id, center_id) do update set role = excluded.role;

notify pgrst, 'reload schema';
