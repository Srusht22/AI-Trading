-- =============================================================================
-- TradePilot AI — Phase 2 foundation
--
-- Creates the personal-account data model:
--   private.app_owner      single trusted owner (not exposed through the API)
--   public.profiles        non-sensitive profile data, one row per auth user
--   public.user_settings   validated display preferences, one row per auth user
--   public.audit_events    append-only record of security-relevant actions
--
-- Security model
--   * Row-Level Security is enabled on every exposed table.
--   * Browser clients (roles anon / authenticated) receive only the minimum
--     table and column privileges; RLS then restricts rows to their owner.
--   * Audit events are written exclusively by SECURITY DEFINER triggers, so a
--     browser can neither forge nor edit them. Updates/deletes are blocked by
--     trigger for every role, including service_role.
--   * Owner assignment is possible only through public.admin_assign_owner(),
--     which is executable solely by service_role (trusted server-side tooling).
--
-- All timestamps are timestamptz (stored in UTC); conversion to the user's
-- display timezone happens in the client.
-- Rollback: supabase/rollbacks/20261023120000_foundation.down.sql
-- =============================================================================

-- Internal schema: never exposed through PostgREST.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- -----------------------------------------------------------------------------
-- Validation helpers
-- -----------------------------------------------------------------------------

create function private.is_valid_timezone(tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select tz is not null and exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

-- Notification preferences must be an object with exactly these boolean keys.
create function private.is_valid_notification_preferences(prefs jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(prefs) = 'object'
     and (select array_agg(k order by k) from jsonb_object_keys(prefs) as k)
         = array['approvals', 'backtests', 'connection', 'research']
     and (select bool_and(jsonb_typeof(v) = 'boolean') from jsonb_each(prefs) as e(k, v));
$$;

-- Audit metadata: a small flat object whose keys never look like secrets and
-- whose values are scalars or short arrays of scalars.
create function private.is_safe_audit_metadata(meta jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(meta) = 'object'
     and pg_catalog.octet_length(meta::text) <= 2048
     and not exists (
       select 1
       from jsonb_each(meta) as e(k, v)
       where k !~ '^[a-z][a-z0-9_]{0,39}$'
          or k ~* '(pass|secret|token|key|credential|authorization|cookie|session_id|jwt)'
          or jsonb_typeof(v) = 'object'
          or (jsonb_typeof(v) = 'array'
              and (jsonb_array_length(v) > 20
                   or exists (select 1 from jsonb_array_elements(v) as a(x)
                              where jsonb_typeof(x) in ('object', 'array'))))
     );
$$;

-- -----------------------------------------------------------------------------
-- Owner model
-- -----------------------------------------------------------------------------

-- Exactly zero or one row. Lives in the private schema so the browser API
-- cannot read or write it; access goes through the functions below.
create table private.app_owner (
  singleton   boolean primary key default true check (singleton),
  user_id     uuid not null unique references auth.users (id) on delete restrict,
  assigned_at timestamptz not null default now()
);

comment on table private.app_owner is
  'The single trusted owner of this TradePilot deployment. Assigned only via public.admin_assign_owner() by service_role.';

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.app_owner where user_id = (select auth.uid()));
$$;

comment on function public.is_owner() is 'True when the calling user is the deployment owner.';

-- -----------------------------------------------------------------------------
-- Profiles
-- -----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (
    display_name is null
    or (char_length(display_name) between 1 and 80
        and display_name = btrim(display_name)
        and display_name !~ '[[:cntrl:]]')
  ),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'Non-sensitive profile data. Credentials stay in auth.users.';

-- -----------------------------------------------------------------------------
-- User settings
-- -----------------------------------------------------------------------------

create table public.user_settings (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  theme                    text not null default 'dark' check (theme in ('dark', 'light')),
  -- How money is *displayed*. Never the base currency of a trading account.
  display_currency         text not null default 'USD'
                           check (display_currency in ('USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD')),
  -- IANA zone used only to render timestamps. Stored data is always UTC.
  timezone                 text not null default 'UTC',
  date_format              text not null default 'medium' check (date_format in ('medium', 'iso', 'dmy', 'mdy')),
  number_format            text not null default 'en-US' check (number_format in ('en-US', 'en-GB', 'de-DE', 'fr-FR')),
  show_beginner_help       boolean not null default true,
  notification_preferences jsonb not null
                           default '{"backtests": true, "connection": true, "approvals": true, "research": false}'::jsonb
                           check (private.is_valid_notification_preferences(notification_preferences)),
  -- Incremented on every update; clients send the revision they edited so
  -- concurrent edits are detected instead of silently overwritten.
  revision                 integer not null default 1 check (revision > 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column public.user_settings.display_currency is
  'Display preference only. Trading-account base currency will be stored with the account in a later phase.';
comment on column public.user_settings.revision is
  'Optimistic-concurrency token, incremented by trigger on every update.';

-- -----------------------------------------------------------------------------
-- Audit events
-- -----------------------------------------------------------------------------

create table public.audit_events (
  id            uuid primary key default gen_random_uuid(),
  -- Null when performed by a trusted server process, or after the actor's
  -- account was deleted (the event itself is kept).
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type    text not null check (event_type ~ '^[a-z]+(\.[a-z_]+)+$' and char_length(event_type) <= 64),
  resource_type text not null check (resource_type ~ '^[a-z_]+$' and char_length(resource_type) <= 40),
  resource_id   text check (resource_id is null or char_length(resource_id) <= 128),
  metadata      jsonb not null default '{}'::jsonb check (private.is_safe_audit_metadata(metadata)),
  -- clock_timestamp(), not now(): several events written in one transaction
  -- keep their real order instead of sharing the transaction start time.
  created_at    timestamptz not null default clock_timestamp()
);

-- Keyset pagination is on (created_at, id) so ties can never skip rows.
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc, id desc);
create index audit_events_created_idx on public.audit_events (created_at desc, id desc);

comment on table public.audit_events is
  'Append-only security log. Written only by server-side triggers/functions; never by browser clients.';

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- SECURITY DEFINER so they can use private helpers that API roles cannot see.
-- -----------------------------------------------------------------------------

create function private.touch_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := old.id;                 -- ownership is immutable
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch
before update on public.profiles
for each row execute function private.touch_profile();

create function private.guard_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_valid_timezone(new.timezone) then
    raise exception 'invalid timezone: %', new.timezone using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;      -- ownership is immutable
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger user_settings_guard
before insert or update on public.user_settings
for each row execute function private.guard_settings();

-- Audit rows are immutable. The only permitted change is the foreign key
-- nulling the actor when that user account is deleted.
create function private.protect_audit_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.actor_user_id is not null and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id') then
    return new;
  end if;
  raise exception 'audit events are append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_protect
before update or delete on public.audit_events
for each row execute function private.protect_audit_events();

-- -----------------------------------------------------------------------------
-- Audit writers (server-side only)
-- -----------------------------------------------------------------------------

create function private.write_audit(
  p_actor uuid,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id, metadata)
  values (p_actor, p_event_type, p_resource_type, p_resource_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Names of columns whose values differ between two rows (values are not logged).
create function private.changed_columns(old_row jsonb, new_row jsonb, ignored text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
  from jsonb_object_keys(new_row) as k
  where not (k = any (ignored)) and new_row -> k is distinct from old_row -> k;
$$;

-- New auth user → profile + default settings + audit record.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- Sanitise the optional display name supplied at sign-up so a bad value can
  -- never block account creation.
  v_name := nullif(left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'display_name', ''), '[[:cntrl:]]', '', 'g')), 80), '');
  v_name := nullif(btrim(v_name), '');

  insert into public.profiles (id, display_name) values (new.id, v_name)
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  perform private.write_audit(new.id, 'account.created', 'account', new.id::text, '{}'::jsonb);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create function private.handle_user_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform private.write_audit(new.id, 'account.email_confirmed', 'account', new.id::text, '{}'::jsonb);
  end if;
  if old.encrypted_password is distinct from new.encrypted_password and old.encrypted_password is not null then
    perform private.write_audit(new.id, 'auth.password_changed', 'account', new.id::text, '{}'::jsonb);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_updated
after update of email_confirmed_at, encrypted_password on auth.users
for each row execute function private.handle_user_update();

-- Sign-in creates an auth session; sign-out (or expiry clean-up) deletes it.
create function private.handle_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.user_id, 'auth.session_started', 'session', null, '{}'::jsonb);
    return new;
  end if;
  -- Skip when the session disappears because the whole account is being deleted.
  if exists (select 1 from auth.users where id = old.user_id) then
    perform private.write_audit(old.user_id, 'auth.session_ended', 'session', null, '{}'::jsonb);
  end if;
  return old;
end;
$$;

create trigger on_auth_session_created
after insert on auth.sessions
for each row execute function private.handle_session_change();

create trigger on_auth_session_deleted
after delete on auth.sessions
for each row execute function private.handle_session_change();

create function private.audit_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb := private.changed_columns(to_jsonb(old), to_jsonb(new), array['updated_at']);
begin
  if jsonb_array_length(v_fields) > 0 then
    perform private.write_audit((select auth.uid()), 'profile.updated', 'profile', new.id::text,
                                jsonb_build_object('fields', v_fields));
  end if;
  return new;
end;
$$;

create trigger profiles_audit
after update on public.profiles
for each row execute function private.audit_profile_update();

create function private.audit_settings_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb := private.changed_columns(to_jsonb(old), to_jsonb(new), array['updated_at', 'revision']);
begin
  if jsonb_array_length(v_fields) > 0 then
    perform private.write_audit((select auth.uid()), 'settings.updated', 'user_settings', new.user_id::text,
                                jsonb_build_object('fields', v_fields));
  end if;
  return new;
end;
$$;

create trigger user_settings_audit
after update on public.user_settings
for each row execute function private.audit_settings_update();

-- -----------------------------------------------------------------------------
-- Owner functions
-- -----------------------------------------------------------------------------

-- What the signed-in user may do. Safe to expose: reveals only the caller's
-- own status and whether an owner has been configured at all.
create function public.get_my_access()
returns table (is_owner boolean, owner_configured boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from private.app_owner where user_id = (select auth.uid())),
    exists (select 1 from private.app_owner);
$$;

-- Trusted bootstrap: assign (or, with p_replace, reassign) the owner by email.
-- Executable only by service_role — never by anon or authenticated clients.
create function public.admin_assign_owner(p_email text, p_replace boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_previous uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'no account exists for that email' using errcode = 'P0002';
  end if;

  select user_id into v_previous from private.app_owner;
  if v_previous is not null and v_previous <> v_user and not p_replace then
    raise exception 'an owner is already assigned; pass p_replace => true to reassign' using errcode = '23505';
  end if;

  insert into private.app_owner (singleton, user_id) values (true, v_user)
  on conflict (singleton) do update set user_id = excluded.user_id, assigned_at = now();

  perform private.write_audit(null, 'owner.assigned', 'account', v_user::text,
                              jsonb_build_object('replaced', v_previous is not null and v_previous <> v_user));
  return v_user;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges (defence in depth; RLS below restricts rows)
-- -----------------------------------------------------------------------------

revoke all on table public.profiles, public.user_settings, public.audit_events from anon, authenticated;

grant select on table public.profiles to authenticated;
grant insert (id, display_name) on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

grant select on table public.user_settings to authenticated;
grant insert (user_id, theme, display_currency, timezone, date_format, number_format, show_beginner_help, notification_preferences)
  on table public.user_settings to authenticated;
grant update (theme, display_currency, timezone, date_format, number_format, show_beginner_help, notification_preferences)
  on table public.user_settings to authenticated;

grant select on table public.audit_events to authenticated;

-- Internal functions: trigger invocation does not require EXECUTE, so nobody
-- else needs it. (The private schema is already unusable by API roles.)
revoke all on all functions in schema private from public;
grant execute on function private.is_valid_timezone(text),
                          private.is_valid_notification_preferences(jsonb),
                          private.is_safe_audit_metadata(jsonb)
  to public;  -- pure validators referenced by CHECK constraints

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated, service_role;

revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated, service_role;

revoke all on function public.admin_assign_owner(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_assign_owner(text, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table private.app_owner enable row level security;   -- no policies: unreadable except via definer functions
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.audit_events enable row level security;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Users create their own missing profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "Users update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Users read their own settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users create their own missing settings"
  on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Users update their own settings"
  on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Users see their own events; the owner can review all events.
create policy "Users read their own audit events; owner reads all"
  on public.audit_events for select to authenticated
  using (actor_user_id = (select auth.uid()) or (select public.is_owner()));

-- No insert/update/delete policies on audit_events: browser writes are impossible.

-- -----------------------------------------------------------------------------
-- Realtime: only the two tables the UI subscribes to. Delivery still honours
-- the SELECT policies above, so users receive only their own rows.
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.user_settings, public.audit_events;
