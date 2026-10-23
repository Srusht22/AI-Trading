-- Reverses 20261024090000_session_bound_access.sql (restores Phase 2 policies).
-- Run manually as the postgres role.

alter policy "Users read their own profile" on public.profiles using (id = (select auth.uid()));
alter policy "Users create their own missing profile" on public.profiles with check (id = (select auth.uid()));
alter policy "Users update their own profile" on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "Users read their own settings" on public.user_settings using (user_id = (select auth.uid()));
alter policy "Users create their own missing settings" on public.user_settings with check (user_id = (select auth.uid()));
alter policy "Users update their own settings" on public.user_settings
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "Users read their own audit events; owner reads all" on public.audit_events
  using (actor_user_id = (select auth.uid()) or (select public.is_owner()));

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_owner where user_id = (select auth.uid()));
$$;

drop function public.get_my_access();
create function public.get_my_access()
returns table (is_owner boolean, owner_configured boolean)
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_owner where user_id = (select auth.uid())),
         exists (select 1 from private.app_owner);
$$;
revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated, service_role;

drop function public.has_active_session();
