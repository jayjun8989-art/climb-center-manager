-- Align roles with app: manager -> admin, owner global access, staff management RPCs

-- ---------------------------------------------------------------------------
-- Rename manager -> admin
-- ---------------------------------------------------------------------------
update public.user_center_roles set role = 'admin' where role = 'manager';

alter table public.user_center_roles drop constraint if exists user_center_roles_role_check;
alter table public.user_center_roles
  add constraint user_center_roles_role_check
  check (role in ('owner', 'admin', 'staff', 'viewer'));

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'owner' then 4
    when 'admin' then 3
    when 'staff' then 2
    when 'viewer' then 1
    else 0
  end;
$$;

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
    else (
      select ucr.role
      from public.user_center_roles ucr
      where ucr.user_id = auth.uid()
        and ucr.center_id = p_center_id
      limit 1
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: user_center_roles read (admin+ on center, or own rows)
-- ---------------------------------------------------------------------------
drop policy if exists ucr_read on public.user_center_roles;
create policy ucr_read on public.user_center_roles for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_center_access(center_id, 'admin')
    or public.is_global_owner(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- RLS: members � soft delete owner-only
-- ---------------------------------------------------------------------------
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (
    public.has_center_access(center_id, 'staff')
    and deleted_at is null
  )
  with check (
    public.has_center_access(center_id, 'staff')
    and (
      deleted_at is null
      or public.is_global_owner(auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: memberships � split ALL policy; no client DELETE
-- ---------------------------------------------------------------------------
drop policy if exists memberships_all on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (public.has_center_access(center_id, 'viewer'));
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_center_access(center_id, 'admin'));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_center_access(center_id, 'admin'))
  with check (public.has_center_access(center_id, 'admin'));

-- ---------------------------------------------------------------------------
-- RPC: staff management (owner only, security definer)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_lookup_user_by_email(p_email text)
returns table (
  user_id uuid,
  display_name text,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_global_owner(auth.uid()) then
    raise exception 'access denied';
  end if;

  return query
  select u.id, coalesce(p.display_name, ''), coalesce(u.email, '')
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email));
end;
$$;

create or replace function public.rpc_list_center_roles()
returns table (
  id uuid,
  user_id uuid,
  center_id uuid,
  center_code text,
  center_name text,
  role text,
  display_name text,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_global_owner(auth.uid()) then
    raise exception 'access denied';
  end if;

  return query
  select
    ucr.id,
    ucr.user_id,
    ucr.center_id,
    c.code,
    c.name,
    ucr.role,
    coalesce(p.display_name, ''),
    coalesce(u.email, ''),
    ucr.created_at
  from public.user_center_roles ucr
  join public.centers c on c.id = ucr.center_id
  join auth.users u on u.id = ucr.user_id
  left join public.profiles p on p.id = ucr.user_id
  order by c.code, ucr.role desc, u.email;
end;
$$;

create or replace function public.rpc_assign_center_role(
  p_user_id uuid,
  p_center_code text,
  p_role text
)
returns public.user_center_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid;
  v_row public.user_center_roles%rowtype;
begin
  if not public.is_global_owner(auth.uid()) then
    raise exception 'access denied';
  end if;

  if p_role not in ('owner', 'admin', 'staff', 'viewer') then
    raise exception 'invalid role: %', p_role;
  end if;

  v_center_id := public.center_id_by_code(p_center_code);
  if v_center_id is null then
    raise exception 'unknown center: %', p_center_code;
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user not found';
  end if;

  insert into public.profiles (id, display_name)
  select u.id, coalesce(u.raw_user_meta_data->>'display_name', u.email, 'user')
  from auth.users u
  where u.id = p_user_id
  on conflict (id) do nothing;

  insert into public.user_center_roles (user_id, center_id, role)
  values (p_user_id, v_center_id, p_role)
  on conflict (user_id, center_id) do update
    set role = excluded.role
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.rpc_remove_center_role(p_role_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_owner_count integer;
begin
  if not public.is_global_owner(auth.uid()) then
    raise exception 'access denied';
  end if;

  select user_id into v_user_id
  from public.user_center_roles
  where id = p_role_id;

  if not found then
    return false;
  end if;

  select count(*) into v_owner_count
  from public.user_center_roles
  where role = 'owner';

  if v_owner_count <= 1 and exists (
    select 1 from public.user_center_roles where id = p_role_id and role = 'owner'
  ) then
    raise exception 'cannot remove the last owner role';
  end if;

  delete from public.user_center_roles where id = p_role_id;
  return true;
end;
$$;

grant execute on function public.rpc_lookup_user_by_email(text) to authenticated;
grant execute on function public.rpc_list_center_roles() to authenticated;
grant execute on function public.rpc_assign_center_role(uuid, text, text) to authenticated;
grant execute on function public.rpc_remove_center_role(uuid) to authenticated;
grant execute on function public.is_global_owner(uuid) to authenticated;
grant execute on function public.effective_center_role(uuid) to authenticated;
