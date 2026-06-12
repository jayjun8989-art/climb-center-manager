-- member_list_view: filter fields + inactive 30-day category support

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
  ) as last_visit_at,
  (
    select max(ms_all.end_date)
    from public.memberships ms_all
    where ms_all.member_id = m.id
  ) as latest_membership_end_date,
  (
    select ms_last.membership_type
    from public.memberships ms_last
    where ms_last.member_id = m.id
    order by ms_last.end_date desc nulls last, ms_last.created_at desc
    limit 1
  ) as latest_membership_type,
  case
    when (
      select max(ms_all.end_date)
      from public.memberships ms_all
      where ms_all.member_id = m.id
    ) is null then null
    else greatest(
      0,
      (current_date - (
        select max(ms_all.end_date)
        from public.memberships ms_all
        where ms_all.member_id = m.id
      ))::integer
    )
  end as days_since_expired,
  (
    (
      select max(ms_all.end_date)
      from public.memberships ms_all
      where ms_all.member_id = m.id
    ) is null
    or (
      select max(ms_all.end_date)
      from public.memberships ms_all
      where ms_all.member_id = m.id
    ) < current_date - interval '30 days'
  ) as is_inactive_30_days
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

notify pgrst, 'reload schema';
