-- Staff accounts: one center only (Manager tab).
-- Admin/owner: unified ONCLE + GRABIT access.
-- grabit (GRABIT staff): GRABIT only.

delete from public.user_center_roles
where user_id = '22222222-2222-2222-2222-222222222202'
  and center_id = '11111111-1111-1111-1111-111111111001';

insert into public.user_center_roles (user_id, center_id, role)
values
  ('22222222-2222-2222-2222-222222222202', '11111111-1111-1111-1111-111111111002', 'staff')
on conflict (user_id, center_id) do update set role = excluded.role;

notify pgrst, 'reload schema';
