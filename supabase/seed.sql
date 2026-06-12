-- Run after creating Auth users in Supabase Dashboard.
-- Replace USER_UUID with auth.users.id

-- Example: grant owner on both centers
-- insert into public.user_center_roles (user_id, center_id, role)
-- select 'YOUR-USER-UUID', id, 'owner' from public.centers;

-- Roles: owner | admin | staff | viewer
-- Run migration 20250101000002_admin_roles_and_staff_rpcs.sql before using admin role name.
