-- Migration 22: Care management tables + Dashboard RPCs + Realtime
-- ─────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────
-- 1. member_care_profiles
-- ─────────────────────────────────────────────────
create table if not exists public.member_care_profiles (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  center_id uuid not null references public.centers(id),
  status text not null default 'pending'
    check (status in ('pending','active','monitoring','completed','suspended')),
  priority integer not null default 5 check (priority between 1 and 10),
  care_reason text[],
  assigned_staff_id uuid references public.profiles(id),
  started_at timestamptz,
  target_end_at timestamptz,
  next_care_at timestamptz,
  completed_at timestamptz,
  risk_level text check (risk_level in ('low','medium','high')),
  injury_flag boolean not null default false,
  dropout_risk_flag boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

create unique index if not exists idx_care_profiles_member_center_active
  on public.member_care_profiles(member_id, center_id)
  where deleted_at is null and status not in ('completed','suspended');

-- ─────────────────────────────────────────────────
-- 2. member_care_steps
-- ─────────────────────────────────────────────────
create table if not exists public.member_care_steps (
  id uuid primary key default gen_random_uuid(),
  care_profile_id uuid not null references public.member_care_profiles(id) on delete cascade,
  step_code text not null,
  step_name text not null,
  step_status text not null default 'pending'
    check (step_status in ('pending','explained','performed','needs_more','completed')),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(care_profile_id, step_code)
);

-- ─────────────────────────────────────────────────
-- 3. member_care_logs
-- ─────────────────────────────────────────────────
create table if not exists public.member_care_logs (
  id uuid primary key default gen_random_uuid(),
  client_mutation_id text unique,
  care_profile_id uuid references public.member_care_profiles(id),
  member_id uuid not null references public.members(id),
  center_id uuid not null references public.centers(id),
  staff_id uuid references public.profiles(id),
  care_at timestamptz not null default now(),
  condition_note text,
  care_summary text not null,
  skill_taught text,
  problems_attempted text,
  success_note text,
  difficulty_note text,
  next_task text,
  next_care_at date,
  injury_flag boolean not null default false,
  dropout_risk_flag boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1
);

-- ─────────────────────────────────────────────────
-- 4. member_followups
-- ─────────────────────────────────────────────────
create table if not exists public.member_followups (
  id uuid primary key default gen_random_uuid(),
  client_mutation_id text unique,
  member_id uuid not null references public.members(id),
  center_id uuid not null references public.centers(id),
  followup_type text not null
    check (followup_type in ('renewal_consult','care_check','injury_followup','absence_check','general')),
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id),
  result text,
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

-- ─────────────────────────────────────────────────
-- 5. center_goals (target member counts per center)
-- ─────────────────────────────────────────────────
create table if not exists public.center_goals (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  goal_type text not null check (goal_type in ('adult_members','junior_members')),
  target_value integer not null check (target_value > 0),
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  unique(center_id, goal_type, effective_from)
);

insert into public.center_goals (center_id, goal_type, target_value) values
  ('11111111-1111-1111-1111-111111111001', 'adult_members',  100),
  ('11111111-1111-1111-1111-111111111001', 'junior_members',  60),
  ('11111111-1111-1111-1111-111111111002', 'adult_members',  180),
  ('11111111-1111-1111-1111-111111111002', 'junior_members',  90)
on conflict (center_id, goal_type, effective_from) do nothing;

-- ─────────────────────────────────────────────────
-- 6. Indexes
-- ─────────────────────────────────────────────────
create index if not exists idx_care_profiles_center    on public.member_care_profiles(center_id) where deleted_at is null;
create index if not exists idx_care_profiles_member    on public.member_care_profiles(member_id) where deleted_at is null;
create index if not exists idx_care_profiles_next_care on public.member_care_profiles(next_care_at) where deleted_at is null;
create index if not exists idx_care_logs_member        on public.member_care_logs(member_id) where deleted_at is null;
create index if not exists idx_care_logs_profile       on public.member_care_logs(care_profile_id) where deleted_at is null;
create index if not exists idx_care_logs_care_at       on public.member_care_logs(care_at desc) where deleted_at is null;
create index if not exists idx_followups_member        on public.member_followups(member_id);
create index if not exists idx_followups_center        on public.member_followups(center_id);
create index if not exists idx_followups_due           on public.member_followups(due_at) where completed_at is null;

-- ─────────────────────────────────────────────────
-- 7. updated_at + version trigger (care tables)
-- ─────────────────────────────────────────────────
create or replace function public.set_updated_at_versioned()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$$;

create or replace trigger trg_care_profiles_updated
  before update on public.member_care_profiles
  for each row execute function public.set_updated_at_versioned();

create or replace trigger trg_care_steps_updated
  before update on public.member_care_steps
  for each row execute function public.set_updated_at_versioned();

create or replace trigger trg_care_logs_updated
  before update on public.member_care_logs
  for each row execute function public.set_updated_at_versioned();

create or replace trigger trg_followups_updated
  before update on public.member_followups
  for each row execute function public.set_updated_at_versioned();

-- ─────────────────────────────────────────────────
-- 8. RLS
-- ─────────────────────────────────────────────────
alter table public.member_care_profiles enable row level security;
alter table public.member_care_steps     enable row level security;
alter table public.member_care_logs      enable row level security;
alter table public.member_followups      enable row level security;
alter table public.center_goals          enable row level security;

-- care_profiles
create policy "care_profiles_select" on public.member_care_profiles
  for select using (public.has_center_access(center_id, 'viewer'));
create policy "care_profiles_insert" on public.member_care_profiles
  for insert with check (public.has_center_access(center_id, 'staff'));
create policy "care_profiles_update" on public.member_care_profiles
  for update using (public.has_center_access(center_id, 'staff'));

-- care_steps (inherit via care_profiles)
create policy "care_steps_select" on public.member_care_steps
  for select using (
    exists (
      select 1 from public.member_care_profiles cp
      where cp.id = care_profile_id
        and public.has_center_access(cp.center_id, 'viewer')
    )
  );
create policy "care_steps_insert" on public.member_care_steps
  for insert with check (
    exists (
      select 1 from public.member_care_profiles cp
      where cp.id = care_profile_id
        and public.has_center_access(cp.center_id, 'staff')
    )
  );
create policy "care_steps_update" on public.member_care_steps
  for update using (
    exists (
      select 1 from public.member_care_profiles cp
      where cp.id = care_profile_id
        and public.has_center_access(cp.center_id, 'staff')
    )
  );

-- care_logs
create policy "care_logs_select" on public.member_care_logs
  for select using (public.has_center_access(center_id, 'viewer'));
create policy "care_logs_insert" on public.member_care_logs
  for insert with check (public.has_center_access(center_id, 'staff'));
create policy "care_logs_update" on public.member_care_logs
  for update using (public.has_center_access(center_id, 'staff'));

-- followups
create policy "followups_select" on public.member_followups
  for select using (public.has_center_access(center_id, 'viewer'));
create policy "followups_insert" on public.member_followups
  for insert with check (public.has_center_access(center_id, 'staff'));
create policy "followups_update" on public.member_followups
  for update using (public.has_center_access(center_id, 'staff'));

-- center_goals: anyone can read; only owner/admin can write
create policy "goals_select" on public.center_goals
  for select using (true);
create policy "goals_write" on public.center_goals
  for all using (public.has_center_access(center_id, 'admin'));

-- ─────────────────────────────────────────────────
-- 9. Realtime publication
-- ─────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'members'
  ) then
    alter publication supabase_realtime add table public.members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'memberships'
  ) then
    alter publication supabase_realtime add table public.memberships;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'attendance_logs'
  ) then
    alter publication supabase_realtime add table public.attendance_logs;
  end if;
end;
$$;

alter publication supabase_realtime add table public.member_care_profiles;
alter publication supabase_realtime add table public.member_care_logs;
alter publication supabase_realtime add table public.member_followups;

-- ─────────────────────────────────────────────────
-- 10. RPC: active member counts on a given date
-- ─────────────────────────────────────────────────
create or replace function public.rpc_active_member_counts(
  p_center_id uuid,
  p_date date default current_date
)
returns table (
  total_count bigint,
  adult_count bigint,
  junior_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  with active as (
    select distinct m.id, m.member_type
    from public.members m
    join public.memberships ms on ms.member_id = m.id
    where m.center_id = p_center_id
      and m.deleted_at is null
      and m.member_type in ('general', 'junior')
      and (
        (
          ms.pass_type = 'period'
          and ms.status not in ('expired','finished','cancelled')
          and ms.start_date <= p_date
          and (ms.end_date is null or ms.end_date >= p_date)
        )
        or (
          ms.pass_type = 'count'
          and ms.status = 'active'
          and coalesce(ms.remaining_count, 0) > 0
        )
      )
  )
  select
    count(*)                                              as total_count,
    count(*) filter (where member_type = 'general')      as adult_count,
    count(*) filter (where member_type = 'junior')       as junior_count
  from active;
$$;

-- ─────────────────────────────────────────────────
-- 11. RPC: weekly stats (new + expired members in a date range)
-- ─────────────────────────────────────────────────
create or replace function public.rpc_weekly_stats(
  p_center_id uuid,
  p_week_start date,
  p_week_end   date
)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_current   json;
  v_new       json;
  v_expired   json;
begin
  -- Current active counts at week_end
  select row_to_json(t) into v_current
  from (
    select * from public.rpc_active_member_counts(p_center_id, p_week_end)
  ) t;

  -- New members: first paid membership starts in [week_start, week_end]
  -- "paid" = membership_type not trial
  select json_build_object(
    'total',  count(distinct m.id),
    'adult',  count(distinct m.id) filter (where m.member_type = 'general'),
    'junior', count(distinct m.id) filter (where m.member_type = 'junior'),
    'members', json_agg(json_build_object('id', m.id, 'name', m.name, 'member_type', m.member_type) order by m.name)
  ) into v_new
  from public.members m
  join (
    select ms.member_id, min(ms.start_date) as first_start
    from public.memberships ms
    join public.members mx on mx.id = ms.member_id
    where mx.center_id = p_center_id
      and ms.membership_type <> 'trial'
      and ms.status <> 'cancelled'
    group by ms.member_id
  ) fp on fp.member_id = m.id
  where m.center_id = p_center_id
    and m.deleted_at is null
    and m.member_type in ('general','junior')
    and fp.first_start between p_week_start and p_week_end;

  -- Expired members: latest period membership ends in [week_start, week_end]
  --   AND no active membership exists at week_end
  select json_build_object(
    'total',  count(distinct m.id),
    'adult',  count(distinct m.id) filter (where m.member_type = 'general'),
    'junior', count(distinct m.id) filter (where m.member_type = 'junior'),
    'members', json_agg(json_build_object('id', m.id, 'name', m.name, 'member_type', m.member_type) order by m.name)
  ) into v_expired
  from public.members m
  join (
    select ms.member_id, max(ms.end_date) as last_end
    from public.memberships ms
    join public.members mx on mx.id = ms.member_id
    where mx.center_id = p_center_id
      and ms.membership_type <> 'trial'
      and ms.pass_type = 'period'
      and ms.status <> 'cancelled'
    group by ms.member_id
  ) lp on lp.member_id = m.id
  where m.center_id = p_center_id
    and m.deleted_at is null
    and m.member_type in ('general','junior')
    and lp.last_end between p_week_start and p_week_end
    -- must not have any active membership at week_end
    and not exists (
      select 1 from public.memberships ms2
      where ms2.member_id = m.id
        and ms2.status not in ('expired','finished','cancelled')
        and (
          (ms2.pass_type = 'period' and ms2.start_date <= p_week_end
            and (ms2.end_date is null or ms2.end_date >= p_week_end))
          or (ms2.pass_type = 'count' and coalesce(ms2.remaining_count,0) > 0 and ms2.status = 'active')
        )
    );

  return json_build_object(
    'current', v_current,
    'new',     v_new,
    'expired', v_expired
  );
end;
$$;

-- ─────────────────────────────────────────────────
-- 12. RPC: monthly trend (last N months active counts at month-end)
-- ─────────────────────────────────────────────────
create or replace function public.rpc_monthly_trend(
  p_center_id  uuid,
  p_months_back integer default 6
)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_result json;
begin
  select json_agg(row_to_json(t) order by t.month_label) into v_result
  from (
    select
      to_char(gs.month_end, 'YYYY-MM') as month_label,
      gs.month_end,
      (select adult_count  from public.rpc_active_member_counts(p_center_id, gs.month_end)) as adult_count,
      (select junior_count from public.rpc_active_member_counts(p_center_id, gs.month_end)) as junior_count
    from (
      select (date_trunc('month', current_date) - (n || ' month')::interval + interval '1 month' - interval '1 day')::date as month_end
      from generate_series(0, p_months_back - 1) n
    ) gs
  ) t;

  return v_result;
end;
$$;

-- ─────────────────────────────────────────────────
-- 13. RPC: care priority list
-- Returns top-priority care members for a center
-- ─────────────────────────────────────────────────
create or replace function public.rpc_care_priority(
  p_center_id uuid,
  p_limit     integer default 10
)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_today date := current_date;
  v_result json;
begin
  select json_agg(row_to_json(t) order by t.priority_order, t.member_name) into v_result
  from (
    -- 1. Injury flag
    select
      cp.id as care_profile_id,
      m.id as member_id,
      m.name as member_name,
      m.phone,
      m.member_type,
      cp.status as care_status,
      cp.care_reason,
      cp.assigned_staff_id,
      p.display_name as assigned_staff_name,
      cp.next_care_at,
      cp.injury_flag,
      cp.dropout_risk_flag,
      1 as priority_order,
      '통증 또는 부상' as reason_label,
      (
        select json_build_object(
          'id', cl.id, 'care_at', cl.care_at, 'care_summary', cl.care_summary,
          'next_task', cl.next_task, 'next_care_at', cl.next_care_at
        )
        from public.member_care_logs cl
        where cl.care_profile_id = cp.id and cl.deleted_at is null
        order by cl.care_at desc limit 1
      ) as last_log
    from public.member_care_profiles cp
    join public.members m on m.id = cp.member_id
    left join public.profiles p on p.id = cp.assigned_staff_id
    where cp.center_id = p_center_id
      and cp.deleted_at is null
      and cp.status not in ('completed','suspended')
      and cp.injury_flag = true

    union all

    -- 2. New member (first paid ms within 60 days) with no care log yet
    select
      cp.id, m.id, m.name, m.phone, m.member_type,
      cp.status, cp.care_reason, cp.assigned_staff_id,
      p.display_name,
      cp.next_care_at, cp.injury_flag, cp.dropout_risk_flag,
      2, '신규 등록 후 첫 케어 없음',
      null
    from public.member_care_profiles cp
    join public.members m on m.id = cp.member_id
    left join public.profiles p on p.id = cp.assigned_staff_id
    where cp.center_id = p_center_id
      and cp.deleted_at is null
      and cp.status not in ('completed','suspended')
      and cp.injury_flag = false
      and not exists (
        select 1 from public.member_care_logs cl
        where cl.care_profile_id = cp.id and cl.deleted_at is null
      )

    union all

    -- 3. Next care date overdue
    select
      cp.id, m.id, m.name, m.phone, m.member_type,
      cp.status, cp.care_reason, cp.assigned_staff_id,
      p.display_name,
      cp.next_care_at, cp.injury_flag, cp.dropout_risk_flag,
      3, '케어 예정일 경과',
      (
        select json_build_object(
          'id', cl.id, 'care_at', cl.care_at, 'care_summary', cl.care_summary,
          'next_task', cl.next_task, 'next_care_at', cl.next_care_at
        )
        from public.member_care_logs cl
        where cl.care_profile_id = cp.id and cl.deleted_at is null
        order by cl.care_at desc limit 1
      )
    from public.member_care_profiles cp
    join public.members m on m.id = cp.member_id
    left join public.profiles p on p.id = cp.assigned_staff_id
    where cp.center_id = p_center_id
      and cp.deleted_at is null
      and cp.status not in ('completed','suspended')
      and cp.injury_flag = false
      and cp.next_care_at::date < v_today
      and exists (
        select 1 from public.member_care_logs cl
        where cl.care_profile_id = cp.id and cl.deleted_at is null
      )

    union all

    -- 4. Active care - general
    select
      cp.id, m.id, m.name, m.phone, m.member_type,
      cp.status, cp.care_reason, cp.assigned_staff_id,
      p.display_name,
      cp.next_care_at, cp.injury_flag, cp.dropout_risk_flag,
      6, '집중케어 진행 중',
      (
        select json_build_object(
          'id', cl.id, 'care_at', cl.care_at, 'care_summary', cl.care_summary,
          'next_task', cl.next_task, 'next_care_at', cl.next_care_at
        )
        from public.member_care_logs cl
        where cl.care_profile_id = cp.id and cl.deleted_at is null
        order by cl.care_at desc limit 1
      )
    from public.member_care_profiles cp
    join public.members m on m.id = cp.member_id
    left join public.profiles p on p.id = cp.assigned_staff_id
    where cp.center_id = p_center_id
      and cp.deleted_at is null
      and cp.status = 'active'
      and cp.injury_flag = false
      and (cp.next_care_at is null or cp.next_care_at::date >= v_today)
  ) t
  limit p_limit;

  return coalesce(v_result, '[]'::json);
end;
$$;

-- ─────────────────────────────────────────────────
-- 14. RPC: auto-register care profiles for qualifying members
-- Called by the app on startup and after member/membership changes
-- ─────────────────────────────────────────────────
create or replace function public.rpc_auto_register_care(p_center_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := current_date;
  v_count integer := 0;
  v_member record;
begin
  -- New members (first paid ms within 60 days) not yet in care
  for v_member in
    select distinct m.id as member_id, m.member_type
    from public.members m
    join public.memberships ms on ms.member_id = m.id
    where m.center_id = p_center_id
      and m.deleted_at is null
      and m.member_type in ('general','junior')
      and ms.membership_type <> 'trial'
      and ms.status <> 'cancelled'
      and ms.start_date between (v_today - interval '60 days')::date and v_today
      and not exists (
        select 1 from public.member_care_profiles cp
        where cp.member_id = m.id
          and cp.center_id = p_center_id
          and cp.deleted_at is null
          and cp.status not in ('completed','suspended')
      )
  loop
    insert into public.member_care_profiles
      (member_id, center_id, status, priority, care_reason, started_at)
    values
      (v_member.member_id, p_center_id, 'pending', 3,
       array['신규등록_60일이내'], now())
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
