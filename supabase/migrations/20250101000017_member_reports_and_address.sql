-- Member address + roster view for reports

alter table public.attendance_logs
  add column if not exists canceled_at timestamptz;

alter table public.members
  add column if not exists address text;

create or replace view public.member_roster_view
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
  m.updated_at
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

notify pgrst, 'reload schema';
