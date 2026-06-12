-- Mobile admin app (GRABON Manager) support: audit log table + grabon-only
-- update RPCs + member_status column on the roster view.
-- Does not modify or delete any existing data, tables, or RLS policies.

-- ---------------------------------------------------------------------------
-- Add member_status to the existing roster view (additive only, appended
-- at the end since views cannot reorder/rename existing columns)
-- ---------------------------------------------------------------------------
drop view if exists public.member_roster_view;

create view public.member_roster_view
with (security_invoker = true) as
select
  m.center_id,
  c.code as center_code,
  m.id as member_id,
  m.name as member_name,
  m.phone,
  m.address,
  m.member_type,
  case m.member_type
    when 'regular' then '일반'
    when 'junior' then '주니어'
    when 'trial' then '체험'
    else m.member_type
  end as member_type_label,
  m.created_at as first_registered_at,
  ms.id as membership_id,
  ms.membership_type,
  case ms.membership_type
    when 'monthly' then '월권/기간권'
    when 'session' then '횟수권'
    when 'junior' then '주니어권'
    when 'trial' then '체험'
    else ms.membership_type
  end as membership_type_label,
  ms.created_at as membership_registered_at,
  ms.start_date,
  ms.end_date,
  case
    when ms.start_date is not null and ms.end_date is not null
      then (ms.end_date - ms.start_date)
    else null
  end as registration_period_days,
  ms.total_count as total_sessions,
  coalesce(ms.remaining_count, ms.remaining_sessions) as remaining_sessions,
  ms.status as membership_status,
  (
    select max(a.checkin_at)
    from public.attendance_logs a
    where a.member_id = m.id
      and a.canceled_at is null
  ) as latest_visit_at,
  (
    select l.locker_number
    from public.lockers l
    where l.member_id = m.id
      and l.center_id = m.center_id
    order by l.updated_at desc nulls last, l.created_at desc
    limit 1
  ) as locker_number,
  (
    select max(ms_all.end_date)
    from public.memberships ms_all
    where ms_all.member_id = m.id
  ) as latest_membership_end_date,
  m.memo,
  m.created_at,
  m.updated_at,
  m.status as member_status
from public.members m
join public.centers c on c.id = m.center_id
left join lateral (
  select *
  from public.memberships ms2
  where ms2.member_id = m.id
  order by
    case ms2.status when 'active' then 0 when 'paused' then 1 else 2 end,
    ms2.created_at desc
  limit 1
) ms on true
where m.deleted_at is null;

grant select on public.member_roster_view to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: is the current session the GRABON admin account?
-- ---------------------------------------------------------------------------
create or replace function public.is_grabon_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'grabon@oncle.local';
$$;

-- ---------------------------------------------------------------------------
-- audit_logs: shared change-history table for PC + mobile
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid references public.centers(id),
  entity_type text not null check (entity_type in ('member', 'membership', 'attendance', 'locker')),
  entity_id uuid,
  entity_name text,
  action text not null check (action in ('update', 'delete', 'soft_delete', 'restore', 'clear_locker')),
  before_data jsonb,
  after_data jsonb,
  actor_email text,
  actor_role text,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_center on public.audit_logs (center_id, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

-- Only owners (PC admins) or the GRABON mobile admin can read change history.
-- No direct insert/update/delete policy: rows are written only via
-- security-definer RPC functions below (and can be wired up from the PC app).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    public.is_grabon_admin()
    or (center_id is not null and public.has_center_access(center_id, 'owner'))
  );

-- ---------------------------------------------------------------------------
-- Generic helper to insert an audit row (security definer, no RLS required)
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(
  p_center_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_name text,
  p_action text,
  p_before jsonb,
  p_after jsonb,
  p_memo text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    center_id, entity_type, entity_id, entity_name, action,
    before_data, after_data, actor_email, actor_role, memo
  ) values (
    p_center_id, p_entity_type, p_entity_id, p_entity_name, p_action,
    p_before, p_after, auth.jwt() ->> 'email',
    case when public.is_grabon_admin() then 'grabon' else 'staff' end,
    p_memo
  );
end;
$$;

grant execute on function public.log_audit(uuid, text, uuid, text, text, jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: GRABON-only member update (name/phone/memo/member_type)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_mobile_update_member(
  p_member_id uuid,
  p_patch jsonb,
  p_memo text default null
) returns public.members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.members%rowtype;
  v_after public.members%rowtype;
begin
  if not public.is_grabon_admin() then
    raise exception '모바일 앱은 관리자 계정만 사용할 수 있습니다.';
  end if;

  select * into v_before from public.members where id = p_member_id and deleted_at is null;
  if not found then
    raise exception '회원을 찾을 수 없습니다.';
  end if;

  update public.members set
    name = coalesce(p_patch ->> 'name', name),
    phone = case when p_patch ? 'phone' then nullif(p_patch ->> 'phone', '') else phone end,
    memo = case when p_patch ? 'memo' then p_patch ->> 'memo' else memo end,
    member_type = coalesce(p_patch ->> 'member_type', member_type),
    updated_by = auth.uid(),
    updated_at = now(),
    version = version + 1
  where id = p_member_id
  returning * into v_after;

  perform public.log_audit(
    v_after.center_id, 'member', v_after.id, v_after.name, 'update',
    to_jsonb(v_before), to_jsonb(v_after), p_memo
  );

  return v_after;
end;
$$;

grant execute on function public.rpc_mobile_update_member(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: GRABON-only membership update (dates / total & remaining counts)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_mobile_update_membership(
  p_membership_id uuid,
  p_patch jsonb,
  p_memo text default null
) returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.memberships%rowtype;
  v_after public.memberships%rowtype;
  v_total integer;
  v_remaining integer;
  v_member_name text;
begin
  if not public.is_grabon_admin() then
    raise exception '모바일 앱은 관리자 계정만 사용할 수 있습니다.';
  end if;

  select * into v_before from public.memberships where id = p_membership_id;
  if not found then
    raise exception '회원권을 찾을 수 없습니다.';
  end if;

  v_total := case when p_patch ? 'total_count' then (p_patch ->> 'total_count')::integer else v_before.total_count end;
  v_remaining := case when p_patch ? 'remaining_count' then (p_patch ->> 'remaining_count')::integer else v_before.remaining_count end;

  if v_total is not null and v_remaining is not null and v_remaining > v_total then
    if v_before.membership_type = 'junior' then
      raise exception '잔여 수업 횟수는 총 수업 횟수보다 클 수 없습니다.';
    end if;
    raise exception '잔여 횟수는 총 횟수보다 클 수 없습니다.';
  end if;

  if v_remaining is not null and v_remaining < 0 then
    raise exception '잔여 횟수는 0 이상이어야 합니다.';
  end if;

  update public.memberships set
    start_date = case when p_patch ? 'start_date' then (p_patch ->> 'start_date')::date else start_date end,
    end_date = case when p_patch ? 'end_date' then (p_patch ->> 'end_date')::date else end_date end,
    total_count = v_total,
    remaining_count = v_remaining,
    remaining_sessions = v_remaining,
    used_count = case
      when v_total is not null and v_remaining is not null then greatest(0, v_total - v_remaining)
      else used_count
    end,
    status = case
      when pass_type = 'count' and v_remaining is not null and v_remaining <= 0 then 'finished'
      when pass_type = 'count' and status = 'finished' and v_remaining is not null and v_remaining > 0 then 'active'
      else status
    end,
    updated_at = now(),
    version = version + 1
  where id = p_membership_id
  returning * into v_after;

  select name into v_member_name from public.members where id = v_after.member_id;

  perform public.log_audit(
    v_after.center_id, 'membership', v_after.id, v_member_name, 'update',
    to_jsonb(v_before), to_jsonb(v_after), p_memo
  );

  return v_after;
end;
$$;

grant execute on function public.rpc_mobile_update_membership(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: GRABON-only locker update (status/dates/memo + linked member name/phone)
-- ---------------------------------------------------------------------------
create or replace function public.rpc_mobile_update_locker(
  p_locker_id uuid,
  p_patch jsonb,
  p_memo text default null
) returns public.lockers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.lockers%rowtype;
  v_after public.lockers%rowtype;
  v_member_before public.members%rowtype;
  v_member_after public.members%rowtype;
begin
  if not public.is_grabon_admin() then
    raise exception '모바일 앱은 관리자 계정만 사용할 수 있습니다.';
  end if;

  select * into v_before from public.lockers where id = p_locker_id;
  if not found then
    raise exception '락카를 찾을 수 없습니다.';
  end if;

  update public.lockers set
    start_date = case when p_patch ? 'start_date' then (p_patch ->> 'start_date')::date else start_date end,
    end_date = case when p_patch ? 'end_date' then (p_patch ->> 'end_date')::date else end_date end,
    status = coalesce(p_patch ->> 'status', status),
    memo = case when p_patch ? 'memo' then p_patch ->> 'memo' else memo end,
    updated_at = now()
  where id = p_locker_id
  returning * into v_after;

  perform public.log_audit(
    v_after.center_id, 'locker', v_after.id, v_after.locker_number, 'update',
    to_jsonb(v_before), to_jsonb(v_after), p_memo
  );

  if v_after.member_id is not null and (p_patch ? 'member_name' or p_patch ? 'member_phone') then
    select * into v_member_before from public.members where id = v_after.member_id;

    update public.members set
      name = coalesce(p_patch ->> 'member_name', name),
      phone = case when p_patch ? 'member_phone' then nullif(p_patch ->> 'member_phone', '') else phone end,
      updated_at = now(),
      version = version + 1
    where id = v_after.member_id
    returning * into v_member_after;

    perform public.log_audit(
      v_member_after.center_id, 'member', v_member_after.id, v_member_after.name, 'update',
      to_jsonb(v_member_before), to_jsonb(v_member_after), p_memo
    );
  end if;

  return v_after;
end;
$$;

grant execute on function public.rpc_mobile_update_locker(uuid, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
