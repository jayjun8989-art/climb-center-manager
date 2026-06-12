# Supabase ??? SQL

Supabase Dashboard ? SQL Editor?? ?? ??? ??? ?? ???? ??? ? ????.  
?? ??? **Asia/Seoul (KST)** ???.

## ?? ?? ?? ??

```sql
-- ?? ??? ?? (KST ??)
select
  c.code as center_code,
  m.name as member_name,
  m.phone,
  m.member_type,
  ms.membership_type,
  ms.created_at at time zone 'Asia/Seoul' as membership_registered_at_kst
from public.memberships ms
join public.members m on m.id = ms.member_id
join public.centers c on c.id = m.center_id
where m.deleted_at is null
  and (ms.created_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
order by c.code, ms.created_at desc;
```

## members.member_type ??

```sql
select
  c.code as center_code,
  m.member_type,
  count(*) as member_count
from public.members m
join public.centers c on c.id = m.center_id
where m.deleted_at is null
group by c.code, m.member_type
order by c.code, m.member_type;
```

## memberships.membership_type ??

```sql
select
  c.code as center_code,
  ms.membership_type,
  ms.status,
  count(*) as membership_count
from public.memberships ms
join public.members m on m.id = ms.member_id
join public.centers c on c.id = m.center_id
where m.deleted_at is null
group by c.code, ms.membership_type, ms.status
order by c.code, ms.membership_type, ms.status;
```

## ?? ??

```sql
select
  p.email,
  c.code as center_code,
  ucr.role,
  ucr.created_at
from public.user_center_roles ucr
join public.profiles p on p.id = ucr.user_id
join public.centers c on c.id = ucr.center_id
order by p.email, c.code;
```

## ?? ?? ??

```sql
select
  c.code as center_code,
  m.name as member_name,
  a.checkin_at at time zone 'Asia/Seoul' as checkin_at_kst,
  a.attendance_type,
  a.deducted_count,
  a.canceled_at
from public.attendance_logs a
join public.members m on m.id = a.member_id
join public.centers c on c.id = a.center_id
where m.deleted_at is null
order by a.checkin_at desc
limit 50;
```

## ?? ??

```sql
select
  c.code as center_code,
  l.locker_number,
  m.name as member_name,
  m.phone,
  l.start_date,
  l.end_date,
  l.memo,
  l.updated_at at time zone 'Asia/Seoul' as updated_at_kst
from public.lockers l
join public.centers c on c.id = l.center_id
left join public.members m on m.id = l.member_id
order by c.code, l.locker_number;
```

## ?? ?? view ??

```sql
select *
from public.member_roster_view
order by center_code, member_name
limit 20;
```
