-- =============================================================================
-- TradePilot AI — Phase 2.1: bind data access to a live auth session
--
-- Problem: access tokens are stateless JWTs. After sign-out (or "sign out
-- other devices", or an administrator revoking a session) GoTrue deletes the
-- session and its refresh tokens, but an access token issued earlier stays
-- valid for PostgREST/Realtime until it expires. A token copied by malicious
-- script could keep reading data after the user signed out.
--
-- Fix: every user-facing policy and owner check additionally requires that
-- the token's `session_id` still exists in auth.sessions, belongs to the
-- caller and has not passed its `not_after`. Revoking a session therefore
-- revokes database and Realtime access immediately.
--
-- Rollback: supabase/rollbacks/20261024090000_session_bound_access.down.sql
-- =============================================================================

create function public.has_active_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions s
    where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
      and (s.not_after is null or s.not_after > now())
  );
$$;

comment on function public.has_active_session() is
  'True when the caller''s JWT belongs to a session that has not been signed out, revoked or expired.';

revoke all on function public.has_active_session() from public, anon;
grant execute on function public.has_active_session() to authenticated, service_role;

-- Owner status also requires a live session.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.has_active_session())
     and exists (select 1 from private.app_owner where user_id = (select auth.uid()));
$$;

-- A revoked session gets an explicit error (SQLSTATE 28000) rather than a
-- misleading "you are not the owner" answer.
create or replace function public.get_my_access()
returns table (is_owner boolean, owner_configured boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_active_session() then
    raise exception 'session is no longer active' using errcode = '28000';
  end if;
  return query
    select
      exists (select 1 from private.app_owner where user_id = (select auth.uid())),
      exists (select 1 from private.app_owner);
end;
$$;

-- Re-state every policy with the session requirement.
alter policy "Users read their own profile" on public.profiles
  using (id = (select auth.uid()) and (select public.has_active_session()));

alter policy "Users create their own missing profile" on public.profiles
  with check (id = (select auth.uid()) and (select public.has_active_session()));

alter policy "Users update their own profile" on public.profiles
  using (id = (select auth.uid()) and (select public.has_active_session()))
  with check (id = (select auth.uid()) and (select public.has_active_session()));

alter policy "Users read their own settings" on public.user_settings
  using (user_id = (select auth.uid()) and (select public.has_active_session()));

alter policy "Users create their own missing settings" on public.user_settings
  with check (user_id = (select auth.uid()) and (select public.has_active_session()));

alter policy "Users update their own settings" on public.user_settings
  using (user_id = (select auth.uid()) and (select public.has_active_session()))
  with check (user_id = (select auth.uid()) and (select public.has_active_session()));

alter policy "Users read their own audit events; owner reads all" on public.audit_events
  using ((select public.has_active_session())
         and (actor_user_id = (select auth.uid()) or (select public.is_owner())));
