-- Phase 1b: list view + pause/resume RPCs

create or replace view public.member_list_view as
select
  m.id,
  m.center_id,
  c.code as center_code,
  m.name,
  m.phone,
  m.member_type,
  m.memo,
  m.status,
  ms.id as membership_id,
  ms.membership_type,
  ms.pass_type,
  ms.start_date,
  ms.end_date,
  ms.total_count,
  ms.remaining_count,
  ms.status as membership_status,
  m.created_at,
  m.updated_at,
  (
    select max(a.checkin_at)
    from public.attendance_logs a
    where a.member_id = m.id
  ) as last_visit_at
from public.members m
join public.centers c on c.id = m.center_id
left join lateral (
  select *
  from public.memberships ms2
  where ms2.member_id = m.id
    and ms2.status in ('active', 'paused')
  order by case ms2.status when 'active' then 0 else 1 end, ms2.created_at desc
  limit 1
) ms on true
where m.deleted_at is null;

create or replace function public.rpc_pause_membership(
  p_membership_id uuid,
  p_reason text default null
)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships%rowtype;
begin
  select * into v_membership
  from public.memberships
  where id = p_membership_id;

  if not found then
    raise exception 'membership not found';
  end if;

  if not public.has_center_access(v_membership.center_id, 'staff') then
    raise exception 'access denied';
  end if;

  if v_membership.status <> 'active' then
    raise exception 'only active memberships can be paused';
  end if;

  update public.memberships
  set status = 'paused', updated_at = now(), version = version + 1
  where id = p_membership_id
  returning * into v_membership;

  insert into public.pause_logs (
    member_id, membership_id, center_id, pause_start_date, reason, created_by
  ) values (
    v_membership.member_id,
    v_membership.id,
    v_membership.center_id,
    current_date,
    p_reason,
    auth.uid()
  );

  update public.members
  set status = 'paused', updated_at = now(), version = version + 1
  where id = v_membership.member_id;

  return v_membership;
end;
$$;

create or replace function public.rpc_resume_membership(p_membership_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.memberships%rowtype;
  v_pause public.pause_logs%rowtype;
begin
  select * into v_membership
  from public.memberships
  where id = p_membership_id;

  if not found then
    raise exception 'membership not found';
  end if;

  if not public.has_center_access(v_membership.center_id, 'staff') then
    raise exception 'access denied';
  end if;

  if v_membership.status <> 'paused' then
    raise exception 'membership is not paused';
  end if;

  select * into v_pause
  from public.pause_logs
  where membership_id = p_membership_id and pause_end_date is null
  order by pause_start_date desc
  limit 1;

  if found then
    update public.pause_logs
    set pause_end_date = current_date, updated_at = now()
    where id = v_pause.id;
  end if;

  update public.memberships
  set status = 'active', updated_at = now(), version = version + 1
  where id = p_membership_id
  returning * into v_membership;

  update public.members
  set status = 'active', updated_at = now(), version = version + 1
  where id = v_membership.member_id;

  return v_membership;
end;
$$;

grant select on public.member_list_view to authenticated;
