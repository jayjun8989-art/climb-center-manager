-- Climb Center Manager � ??? ?? ??? ???
-- Supabase Dashboard SQL Editor?? ?????.
--
-- ??: ??/???/??/??/??/??/??/sync ?? ?? ???
-- ??: centers, profiles, user_center_roles, auth.users, auth.identities, schema

begin;

do $$
declare
  tbl text;
  tables text[] := array[
    'public.attendance_logs',
    'public.lockers',
    'public.pause_logs',
    'public.payments',
    'public.memberships',
    'public.members',
    'public.trial_members',
    'public.sync_queue',
    'public.sync_state',
    'public.id_map'
  ];
begin
  foreach tbl in array tables loop
    if to_regclass(tbl) is not null then
      execute format('truncate table %s restart identity cascade', tbl);
      raise notice 'truncated %', tbl;
    else
      raise notice 'skipped (missing): %', tbl;
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
