-- Add member_no (회원번호) column to members table.
-- Nullable, additive only — used for self-checkin lookup and display.

alter table public.members
  add column if not exists member_no integer;

create index if not exists idx_members_member_no
  on public.members (center_id, member_no);
