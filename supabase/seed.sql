-- Run after creating first Auth user in Supabase Dashboard.
-- Replace USER_UUID with auth.users.id

-- Example: grant owner on both centers
-- insert into public.user_center_roles (user_id, center_id, role)
-- select 'YOUR-USER-UUID', id, 'owner' from public.centers;
