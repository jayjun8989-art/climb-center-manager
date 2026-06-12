-- Operational v1: attendance cancel, lockers, role RPC aliases

-- attendance_logs: cancel + visit_type
alter table public.attendance_logs
  add column if not exists visit_type text,
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.profiles(id),
  add column if not exists cancel_reason text;

update public.attendance_logs
set visit_type = attendance_type
where visit_type is null;

create index if not exists idx_attendance_active
  on public.attendance_logs (member_id, checkin_at desc)
  where canceled_at is null;

-- memberships: explicit remaining_sessions alias (sync with remaining_count)
alter table public.memberships
  add column if not exists remaining_sessions integer;

update public.memberships
set remaining_sessions = remaining_count
where remaining_sessions is null and remaining_count is not null;

-- lockers
create table if not exists public.lockers (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete cascade,
  locker_number text not null,
  member_id uuid references public.members(id) on delete set null,
  status text not null default 'empty'
    check (status in ('empty', 'occupied', 'expired')),
  start_date date,
  end_date date,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (center_id, locker_number)
);

create index if not exists idx_lockers_center_status on public.lockers (center_id, status);
create index if not exists idx_lockers_member on public.lockers (member_id) where member_id is not null;

alter table public.lockers enable row level security;

create policy lockers_select on public.lockers for select to authenticated
  using (public.has_center_access(center_id, 'viewer'));

create policy lockers_write on public.lockers for all to authenticated
  using (public.has_center_access(center_id, 'staff'))
  with check (public.has_center_access(center_id, 'staff'));

-- Cancel attendance (owner/admin)
create or replace function public.rpc_cancel_attendance(
  p_attendance_id uuid,
  p_reason text default null
)
returns public.attendance_logs
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_log public.attendance_logs;
  v_membership public.memberships;
begin
  select * into v_log from public.attendance_logs where id = p_attendance_id;
  if not found then
    raise exception '?? ??? ?? ? ????.';
  end if;

  if not public.has_center_access(v_log.center_id, 'admin') then
    raise exception '?? ?? ??? ????.';
  end if;

  if v_log.canceled_at is not null then
    raise exception '?? ??? ?????.';
  end if;

  select * into v_membership from public.memberships where id = v_log.membership_id;

  if v_log.deducted_count > 0 and v_membership.pass_type = 'count' then
    update public.memberships
    set
      used_count = greatest(0, used_count - 1),
      remaining_count = coalesce(remaining_count, 0) + 1,
      remaining_sessions = coalesce(remaining_sessions, remaining_count, 0) + 1,
      status = case when status = 'finished' then 'active' else status end,
      updated_at = now()
    where id = v_membership.id;
  end if;

  update public.attendance_logs
  set
    canceled_at = now(),
    canceled_by = auth.uid(),
    cancel_reason = nullif(trim(p_reason), '')
  where id = p_attendance_id
  returning * into v_log;

  return v_log;
end;
$$;

grant execute on function public.rpc_cancel_attendance(uuid, text) to authenticated;

-- Role RPC aliases (v1 naming)
create or replace function public.rpc_find_user_by_email(p_email text)
returns table (user_id uuid, display_name text, email text)
language sql
security definer
set search_path = public, auth
as $$
  select * from public.rpc_lookup_user_by_email(p_email);
$$;

grant execute on function public.rpc_find_user_by_email(text) to authenticated;

create or replace function public.rpc_grant_center_role(
  p_user_id uuid,
  p_center_code text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return public.rpc_assign_center_role(p_user_id, p_center_code, p_role);
end;
$$;

grant execute on function public.rpc_grant_center_role(uuid, text, text) to authenticated;

create or replace function public.rpc_revoke_center_role(
  p_user_id uuid,
  p_center_code text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return public.rpc_remove_center_role_by_user_center(p_user_id, p_center_code);
end;
$$;

grant execute on function public.rpc_revoke_center_role(uuid, text) to authenticated;

notify pgrst, 'reload schema';
