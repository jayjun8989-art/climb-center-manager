-- Admin: both centers access (same operational scope as owner for RLS)
-- grabon@oncle.local: staff on ONCLE + GRABIT

create or replace function public.is_global_owner(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_center_roles
    where user_id = coalesce(p_user_id, auth.uid())
      and role = 'owner'
  );
$$;

create or replace function public.is_global_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_center_roles
    where user_id = coalesce(p_user_id, auth.uid())
      and role = 'admin'
  );
$$;

grant execute on function public.is_global_owner(uuid) to authenticated;
grant execute on function public.is_global_admin(uuid) to authenticated;

create or replace function public.has_center_access(p_center_id uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_global_owner(auth.uid()) then
      public.role_rank('owner') >= public.role_rank(p_min_role)
    when public.is_global_admin(auth.uid()) then
      public.role_rank('admin') >= public.role_rank(p_min_role)
    else exists (
      select 1
      from public.user_center_roles ucr
      where ucr.user_id = auth.uid()
        and ucr.center_id = p_center_id
        and public.role_rank(ucr.role) >= public.role_rank(p_min_role)
    )
  end;
$$;

create or replace function public.effective_center_role(p_center_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_global_owner(auth.uid()) then 'owner'
    when public.is_global_admin(auth.uid()) then 'admin'
    else (
      select ucr.role
      from public.user_center_roles ucr
      where ucr.user_id = auth.uid()
        and ucr.center_id = p_center_id
      limit 1
    )
  end;
$$;

-- grabon: staff on ONCLE + GRABIT
insert into public.user_center_roles (user_id, center_id, role)
values
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111001', 'staff'),
  ('22222222-2222-2222-2222-222222222203', '11111111-1111-1111-1111-111111111002', 'staff')
on conflict (user_id, center_id) do update set role = excluded.role;

notify pgrst, 'reload schema';
