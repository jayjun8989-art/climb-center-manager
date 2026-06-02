-- Climb Center Manager — Supabase init schema
-- Mirrors local SQLite v2 + auth/centers + sync metadata

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Centers (ONCLE / GRABIT)
-- ---------------------------------------------------------------------------
create table if not exists public.centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('ONCLE', 'GRABIT')),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.centers (id, code, name)
values
  ('11111111-1111-1111-1111-111111111001', 'ONCLE', 'ONCLE'),
  ('11111111-1111-1111-1111-111111111002', 'GRABIT', 'GRABIT')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles + center roles (Supabase Auth)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_center_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  center_id uuid not null references public.centers(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff', 'viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, center_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email, 'user'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Business tables (aligned with SQLite v2)
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  name text not null,
  phone text,
  phone_normalized text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  member_type text not null default 'general' check (member_type in ('general', 'junior', 'trial')),
  parent_name text,
  parent_phone text,
  memo text,
  status text not null default 'active' check (status in ('active', 'paused', 'expired', 'inactive')),
  version integer not null default 1,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists idx_members_center_phone
  on public.members (center_id, phone_normalized)
  where phone_normalized is not null and deleted_at is null;

create index if not exists idx_members_center_name on public.members (center_id, name);
create index if not exists idx_members_center_status on public.members (center_id, status) where deleted_at is null;

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  center_id uuid not null references public.centers(id),
  membership_type text not null check (
    membership_type in ('30days', '90days', '180days', '5times', '8times', '16times', 'junior', 'trial')
  ),
  pass_type text not null check (pass_type in ('period', 'count')),
  start_date date not null,
  end_date date,
  total_count integer,
  used_count integer not null default 0,
  remaining_count integer,
  status text not null default 'active' check (status in ('active', 'paused', 'expired', 'finished')),
  price numeric(12, 0),
  version integer not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memberships_member on public.memberships (member_id, status);
create index if not exists idx_memberships_center on public.memberships (center_id, status);

create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  membership_id uuid not null references public.memberships(id),
  center_id uuid not null references public.centers(id),
  checkin_at timestamptz not null default now(),
  attendance_type text not null default 'normal' check (attendance_type in ('normal', 'junior', 'trial')),
  deducted_count integer not null default 0,
  memo text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_member on public.attendance_logs (member_id, checkin_at desc);
create index if not exists idx_attendance_center on public.attendance_logs (center_id, checkin_at desc);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  membership_id uuid references public.memberships(id),
  center_id uuid not null references public.centers(id),
  amount numeric(12, 0) not null,
  payment_method text not null default 'cash' check (payment_method in ('card', 'cash', 'transfer', 'etc')),
  payment_date date not null,
  memo text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_member on public.payments (member_id, payment_date desc);

create table if not exists public.pause_logs (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id),
  membership_id uuid not null references public.memberships(id),
  center_id uuid not null references public.centers(id),
  pause_start_date date not null,
  pause_end_date date,
  remaining_days_at_pause integer,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pause_open on public.pause_logs (membership_id) where pause_end_date is null;

create table if not exists public.trial_members (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id),
  name text not null,
  phone text,
  trial_date date not null,
  trial_price numeric(12, 0) not null default 0,
  converted boolean not null default false,
  converted_member_id uuid references public.members(id),
  memo text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Auth helpers
-- ---------------------------------------------------------------------------
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
as $$
  select case p_role
    when 'owner' then 4
    when 'manager' then 3
    when 'staff' then 2
    when 'viewer' then 1
    else 0
  end;
$$;

create or replace function public.has_center_access(p_center_id uuid, p_min_role text default 'viewer')
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_center_roles ucr
    where ucr.user_id = auth.uid()
      and ucr.center_id = p_center_id
      and public.role_rank(ucr.role) >= public.role_rank(p_min_role)
  );
$$;

create or replace function public.center_id_by_code(p_code text)
returns uuid
language sql
stable
as $$
  select id from public.centers where code = p_code limit 1;
$$;

-- ---------------------------------------------------------------------------
-- RPC: record attendance
-- ---------------------------------------------------------------------------
create or replace function public.rpc_record_attendance(p_member_id uuid)
returns public.members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members%rowtype;
  v_membership public.memberships%rowtype;
  v_type text;
begin
  select * into v_member from public.members where id = p_member_id and deleted_at is null;
  if not found then
    raise exception '??? ?? ? ????.';
  end if;

  if not public.has_center_access(v_member.center_id, 'staff') then
    raise exception '??? ????.';
  end if;

  select * into v_membership
  from public.memberships
  where member_id = p_member_id and status in ('active', 'paused')
  order by case status when 'active' then 0 else 1 end, created_at desc
  limit 1;

  if not found then
    raise exception '?? ??? ???? ????.';
  end if;

  if v_membership.status = 'paused' or v_member.status = 'paused' then
    raise exception '?? ?? ??????.';
  end if;

  v_type := case v_member.member_type
    when 'junior' then 'junior'
    when 'trial' then 'trial'
    else 'normal'
  end;

  if v_membership.pass_type = 'count' then
    if coalesce(v_membership.remaining_count, 0) <= 0 then
      raise exception '?? ?? ??? ????.';
    end if;
    update public.memberships
    set used_count = used_count + 1,
        remaining_count = remaining_count - 1,
        status = case when remaining_count - 1 <= 0 then 'finished' else 'active' end,
        updated_at = now(),
        version = version + 1
    where id = v_membership.id;
  end if;

  insert into public.attendance_logs (
    member_id, membership_id, center_id, checkin_at, attendance_type, deducted_count, created_by
  ) values (
    p_member_id,
    v_membership.id,
    v_member.center_id,
    now(),
    v_type,
    case when v_membership.pass_type = 'count' then 1 else 0 end,
    auth.uid()
  );

  update public.members set updated_at = now(), version = version + 1 where id = p_member_id;
  select * into v_member from public.members where id = p_member_id;
  return v_member;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.centers enable row level security;
alter table public.profiles enable row level security;
alter table public.user_center_roles enable row level security;
alter table public.members enable row level security;
alter table public.memberships enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.payments enable row level security;
alter table public.pause_logs enable row level security;
alter table public.trial_members enable row level security;

create policy centers_read on public.centers for select to authenticated using (true);

create policy profiles_read_self on public.profiles for select to authenticated
  using (id = auth.uid() or exists (select 1 from public.user_center_roles where user_id = auth.uid() and role = 'owner'));

create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid());

create policy ucr_read on public.user_center_roles for select to authenticated
  using (user_id = auth.uid() or public.has_center_access(center_id, 'manager'));

create policy members_select on public.members for select to authenticated
  using (public.has_center_access(center_id, 'viewer') and deleted_at is null);

create policy members_insert on public.members for insert to authenticated
  with check (public.has_center_access(center_id, 'staff'));

create policy members_update on public.members for update to authenticated
  using (public.has_center_access(center_id, 'staff'));

create policy memberships_all on public.memberships for all to authenticated
  using (public.has_center_access(center_id, 'viewer'))
  with check (public.has_center_access(center_id, 'staff'));

create policy attendance_select on public.attendance_logs for select to authenticated
  using (public.has_center_access(center_id, 'viewer'));

create policy attendance_insert on public.attendance_logs for insert to authenticated
  with check (public.has_center_access(center_id, 'staff'));

create policy payments_all on public.payments for all to authenticated
  using (public.has_center_access(center_id, 'viewer'))
  with check (public.has_center_access(center_id, 'staff'));

create policy pause_all on public.pause_logs for all to authenticated
  using (public.has_center_access(center_id, 'viewer'))
  with check (public.has_center_access(center_id, 'staff'));

create policy trial_all on public.trial_members for all to authenticated
  using (public.has_center_access(center_id, 'viewer'))
  with check (public.has_center_access(center_id, 'staff'));

-- ---------------------------------------------------------------------------
-- Updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_members_updated on public.members;
create trigger trg_members_updated before update on public.members
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_memberships_updated on public.memberships;
create trigger trg_memberships_updated before update on public.memberships
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_pause_updated on public.pause_logs;
create trigger trg_pause_updated before update on public.pause_logs
  for each row execute procedure public.set_updated_at();
