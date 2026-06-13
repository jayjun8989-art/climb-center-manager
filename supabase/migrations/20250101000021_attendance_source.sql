-- Additive: track attendance source (staff vs self-checkin) for synced attendance logs
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

alter table public.attendance_logs
  add column if not exists source text not null default 'staff';
