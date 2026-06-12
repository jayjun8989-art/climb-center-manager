-- Per-center owner can list roles for centers they own (not global owner only)

drop function if exists public.rpc_list_center_roles();

create or replace function public.rpc_list_center_roles()
returns table (
  user_id uuid,
  user_email text,
  center_id uuid,
  center_code text,
  center_name text,
  role text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    ucr.user_id,
    au.email::text as user_email,
    c.id as center_id,
    c.code::text as center_code,
    c.name::text as center_name,
    ucr.role::text as role,
    ucr.created_at
  from public.user_center_roles ucr
  join public.centers c on c.id = ucr.center_id
  left join auth.users au on au.id = ucr.user_id
  where exists (
    select 1
    from public.user_center_roles my_role
    where my_role.user_id = auth.uid()
      and my_role.center_id = ucr.center_id
      and my_role.role = 'owner'
  )
  order by c.code, ucr.created_at desc;
$$;

grant execute on function public.rpc_list_center_roles() to authenticated;

-- Remove role by user + center (caller must be owner on that center)
create or replace function public.rpc_remove_center_role_by_user_center(
  p_user_id uuid,
  p_center_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_center_id uuid;
  v_role text;
  v_owner_count integer;
begin
  v_center_id := public.center_id_by_code(p_center_code);
  if v_center_id is null then
    raise exception 'unknown center: %', p_center_code;
  end if;

  if not exists (
    select 1 from public.user_center_roles
    where user_id = auth.uid()
      and center_id = v_center_id
      and role = 'owner'
  ) then
    raise exception 'access denied';
  end if;

  select role into v_role
  from public.user_center_roles
  where user_id = p_user_id and center_id = v_center_id;

  if not found then
    return false;
  end if;

  if v_role = 'owner' then
    select count(*) into v_owner_count
    from public.user_center_roles
    where center_id = v_center_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'cannot remove the last owner role for this center';
    end if;
  end if;

  delete from public.user_center_roles
  where user_id = p_user_id and center_id = v_center_id;

  return true;
end;
$$;

grant execute on function public.rpc_remove_center_role_by_user_center(uuid, text) to authenticated;

notify pgrst, 'reload schema';
