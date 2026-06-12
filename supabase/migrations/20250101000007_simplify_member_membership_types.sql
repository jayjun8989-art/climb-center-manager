-- Simplify Supabase member / membership type values for sync
-- members.member_type: regular | junior
-- memberships.membership_type: monthly | session | junior

update public.members
set member_type = 'regular'
where member_type = 'general';

update public.memberships
set membership_type = 'monthly'
where membership_type in ('30days', '90days', '180days');

update public.memberships
set membership_type = 'session'
where membership_type = '5times';

update public.memberships
set membership_type = 'junior'
where membership_type in ('8times', '16times', 'junior');

alter table public.members drop constraint if exists members_member_type_check;
alter table public.members
  add constraint members_member_type_check
  check (member_type in ('regular', 'junior', 'trial'));

alter table public.memberships drop constraint if exists memberships_membership_type_check;
alter table public.memberships
  add constraint memberships_membership_type_check
  check (membership_type in ('monthly', 'session', 'junior', 'trial'));

notify pgrst, 'reload schema';
