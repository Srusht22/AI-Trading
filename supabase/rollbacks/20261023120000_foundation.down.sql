-- Reverses 20261023120000_foundation.sql.
-- WARNING: permanently deletes profiles, settings and the audit log.
-- Run manually (psql or the SQL editor) as the postgres role; not applied automatically.

alter publication supabase_realtime drop table public.user_settings, public.audit_events;

drop trigger if exists on_auth_session_created on auth.sessions;
drop trigger if exists on_auth_session_deleted on auth.sessions;
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

drop function if exists public.admin_assign_owner(text, boolean);
drop function if exists public.get_my_access();

drop table if exists public.audit_events;
drop table if exists public.user_settings;
drop table if exists public.profiles;

drop function if exists public.is_owner();
drop schema if exists private cascade;  -- app_owner table and internal functions
