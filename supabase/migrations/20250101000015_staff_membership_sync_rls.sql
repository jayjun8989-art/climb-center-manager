-- Allow center staff to insert/update memberships during member registration sync.
-- Previously required 'admin', which blocked oncle/grabit staff after local save.

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_center_access(center_id, 'staff'));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_center_access(center_id, 'staff'))
  with check (public.has_center_access(center_id, 'staff'));

notify pgrst, 'reload schema';
