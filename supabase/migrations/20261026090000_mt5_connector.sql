-- =============================================================================
-- TradePilot AI — Phase 4: read-only MetaTrader 5 connector
--
-- Extends the Phase 3 queue and agent model; nothing is replaced.
--
--   * Agents now belong to a workspace owner (agents.owner_user_id).
--   * Pairing: the owner creates a one-time, 10-minute pairing code in the
--     website; the connector generates its own agent token locally and sends
--     only its SHA-256 together with the code. The token never reaches the
--     browser, the database or a log. CLI registration (Phase 3) still works.
--   * Capability `mt5.read` authorises ONLY: reporting the terminal/account
--     verification, publishing read-only account/market data for the agent's
--     own connection, and claiming the read-only mt5.* task types below.
--     There is no trading capability and no trading task type.
--   * Demo-only: a connection is `verified` only when the connector reports
--     ACCOUNT_TRADE_MODE_DEMO (code 0) for the account it was bound to.
--     Real, contest, unknown or a different account => `blocked`, and every
--     publish is refused unless the connection is verified AND the publish
--     carries the bound account fingerprint (HMAC computed on the Windows PC;
--     the login number itself never leaves the computer).
--   * All data tables: read-only for the owning user under RLS; no INSERT/
--     UPDATE/DELETE privilege for authenticated or service_role; writes only
--     through the SECURITY DEFINER functions here.
--
-- Rollback: supabase/rollbacks/20261026090000_mt5_connector.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Agents belong to a workspace owner
-- -----------------------------------------------------------------------------

alter table public.agents add column owner_user_id uuid references auth.users (id) on delete cascade;
update public.agents set owner_user_id = (select user_id from private.app_owner) where owner_user_id is null;
create index agents_owner_idx on public.agents (owner_user_id);

-- CLI registration (Phase 3) now records the current owner as the agent's owner.
create or replace function public.admin_register_agent(
  p_display_name text,
  p_capabilities text[],
  p_token_sha256 bytea,
  p_max_concurrent_tasks int default 1
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_owner uuid := (select user_id from private.app_owner);
begin
  if exists (select 1 from unnest(p_capabilities) c where c !~ '^[a-z][a-z0-9_.]{0,59}$') then
    raise exception 'capabilities are not valid' using errcode = 'TPV01';
  end if;
  if v_owner is null then
    raise exception 'assign the workspace owner before registering agents' using errcode = 'TPV01';
  end if;
  insert into public.agents (display_name, allowed_capabilities, max_concurrent_tasks, owner_user_id)
  values (btrim(p_display_name), p_capabilities, p_max_concurrent_tasks, v_owner)
  returning id into v_id;
  insert into private.agent_credentials (agent_id, token_sha256) values (v_id, p_token_sha256);
  perform private.write_audit(null, 'agent.registered', 'agent', v_id::text,
                              jsonb_build_object('capabilities', to_jsonb(p_capabilities)));
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- One-time pairing codes (owner-issued; the only way a connector can enrol
-- without the service-role key)
-- -----------------------------------------------------------------------------

create table private.agent_pairings (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  code_sha256    bytea not null unique check (octet_length(code_sha256) = 32),
  display_name   text not null check (char_length(display_name) between 1 and 60 and display_name !~ '[[:cntrl:]]'),
  capabilities   text[] not null,
  created_at     timestamptz not null default clock_timestamp(),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  agent_id       uuid references public.agents (id) on delete set null
);
alter table private.agent_pairings enable row level security;
revoke all on table private.agent_pairings from public, anon, authenticated, service_role;

-- Returns the code ONCE. Only its SHA-256 is stored. 80 random bits, 10 minutes, single use.
create function public.create_agent_pairing(p_display_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_owner_session();
  v_code text := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_expires timestamptz := clock_timestamp() + interval '10 minutes';
begin
  if char_length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then
    raise exception 'give the connector a name of 1-60 characters' using errcode = 'TPV01';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tp.pairing:' || v_user::text, 0));
  if (select count(*) from private.agent_pairings
      where owner_user_id = v_user and used_at is null and expires_at > clock_timestamp()) >= 3 then
    raise exception 'too many unused pairing codes; wait for them to expire' using errcode = 'TPR01';
  end if;
  if (select count(*) from private.agent_pairings
      where owner_user_id = v_user and created_at > clock_timestamp() - interval '1 hour') >= 10 then
    raise exception 'too many pairing codes created in the last hour' using errcode = 'TPR01';
  end if;
  insert into private.agent_pairings (owner_user_id, code_sha256, display_name, capabilities, expires_at)
  values (v_user, extensions.digest(v_code, 'sha256'), v_name, array['mt5.read'], v_expires);
  perform private.write_audit(v_user, 'agent.pairing_created', 'agent', null, jsonb_build_object('capabilities', jsonb_build_array('mt5.read')));
  return jsonb_build_object(
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' ||
            substr(v_code, 13, 4) || '-' || substr(v_code, 17, 4),
    'expires_at', v_expires
  );
end;
$$;

-- Called by POST /api/agent/pair (service_role). The connector proves
-- possession of the code (hash) and registers the hash of its own token.
create function public.agent_pair(
  p_code_sha256 bytea,
  p_token_sha256 bytea,
  p_agent_version text,
  p_platform text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pairing private.agent_pairings;
  v_agent uuid;
begin
  select * into v_pairing from private.agent_pairings
   where code_sha256 = p_code_sha256 and used_at is null and expires_at > clock_timestamp()
   for update;
  if v_pairing.id is null then
    raise exception 'pairing code is invalid, expired or already used' using errcode = 'TPP01';
  end if;
  if private.parse_version(p_agent_version) is null
     or (p_platform is not null and (char_length(p_platform) > 60 or p_platform ~ '[[:cntrl:]]')) then
    raise exception 'agent version or platform is not valid' using errcode = 'TPV01';
  end if;
  if exists (select 1 from private.agent_credentials where token_sha256 = p_token_sha256) then
    raise exception 'token already registered' using errcode = 'TPV01';
  end if;

  insert into public.agents (display_name, allowed_capabilities, max_concurrent_tasks, owner_user_id, agent_version, platform)
  values (v_pairing.display_name, v_pairing.capabilities, 1, v_pairing.owner_user_id, p_agent_version, p_platform)
  returning id into v_agent;
  insert into private.agent_credentials (agent_id, token_sha256) values (v_agent, p_token_sha256);
  update private.agent_pairings set used_at = clock_timestamp(), agent_id = v_agent where id = v_pairing.id;
  perform private.write_audit(v_pairing.owner_user_id, 'agent.paired', 'agent', v_agent::text,
                              jsonb_build_object('capabilities', to_jsonb(v_pairing.capabilities)));
  return jsonb_build_object('agent_id', v_agent, 'display_name', v_pairing.display_name,
                            'capabilities', to_jsonb(v_pairing.capabilities));
end;
$$;

-- -----------------------------------------------------------------------------
-- MT5 connections (one per agent)
-- -----------------------------------------------------------------------------

create table public.mt5_connections (
  id                        uuid primary key default gen_random_uuid(),
  owner_user_id             uuid not null references auth.users (id) on delete cascade,
  agent_id                  uuid not null unique references public.agents (id) on delete cascade,
  status                    text not null default 'awaiting_verification'
                            check (status in ('awaiting_verification', 'verified', 'blocked', 'disconnected')),
  status_reason             text check (status_reason in ('terminal_unavailable', 'not_logged_in', 'account_unavailable',
                                                          'broker_disconnected', 'unsupported_terminal',
                                                          'unsupported_account_type', 'account_changed',
                                                          'disconnected_by_owner', 'agent_revoked')),
  -- HMAC-SHA256(local install secret, login@server), computed on the Windows PC.
  account_fingerprint       text check (account_fingerprint ~ '^[0-9a-f]{64}$'),
  masked_account              text check (masked_account ~ '^\*{4}[0-9]{1,4}$'),
  server                    text check (char_length(server) <= 64 and server !~ '[[:cntrl:]]'),
  company                   text check (char_length(company) <= 128 and company !~ '[[:cntrl:]]'),
  currency                  text check (currency ~ '^[A-Z]{3,6}$'),
  currency_digits           smallint check (currency_digits between 0 and 8),
  leverage                  int check (leverage between 1 and 100000),
  detected_trade_mode       text check (detected_trade_mode in ('demo', 'contest', 'real', 'unknown')),
  terminal_build            int check (terminal_build between 1 and 1000000),
  terminal_connected        boolean,
  connector_version         text check (connector_version is null or private.parse_version(connector_version) is not null),
  broker_utc_offset_minutes smallint check (broker_utc_offset_minutes between -840 and 840),
  broker_offset_source      text check (broker_offset_source in ('estimated', 'configured', 'unknown')),
  quote_interval_ms         int not null default 2000 check (quote_interval_ms between 1000 and 60000),
  account_interval_s        int not null default 10 check (account_interval_s between 5 and 300),
  snapshot_interval_s       int not null default 60 check (snapshot_interval_s between 60 and 3600),
  history_days              smallint not null default 7 check (history_days between 1 and 30),
  first_verified_at         timestamptz,
  verified_at               timestamptz,
  last_report_at            timestamptz,
  last_account_at           timestamptz,
  last_snapshot_at          timestamptz,
  last_quotes_at            timestamptz,
  last_positions_at         timestamptz,
  last_orders_at            timestamptz,
  last_deals_at             timestamptz,
  last_symbols_at           timestamptz,
  last_bars_at              timestamptz,
  symbols_batch_id          uuid,
  disconnected_at           timestamptz,
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp(),
  check (status <> 'verified' or (account_fingerprint is not null and detected_trade_mode = 'demo' and verified_at is not null)),
  check ((status = 'disconnected') = (disconnected_at is not null))
);
create index mt5_connections_owner_idx on public.mt5_connections (owner_user_id);

create function private.touch_mt5_connection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.owner_user_id <> old.owner_user_id or new.agent_id <> old.agent_id or new.id <> old.id then
    raise exception 'connection ownership is immutable' using errcode = '42501';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger mt5_connections_touch before update on public.mt5_connections
  for each row execute function private.touch_mt5_connection();

-- -----------------------------------------------------------------------------
-- Data tables (bounded; current state + modest history)
-- -----------------------------------------------------------------------------

create table public.mt5_account_state (
  connection_id   uuid primary key references public.mt5_connections (id) on delete cascade,
  owner_user_id   uuid not null references auth.users (id) on delete cascade,
  balance         numeric not null,
  credit          numeric not null,
  equity          numeric not null,
  profit          numeric not null,
  margin          numeric not null,
  margin_free     numeric not null,
  margin_level    numeric,
  currency        text not null check (currency ~ '^[A-Z]{3,6}$'),
  currency_digits smallint not null check (currency_digits between 0 and 8),
  leverage        int check (leverage between 1 and 100000),
  observed_at     timestamptz not null,
  received_at     timestamptz not null default clock_timestamp()
);

create table public.mt5_account_snapshots (
  id            bigint generated always as identity primary key,
  connection_id uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  observed_at   timestamptz not null,
  balance       numeric not null,
  equity        numeric not null,
  profit        numeric not null,
  margin        numeric not null,
  margin_free   numeric not null,
  margin_level  numeric
);
create index mt5_account_snapshots_conn_time_idx on public.mt5_account_snapshots (connection_id, observed_at desc);

create table public.mt5_symbols (
  connection_id   uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id   uuid not null references auth.users (id) on delete cascade,
  name            text not null check (name ~ '^[A-Za-z0-9._#+&!$@-]{1,32}$'),
  description     text check (char_length(description) <= 128 and description !~ '[[:cntrl:]]'),
  path            text check (char_length(path) <= 128 and path !~ '[[:cntrl:]]'),
  digits          smallint not null check (digits between 0 and 10),
  point           numeric not null check (point > 0),
  currency_base   text check (char_length(currency_base) <= 12),
  currency_profit text check (char_length(currency_profit) <= 12),
  trade_mode      smallint check (trade_mode between 0 and 4),
  visible         boolean not null default false,
  monitored       boolean not null default false,
  available       boolean not null default true,
  seen_batch      uuid,
  updated_at      timestamptz not null default clock_timestamp(),
  primary key (connection_id, name)
);
create index mt5_symbols_monitored_idx on public.mt5_symbols (connection_id) where monitored;

create table public.mt5_quotes (
  connection_id uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  symbol        text not null,
  bid           numeric not null check (bid > 0),
  ask           numeric not null check (ask > 0 and ask >= bid),
  last          numeric check (last >= 0),
  -- When the broker produced the tick (converted to UTC by the connector).
  tick_time     timestamptz not null,
  -- When the connector read it from the terminal.
  observed_at   timestamptz not null,
  -- When the server stored it.
  received_at   timestamptz not null default clock_timestamp(),
  primary key (connection_id, symbol)
);

create table public.mt5_bars (
  connection_id uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  symbol        text not null,
  timeframe     text not null check (timeframe in ('M1', 'M5', 'M15', 'H1')),
  open_time     timestamptz not null,
  open          numeric not null check (open > 0),
  high          numeric not null,
  low           numeric not null check (low > 0),
  close         numeric not null check (close > 0),
  tick_volume   bigint check (tick_volume >= 0),
  real_volume   numeric check (real_volume >= 0),
  spread        int check (spread >= 0),
  received_at   timestamptz not null default clock_timestamp(),
  primary key (connection_id, symbol, timeframe, open_time),
  check (high >= greatest(open, close) and low <= least(open, close))
);

create table public.mt5_positions (
  connection_id uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  ticket        bigint not null check (ticket > 0),
  symbol        text not null,
  side          text not null check (side in ('buy', 'sell')),
  volume        numeric not null check (volume > 0),
  price_open    numeric not null check (price_open >= 0),
  price_current numeric check (price_current >= 0),
  stop_loss     numeric check (stop_loss >= 0),
  take_profit   numeric check (take_profit >= 0),
  profit        numeric not null,
  swap          numeric not null,
  opened_at     timestamptz not null,
  observed_at   timestamptz not null,
  primary key (connection_id, ticket)
);

create table public.mt5_orders (
  connection_id   uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id   uuid not null references auth.users (id) on delete cascade,
  ticket          bigint not null check (ticket > 0),
  symbol          text not null,
  order_type      text not null check (order_type in ('buy_limit', 'sell_limit', 'buy_stop', 'sell_stop',
                                                      'buy_stop_limit', 'sell_stop_limit', 'other')),
  volume_initial  numeric not null check (volume_initial >= 0),
  volume_current  numeric not null check (volume_current >= 0),
  price_open      numeric not null check (price_open >= 0),
  price_stoplimit numeric check (price_stoplimit >= 0),
  stop_loss       numeric check (stop_loss >= 0),
  take_profit     numeric check (take_profit >= 0),
  placed_at       timestamptz not null,
  observed_at     timestamptz not null,
  primary key (connection_id, ticket)
);

create table public.mt5_deals (
  connection_id uuid not null references public.mt5_connections (id) on delete cascade,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  ticket        bigint not null check (ticket > 0),
  order_ticket  bigint check (order_ticket >= 0),
  position_id   bigint check (position_id >= 0),
  symbol        text not null check (char_length(symbol) <= 32),
  deal_type     text not null check (deal_type in ('buy', 'sell', 'balance', 'credit', 'charge', 'correction',
                                                   'bonus', 'commission', 'other')),
  entry         text check (entry in ('in', 'out', 'inout', 'out_by')),
  volume        numeric not null check (volume >= 0),
  price         numeric not null check (price >= 0),
  profit        numeric not null,
  commission    numeric not null,
  swap          numeric not null,
  fee           numeric not null,
  executed_at   timestamptz not null,
  observed_at   timestamptz not null,
  primary key (connection_id, ticket)
);
create index mt5_deals_conn_time_idx on public.mt5_deals (connection_id, executed_at desc);

-- -----------------------------------------------------------------------------
-- JSON validation helpers (raise TPV01 with the field name; never echo values)
-- -----------------------------------------------------------------------------

create function private.jnum(p jsonb, p_key text, p_min numeric, p_max numeric, p_required boolean default true)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null or not p ? p_key or jsonb_typeof(p -> p_key) = 'null' then
    if p_required then
      raise exception 'field % is required', p_key using errcode = 'TPV01';
    end if;
    return null;
  end if;
  if jsonb_typeof(p -> p_key) <> 'number' then
    raise exception 'field % must be a number', p_key using errcode = 'TPV01';
  end if;
  v := (p ->> p_key)::numeric;
  if v < p_min or v > p_max then
    raise exception 'field % is out of range', p_key using errcode = 'TPV01';
  end if;
  return v;
end;
$$;

create function private.jtext(p jsonb, p_key text, p_max_len int, p_pattern text default null, p_required boolean default true)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p is null or not p ? p_key or jsonb_typeof(p -> p_key) = 'null' then
    if p_required then
      raise exception 'field % is required', p_key using errcode = 'TPV01';
    end if;
    return null;
  end if;
  if jsonb_typeof(p -> p_key) <> 'string' then
    raise exception 'field % must be text', p_key using errcode = 'TPV01';
  end if;
  v := p ->> p_key;
  if char_length(v) > p_max_len or v ~ '[[:cntrl:]]' or (p_pattern is not null and v !~ p_pattern) then
    raise exception 'field % is not valid', p_key using errcode = 'TPV01';
  end if;
  return v;
end;
$$;

-- Credential-like keys anywhere in a (possibly large, explicitly bounded) payload.
-- Unlike private.json_has_secret_like_key this does not limit array lengths:
-- each publish kind enforces its own list limits.
create function private.json_has_credential_key(j jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with recursive walk(v, depth) as (
    select j, 0
    union all
    select e.value, w.depth + 1
      from walk w
      cross join lateral (
        select value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end)
        union all
        select value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end)
      ) e
     where w.depth < 6
  )
  select exists (
    select 1 from walk w
     cross join lateral jsonb_object_keys(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) k
     where k !~ '^[a-z][a-z0-9_]{0,39}$'
        or k ~* '(pass|secret|token|apikey|api_key|credential|authorization|cookie|session|jwt|private_key|login)'
  ) or exists (select 1 from walk where depth >= 6);
$$;

-- UTC timestamps between 1990 and "now + 1 day" (broker data never comes from the future).
create function private.jts(p jsonb, p_key text, p_required boolean default true)
returns timestamptz
language plpgsql
volatile
set search_path = ''
as $$
declare
  v timestamptz;
begin
  if p is null or not p ? p_key or jsonb_typeof(p -> p_key) = 'null' then
    if p_required then
      raise exception 'field % is required', p_key using errcode = 'TPV01';
    end if;
    return null;
  end if;
  if jsonb_typeof(p -> p_key) <> 'string' or (p ->> p_key) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$' then
    raise exception 'field % must be a UTC ISO timestamp', p_key using errcode = 'TPV01';
  end if;
  v := (p ->> p_key)::timestamptz;
  if v < '1990-01-01'::timestamptz or v > clock_timestamp() + interval '1 day' then
    raise exception 'field % is out of range', p_key using errcode = 'TPV01';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- Task types: enable the implemented read-only MT5 tasks, targeted at one connector
-- -----------------------------------------------------------------------------

alter table public.tasks add column target_agent_id uuid references public.agents (id) on delete restrict;

create function private.guard_task_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.target_agent_id is distinct from old.target_agent_id then
    raise exception 'task target is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tasks_target_guard before update on public.tasks
  for each row execute function private.guard_task_target();

insert into public.task_types
  (task_type, label, description, available, unavailable_reason, required_capability,
   min_agent_version, max_attempts, lease_seconds, queue_ttl_seconds, retry_base_seconds, max_payload_bytes)
values
  ('mt5.terminal_status', 'Check MT5 terminal', 'Read-only: re-checks the terminal, the logged-in account and its demo status.',
   true, null, 'mt5.read', '1.0.0', 2, 60, 300, 5, 256),
  ('mt5.account_snapshot', 'Refresh account', 'Read-only: reads balance, equity and margin from the terminal.',
   true, null, 'mt5.read', '1.0.0', 2, 60, 300, 5, 256),
  ('mt5.symbol_list', 'Refresh symbol list', 'Read-only: reads the symbols your broker offers in the terminal.',
   true, null, 'mt5.read', '1.0.0', 2, 120, 300, 5, 256),
  ('mt5.price_history', 'Load price history', 'Read-only: reads recent OHLC bars for one symbol and timeframe.',
   true, null, 'mt5.read', '1.0.0', 2, 60, 300, 5, 256),
  ('mt5.positions_read', 'Read open positions', 'Read-only: reads currently open positions.',
   true, null, 'mt5.read', '1.0.0', 2, 60, 300, 5, 256),
  ('mt5.pending_orders_read', 'Read pending orders', 'Read-only: reads currently pending orders.',
   true, null, 'mt5.read', '1.0.0', 2, 60, 300, 5, 256),
  ('mt5.recent_history_read', 'Read recent history', 'Read-only: reads completed deals from a bounded recent period.',
   true, null, 'mt5.read', '1.0.0', 2, 120, 300, 5, 256);

create or replace function private.is_valid_task_payload(p_type text, p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;
  case
    when p_type = 'system.health_check' then
      return not exists (select 1 from jsonb_object_keys(p_payload) k where k <> 'note')
         and (not p_payload ? 'note'
              or (jsonb_typeof(p_payload -> 'note') = 'string'
                  and char_length(p_payload ->> 'note') between 1 and 80
                  and (p_payload ->> 'note') !~ '[[:cntrl:]]'));
    when p_type in ('mt5.terminal_status', 'mt5.account_snapshot', 'mt5.symbol_list',
                    'mt5.positions_read', 'mt5.pending_orders_read') then
      return not exists (select 1 from jsonb_object_keys(p_payload) k where k <> 'connection_id')
         and jsonb_typeof(p_payload -> 'connection_id') = 'string'
         and (p_payload ->> 'connection_id') ~ v_uuid;
    when p_type = 'mt5.price_history' then
      return not exists (select 1 from jsonb_object_keys(p_payload) k
                         where k not in ('connection_id', 'symbol', 'timeframe', 'count'))
         and jsonb_typeof(p_payload -> 'connection_id') = 'string' and (p_payload ->> 'connection_id') ~ v_uuid
         and jsonb_typeof(p_payload -> 'symbol') = 'string' and (p_payload ->> 'symbol') ~ '^[A-Za-z0-9._#+&!$@-]{1,32}$'
         and jsonb_typeof(p_payload -> 'timeframe') = 'string' and (p_payload ->> 'timeframe') in ('M1', 'M5', 'M15', 'H1')
         and jsonb_typeof(p_payload -> 'count') = 'number'
         and (p_payload ->> 'count') ~ '^\d+$' and (p_payload ->> 'count')::int between 10 and 500;
    when p_type = 'mt5.recent_history_read' then
      return not exists (select 1 from jsonb_object_keys(p_payload) k where k not in ('connection_id', 'days'))
         and jsonb_typeof(p_payload -> 'connection_id') = 'string' and (p_payload ->> 'connection_id') ~ v_uuid
         and jsonb_typeof(p_payload -> 'days') = 'number'
         and (p_payload ->> 'days') ~ '^\d+$' and (p_payload ->> 'days')::int between 1 and 30;
    else
      -- Types without a contract (mt5.compile_ea, mt5.backtest, …) cannot carry anything.
      return false;
  end case;
end;
$$;

-- For mt5.* tasks: the connection must belong to the submitting owner and be
-- verified (terminal_status may also run while awaiting verification). The
-- task is then targeted at that connection's agent only.
create function private.mt5_task_target(p_user uuid, p_type text, p_payload jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conn public.mt5_connections;
begin
  if p_type not like 'mt5.%' then
    return null;
  end if;
  select * into v_conn from public.mt5_connections
   where id = (p_payload ->> 'connection_id')::uuid and owner_user_id = p_user;
  if v_conn.id is null then
    raise exception 'that MetaTrader 5 connection was not found' using errcode = 'P0002';
  end if;
  if not (v_conn.status = 'verified'
          or (p_type = 'mt5.terminal_status' and v_conn.status = 'awaiting_verification')) then
    raise exception 'the MetaTrader 5 connection is not verified as a demo account' using errcode = 'TPU03';
  end if;
  return v_conn.agent_id;
end;
$$;

create or replace function public.submit_task(p_task_type text, p_payload jsonb, p_idempotency_key text)
returns public.tasks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_owner_session();
  v_type public.task_types;
  v_task public.tasks;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_target uuid;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'idempotency key must be 8-64 letters, digits, dashes or underscores' using errcode = 'TPV01';
  end if;

  select * into v_task from public.tasks where owner_user_id = v_user and idempotency_key = p_idempotency_key;
  if v_task.id is not null then
    if v_task.task_type <> p_task_type or v_task.payload <> v_payload then
      raise exception 'this idempotency key was already used for a different request' using errcode = 'TPI01';
    end if;
    return v_task;
  end if;

  select * into v_type from public.task_types where task_type = p_task_type;
  if v_type.task_type is null then
    raise exception 'unknown task type' using errcode = 'TPV01';
  end if;
  if not v_type.available then
    raise exception '%', v_type.unavailable_reason using errcode = 'TPU01';
  end if;
  if pg_catalog.octet_length(v_payload::text) > v_type.max_payload_bytes
     or not private.is_valid_task_payload(p_task_type, v_payload)
     or not private.is_safe_task_json(v_payload, 4096) then
    raise exception 'the task details are not valid for this task type' using errcode = 'TPV01';
  end if;

  v_target := private.mt5_task_target(v_user, p_task_type, v_payload);

  perform pg_advisory_xact_lock(hashtextextended('tp.submit:' || v_user::text, 0));

  select * into v_task from public.tasks where owner_user_id = v_user and idempotency_key = p_idempotency_key;
  if v_task.id is not null then
    if v_task.task_type <> p_task_type or v_task.payload <> v_payload then
      raise exception 'this idempotency key was already used for a different request' using errcode = 'TPI01';
    end if;
    return v_task;
  end if;

  if (select count(*) from public.tasks
      where owner_user_id = v_user and created_at > clock_timestamp() - interval '1 minute') >= 10 then
    raise exception 'too many tasks submitted in the last minute' using errcode = 'TPR01';
  end if;
  if (select count(*) from public.tasks
      where owner_user_id = v_user and status in ('queued', 'claimed', 'running', 'cancel_requested')) >= 5 then
    raise exception 'too many tasks are already waiting or running' using errcode = 'TPR01';
  end if;

  if not exists (
    select 1 from public.agents a
    where private.agent_is_online(a.last_heartbeat_at, a.revoked_at)
      and (v_target is null or a.id = v_target)
      and v_type.required_capability = any (a.allowed_capabilities)
      and v_type.required_capability = any (a.reported_capabilities)
      and private.parse_version(a.agent_version) >= private.parse_version(v_type.min_agent_version)
  ) then
    raise exception 'no online agent can run this task right now' using errcode = 'TPU02';
  end if;

  insert into public.tasks (origin, owner_user_id, task_type, payload, idempotency_key,
                            expires_at, max_attempts, target_agent_id)
  values ('user', v_user, p_task_type, v_payload, p_idempotency_key,
          clock_timestamp() + make_interval(secs => v_type.queue_ttl_seconds), v_type.max_attempts, v_target)
  returning * into v_task;

  perform private.write_audit(v_user, 'task.submitted', 'task', v_task.id::text,
                              jsonb_build_object('task_type', p_task_type));
  return v_task;
end;
$$;

create or replace function public.agent_claim(p_token_sha256 bytea)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
  v_task public.tasks;
  v_lease uuid := gen_random_uuid();
  v_lease_seconds int;
begin
  if not private.agent_is_online(v_agent.last_heartbeat_at, v_agent.revoked_at) then
    raise exception 'send a heartbeat before claiming work' using errcode = 'TPA02';
  end if;

  perform private.recover_tasks();

  if (select count(*) from public.tasks
      where claimed_by_agent = v_agent.id and status in ('claimed', 'running', 'cancel_requested'))
     >= v_agent.max_concurrent_tasks then
    return null;
  end if;

  select t.* into v_task
  from public.tasks t
  join public.task_types tt on tt.task_type = t.task_type
  where t.status = 'queued'
    and t.available_at <= clock_timestamp()
    and t.expires_at > clock_timestamp()
    and (t.target_agent_id is null or t.target_agent_id = v_agent.id)
    and tt.available
    and tt.required_capability = any (v_agent.allowed_capabilities)
    and tt.required_capability = any (v_agent.reported_capabilities)
    and private.parse_version(v_agent.agent_version) >= private.parse_version(tt.min_agent_version)
  order by t.available_at, t.created_at
  limit 1
  for update of t skip locked;

  if v_task.id is null then
    return null;
  end if;

  select lease_seconds into v_lease_seconds from public.task_types where task_type = v_task.task_type;

  update public.tasks
     set status = 'claimed', claimed_by_agent = v_agent.id, claimed_at = clock_timestamp(),
         lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
         attempt_count = attempt_count + 1, error = null
   where id = v_task.id
  returning * into v_task;

  insert into private.task_leases (task_id, agent_id, lease_token, attempt)
  values (v_task.id, v_agent.id, v_lease, v_task.attempt_count)
  on conflict (task_id) do update set agent_id = excluded.agent_id, lease_token = excluded.lease_token,
                                      attempt = excluded.attempt;

  insert into public.task_attempts (task_id, attempt_number, agent_id, claimed_at)
  values (v_task.id, v_task.attempt_count, v_agent.id, v_task.claimed_at);

  return jsonb_build_object(
    'task_id', v_task.id, 'task_type', v_task.task_type, 'payload', v_task.payload,
    'attempt', v_task.attempt_count, 'max_attempts', v_task.max_attempts,
    'lease_token', v_lease, 'lease_expires_at', v_task.lease_expires_at,
    'lease_seconds', v_lease_seconds
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Connector side (service_role only, via /api/agent/*)
-- -----------------------------------------------------------------------------

-- Authenticates the agent and requires the read-only MT5 capability.
create function private.authenticate_mt5_agent(p_token_sha256 bytea)
returns public.agents
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
begin
  if not ('mt5.read' = any (v_agent.allowed_capabilities)) then
    raise exception 'this agent is not allowed to read MetaTrader 5 data' using errcode = 'TPA03';
  end if;
  if v_agent.owner_user_id is null then
    raise exception 'this agent is not attached to a workspace' using errcode = 'TPA03';
  end if;
  -- Telemetry doubles as a heartbeat.
  update public.agents set last_heartbeat_at = now() where id = v_agent.id;
  return v_agent;
end;
$$;

create function private.mt5_connection_state(p_conn public.mt5_connections)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'connection_id', p_conn.id,
    'status', p_conn.status,
    'reason', p_conn.status_reason,
    'monitored_symbols', coalesce((select jsonb_agg(s.name order by s.name) from public.mt5_symbols s
                                   where s.connection_id = p_conn.id and s.monitored), '[]'::jsonb),
    'settings', jsonb_build_object('quote_interval_ms', p_conn.quote_interval_ms,
                                   'account_interval_s', p_conn.account_interval_s,
                                   'snapshot_interval_s', p_conn.snapshot_interval_s,
                                   'history_days', p_conn.history_days)
  );
$$;

create function private.set_mt5_status(p_conn public.mt5_connections, p_status text, p_reason text)
returns public.mt5_connections
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.mt5_connections;
begin
  update public.mt5_connections set status = p_status, status_reason = p_reason
   where id = p_conn.id returning * into v;
  if p_conn.status is distinct from p_status and p_status = 'blocked' then
    perform private.write_audit(p_conn.owner_user_id, 'connector.blocked', 'connection', p_conn.id::text,
                                jsonb_build_object('reason', p_reason));
  end if;
  return v;
end;
$$;

-- The connector's verification report. Called on start, every ~30 s and on
-- any change. Decides the connection status; it never trusts a previous
-- verification after the account changes.
create function public.mt5_report_connection(p_token_sha256 bytea, p_report jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_mt5_agent(p_token_sha256);
  v_conn public.mt5_connections;
  v_state text;
  v_mode text;
  v_code numeric;
  v_fp text;
  v_was text;
begin
  if jsonb_typeof(p_report) <> 'object' or pg_catalog.octet_length(p_report::text) > 4096
     or private.json_has_secret_like_key(p_report) then
    raise exception 'report is not valid' using errcode = 'TPV01';
  end if;
  v_state := private.jtext(p_report, 'state', 32,
                           '^(ok|terminal_unavailable|not_logged_in|account_unavailable|broker_disconnected|unsupported_terminal)$');

  select * into v_conn from public.mt5_connections where agent_id = v_agent.id for update;
  if v_conn.id is null then
    insert into public.mt5_connections (owner_user_id, agent_id) values (v_agent.owner_user_id, v_agent.id)
    returning * into v_conn;
  end if;
  v_was := v_conn.status;

  -- Facts about the local software are always recorded.
  update public.mt5_connections
     set last_report_at = clock_timestamp(),
         connector_version = private.jtext(p_report, 'connector_version', 16, '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
         terminal_build = private.jnum(p_report, 'terminal_build', 1, 1000000, false)::int,
         terminal_connected = case when jsonb_typeof(p_report -> 'terminal_connected') = 'boolean'
                                   then (p_report ->> 'terminal_connected')::boolean end
   where id = v_conn.id
  returning * into v_conn;

  if v_conn.status = 'disconnected' then
    return private.mt5_connection_state(v_conn);
  end if;

  if v_state <> 'ok' then
    -- Not verifiable right now. A block stays a block; otherwise wait for verification.
    if v_conn.status <> 'blocked' then
      v_conn := private.set_mt5_status(v_conn, 'awaiting_verification', v_state);
    end if;
    return private.mt5_connection_state(v_conn);
  end if;

  v_mode := private.jtext(p_report, 'trade_mode', 8, '^(demo|contest|real|unknown)$');
  v_code := private.jnum(p_report, 'trade_mode_code', -1, 100, false);
  if v_mode <> 'demo' or v_code is distinct from 0 then
    -- Fail closed: nothing about this account (login, server, currency) is stored.
    update public.mt5_connections
       set detected_trade_mode = case when v_mode = 'demo' then 'unknown' else v_mode end,
           status = 'blocked', status_reason = 'unsupported_account_type'
     where id = v_conn.id returning * into v_conn;
    if v_was is distinct from 'blocked' then
      perform private.write_audit(v_conn.owner_user_id, 'connector.blocked', 'connection', v_conn.id::text,
                                  jsonb_build_object('reason', 'unsupported_account_type'));
    end if;
    return private.mt5_connection_state(v_conn);
  end if;

  v_fp := private.jtext(p_report, 'account_fingerprint', 64, '^[0-9a-f]{64}$');
  if v_conn.account_fingerprint is not null and v_conn.account_fingerprint <> v_fp then
    v_conn := private.set_mt5_status(v_conn, 'blocked', 'account_changed');
    return private.mt5_connection_state(v_conn);
  end if;

  update public.mt5_connections
     set account_fingerprint = v_fp,
         masked_account = private.jtext(p_report, 'masked_account', 8, '^\*{4}[0-9]{1,4}$'),
         server = private.jtext(p_report, 'server', 64),
         company = private.jtext(p_report, 'company', 128, null, false),
         currency = private.jtext(p_report, 'currency', 6, '^[A-Z]{3,6}$'),
         currency_digits = private.jnum(p_report, 'currency_digits', 0, 8)::smallint,
         leverage = private.jnum(p_report, 'leverage', 1, 100000, false)::int,
         detected_trade_mode = 'demo',
         broker_utc_offset_minutes = private.jnum(p_report, 'broker_utc_offset_minutes', -840, 840, false)::smallint,
         broker_offset_source = coalesce(private.jtext(p_report, 'broker_offset_source', 10, '^(estimated|configured|unknown)$', false), 'unknown'),
         verified_at = clock_timestamp(),
         first_verified_at = coalesce(first_verified_at, clock_timestamp()),
         status = 'verified',
         status_reason = null
   where id = v_conn.id
  returning * into v_conn;

  if v_was <> 'verified' then
    perform private.write_audit(v_conn.owner_user_id, 'connector.verified', 'connection', v_conn.id::text,
                                jsonb_build_object('trade_mode', 'demo'));
  end if;
  return private.mt5_connection_state(v_conn);
end;
$$;

-- Publishes one kind of read-only data for the agent's own, verified connection.
create function public.mt5_publish(
  p_token_sha256 bytea,
  p_connection_id uuid,
  p_account_fingerprint text,
  p_kind text,
  p_data jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_mt5_agent(p_token_sha256);
  v_conn public.mt5_connections;
  v_now timestamptz := clock_timestamp();
  v_item jsonb;
  v_count int := 0;
  v_observed timestamptz;
  v_symbol text;
  v_tf text;
  v_tickets bigint[];
  v_digits smallint;
  v_min interval;
  v_last timestamptz;
begin
  if p_kind not in ('account', 'quotes', 'symbols', 'bars', 'positions', 'orders', 'deals') then
    raise exception 'unknown data kind' using errcode = 'TPV01';
  end if;
  if jsonb_typeof(p_data) <> 'object' or private.json_has_credential_key(p_data) then
    raise exception 'data is not valid' using errcode = 'TPV01';
  end if;

  select * into v_conn from public.mt5_connections
   where id = p_connection_id and agent_id = v_agent.id for update;
  if v_conn.id is null then
    raise exception 'connection does not belong to this agent' using errcode = 'TPA03';
  end if;
  if v_conn.status = 'disconnected' then
    raise exception 'connection was disconnected in the website' using errcode = 'TPC01';
  end if;
  if v_conn.status = 'blocked' then
    raise exception 'connection is blocked' using errcode = 'TPC02';
  end if;
  if v_conn.status <> 'verified' then
    raise exception 'connection is not verified' using errcode = 'TPC03';
  end if;
  if p_account_fingerprint is null or p_account_fingerprint <> v_conn.account_fingerprint then
    -- Data from another account: refuse it and block the connection.
    v_conn := private.set_mt5_status(v_conn, 'blocked', 'account_changed');
    return jsonb_build_object('accepted', false, 'status', 'blocked', 'reason', 'account_changed');
  end if;

  -- Rate limits per kind (the connector's configured intervals are larger).
  v_min := case p_kind when 'quotes' then interval '800 milliseconds'
                       when 'account' then interval '4 seconds'
                       when 'positions' then interval '2 seconds'
                       when 'orders' then interval '2 seconds'
                       when 'deals' then interval '5 seconds'
                       else interval '200 milliseconds' end;
  v_last := case p_kind when 'quotes' then v_conn.last_quotes_at when 'account' then v_conn.last_account_at
                        when 'positions' then v_conn.last_positions_at when 'orders' then v_conn.last_orders_at
                        when 'deals' then v_conn.last_deals_at when 'symbols' then v_conn.last_symbols_at
                        else v_conn.last_bars_at end;
  if v_last is not null and v_last > v_now - v_min then
    raise exception 'updates are arriving too fast' using errcode = 'TPR02';
  end if;

  if p_kind = 'account' then
    if private.jtext(p_data, 'currency', 6, '^[A-Z]{3,6}$') <> v_conn.currency then
      raise exception 'account currency does not match the verified account' using errcode = 'TPV01';
    end if;
    v_observed := private.jts(p_data, 'observed_at');
    insert into public.mt5_account_state as s
      (connection_id, owner_user_id, balance, credit, equity, profit, margin, margin_free, margin_level,
       currency, currency_digits, leverage, observed_at, received_at)
    values (v_conn.id, v_conn.owner_user_id,
            private.jnum(p_data, 'balance', -1e15, 1e15), private.jnum(p_data, 'credit', -1e15, 1e15),
            private.jnum(p_data, 'equity', -1e15, 1e15), private.jnum(p_data, 'profit', -1e15, 1e15),
            private.jnum(p_data, 'margin', 0, 1e15), private.jnum(p_data, 'margin_free', -1e15, 1e15),
            private.jnum(p_data, 'margin_level', 0, 1e12, false),
            v_conn.currency, private.jnum(p_data, 'currency_digits', 0, 8)::smallint,
            private.jnum(p_data, 'leverage', 1, 100000, false)::int, v_observed, v_now)
    on conflict (connection_id) do update set
      balance = excluded.balance, credit = excluded.credit, equity = excluded.equity, profit = excluded.profit,
      margin = excluded.margin, margin_free = excluded.margin_free, margin_level = excluded.margin_level,
      currency_digits = excluded.currency_digits, leverage = excluded.leverage,
      observed_at = excluded.observed_at, received_at = excluded.received_at;
    if v_conn.last_snapshot_at is null or v_conn.last_snapshot_at <= v_now - make_interval(secs => v_conn.snapshot_interval_s - 1) then
      insert into public.mt5_account_snapshots (connection_id, owner_user_id, observed_at, balance, equity, profit, margin, margin_free, margin_level)
      select connection_id, owner_user_id, observed_at, balance, equity, profit, margin, margin_free, margin_level
        from public.mt5_account_state where connection_id = v_conn.id;
      update public.mt5_connections set last_snapshot_at = v_now where id = v_conn.id;
    end if;
    update public.mt5_connections set last_account_at = v_now where id = v_conn.id;
    -- Piggy-back the owner's current symbol choice and intervals (picked up within one account interval).
    return private.mt5_connection_state(v_conn) || jsonb_build_object('accepted', true);
  end if;

  if p_kind = 'quotes' then
    v_observed := private.jts(p_data, 'observed_at');
    if jsonb_typeof(p_data -> 'quotes') <> 'array' or jsonb_array_length(p_data -> 'quotes') > 8 then
      raise exception 'quotes must be a list of at most 8 entries' using errcode = 'TPV01';
    end if;
    for v_item in select * from jsonb_array_elements(p_data -> 'quotes') loop
      v_symbol := private.jtext(v_item, 'symbol', 32, '^[A-Za-z0-9._#+&!$@-]{1,32}$');
      -- Only symbols the owner chose to monitor are stored.
      continue when not exists (select 1 from public.mt5_symbols
                                where connection_id = v_conn.id and name = v_symbol and monitored);
      if private.jnum(v_item, 'ask', 0, 1e12) < private.jnum(v_item, 'bid', 0, 1e12)
         or private.jnum(v_item, 'bid', 0, 1e12) <= 0 then
        raise exception 'quote for % is not valid', v_symbol using errcode = 'TPV01';
      end if;
      insert into public.mt5_quotes as q (connection_id, owner_user_id, symbol, bid, ask, last, tick_time, observed_at, received_at)
      values (v_conn.id, v_conn.owner_user_id, v_symbol, private.jnum(v_item, 'bid', 0, 1e12), private.jnum(v_item, 'ask', 0, 1e12),
              private.jnum(v_item, 'last', 0, 1e12, false), private.jts(v_item, 'tick_time'), v_observed, v_now)
      on conflict (connection_id, symbol) do update set
        bid = excluded.bid, ask = excluded.ask, last = excluded.last, tick_time = excluded.tick_time,
        observed_at = excluded.observed_at, received_at = excluded.received_at
      -- Unchanged ticks are not rewritten (no fake "updates").
      where (q.bid, q.ask, q.last, q.tick_time) is distinct from (excluded.bid, excluded.ask, excluded.last, excluded.tick_time);
      v_count := v_count + 1;
    end loop;
    update public.mt5_connections set last_quotes_at = v_now where id = v_conn.id;
    return jsonb_build_object('accepted', true, 'status', 'verified', 'stored', v_count);
  end if;

  if p_kind = 'symbols' then
    if jsonb_typeof(p_data -> 'symbols') <> 'array' or jsonb_array_length(p_data -> 'symbols') > 1000 then
      raise exception 'symbols must be a list of at most 1000 entries per page' using errcode = 'TPV01';
    end if;
    if private.jtext(p_data, 'batch_id', 36, '^[0-9a-f-]{36}$')::uuid is distinct from v_conn.symbols_batch_id then
      if private.jnum(p_data, 'page', 0, 100)::int <> 0 then
        raise exception 'symbol pages must start at page 0' using errcode = 'TPV01';
      end if;
      update public.mt5_connections set symbols_batch_id = (p_data ->> 'batch_id')::uuid where id = v_conn.id
      returning * into v_conn;
    end if;
    for v_item in select * from jsonb_array_elements(p_data -> 'symbols') loop
      v_digits := private.jnum(v_item, 'digits', 0, 10)::smallint;
      insert into public.mt5_symbols as s (connection_id, owner_user_id, name, description, path, digits, point,
                                           currency_base, currency_profit, trade_mode, visible, available, seen_batch, updated_at)
      values (v_conn.id, v_conn.owner_user_id,
              private.jtext(v_item, 'name', 32, '^[A-Za-z0-9._#+&!$@-]{1,32}$'),
              private.jtext(v_item, 'description', 128, null, false),
              private.jtext(v_item, 'path', 128, null, false),
              v_digits, private.jnum(v_item, 'point', 0.0000000001, 1000000),
              private.jtext(v_item, 'currency_base', 12, null, false),
              private.jtext(v_item, 'currency_profit', 12, null, false),
              private.jnum(v_item, 'trade_mode', 0, 4, false)::smallint,
              coalesce(jsonb_typeof(v_item -> 'visible') = 'boolean' and (v_item ->> 'visible')::boolean, false),
              true, v_conn.symbols_batch_id, v_now)
      on conflict (connection_id, name) do update set
        description = excluded.description, path = excluded.path, digits = excluded.digits, point = excluded.point,
        currency_base = excluded.currency_base, currency_profit = excluded.currency_profit,
        trade_mode = excluded.trade_mode, visible = excluded.visible, available = true,
        seen_batch = excluded.seen_batch, updated_at = excluded.updated_at;
    end loop;
    if (select count(*) from public.mt5_symbols where connection_id = v_conn.id) > 5000 then
      raise exception 'too many symbols' using errcode = 'TPV01';
    end if;
    if jsonb_typeof(p_data -> 'final') = 'boolean' and (p_data ->> 'final')::boolean then
      -- Symbols the broker no longer offers: keep monitored ones (marked unavailable), drop the rest.
      update public.mt5_symbols set available = false
       where connection_id = v_conn.id and monitored and seen_batch is distinct from v_conn.symbols_batch_id;
      delete from public.mt5_symbols
       where connection_id = v_conn.id and not monitored and seen_batch is distinct from v_conn.symbols_batch_id;
    end if;
    update public.mt5_connections set last_symbols_at = v_now where id = v_conn.id;
    return jsonb_build_object('accepted', true, 'status', 'verified');
  end if;

  if p_kind = 'bars' then
    v_symbol := private.jtext(p_data, 'symbol', 32, '^[A-Za-z0-9._#+&!$@-]{1,32}$');
    v_tf := private.jtext(p_data, 'timeframe', 3, '^(M1|M5|M15|H1)$');
    if not exists (select 1 from public.mt5_symbols where connection_id = v_conn.id and name = v_symbol) then
      raise exception 'unknown symbol' using errcode = 'TPV01';
    end if;
    if jsonb_typeof(p_data -> 'bars') <> 'array' or jsonb_array_length(p_data -> 'bars') > 1000 then
      raise exception 'bars must be a list of at most 1000 entries' using errcode = 'TPV01';
    end if;
    for v_item in select * from jsonb_array_elements(p_data -> 'bars') loop
      if private.jnum(v_item, 'high', 0, 1e12) < greatest(private.jnum(v_item, 'open', 0, 1e12), private.jnum(v_item, 'close', 0, 1e12))
         or private.jnum(v_item, 'low', 0, 1e12) > least(private.jnum(v_item, 'open', 0, 1e12), private.jnum(v_item, 'close', 0, 1e12))
         or private.jnum(v_item, 'low', 0, 1e12) <= 0 then
        raise exception 'bar values are inconsistent' using errcode = 'TPV01';
      end if;
      insert into public.mt5_bars (connection_id, owner_user_id, symbol, timeframe, open_time, open, high, low, close,
                                   tick_volume, real_volume, spread, received_at)
      values (v_conn.id, v_conn.owner_user_id, v_symbol, v_tf, private.jts(v_item, 'open_time'),
              private.jnum(v_item, 'open', 0, 1e12), private.jnum(v_item, 'high', 0, 1e12),
              private.jnum(v_item, 'low', 0, 1e12), private.jnum(v_item, 'close', 0, 1e12),
              private.jnum(v_item, 'tick_volume', 0, 1e15, false)::bigint,
              private.jnum(v_item, 'real_volume', 0, 1e15, false),
              private.jnum(v_item, 'spread', 0, 1e9, false)::int, v_now)
      on conflict (connection_id, symbol, timeframe, open_time) do update set
        open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close,
        tick_volume = excluded.tick_volume, real_volume = excluded.real_volume, spread = excluded.spread,
        received_at = excluded.received_at;
      v_count := v_count + 1;
    end loop;
    -- Bounded history: keep the newest 1000 bars per series.
    delete from public.mt5_bars b
     where b.connection_id = v_conn.id and b.symbol = v_symbol and b.timeframe = v_tf
       and b.open_time < (select open_time from public.mt5_bars
                          where connection_id = v_conn.id and symbol = v_symbol and timeframe = v_tf
                          order by open_time desc offset 999 limit 1);
    update public.mt5_connections set last_bars_at = v_now where id = v_conn.id;
    return jsonb_build_object('accepted', true, 'status', 'verified', 'stored', v_count);
  end if;

  v_observed := private.jts(p_data, 'observed_at');
  if p_kind = 'positions' then
    if jsonb_typeof(p_data -> 'positions') <> 'array' or jsonb_array_length(p_data -> 'positions') > 200 then
      raise exception 'positions must be a list of at most 200 entries' using errcode = 'TPV01';
    end if;
    select coalesce(array_agg(private.jnum(x, 'ticket', 1, 9e18)::bigint), '{}') into v_tickets from jsonb_array_elements(p_data -> 'positions') x;
    delete from public.mt5_positions where connection_id = v_conn.id and not (ticket = any (v_tickets));
    for v_item in select * from jsonb_array_elements(p_data -> 'positions') loop
      insert into public.mt5_positions as p (connection_id, owner_user_id, ticket, symbol, side, volume, price_open, price_current,
                                             stop_loss, take_profit, profit, swap, opened_at, observed_at)
      values (v_conn.id, v_conn.owner_user_id, private.jnum(v_item, 'ticket', 1, 9e18)::bigint,
              private.jtext(v_item, 'symbol', 32, '^[A-Za-z0-9._#+&!$@-]{1,32}$'),
              private.jtext(v_item, 'side', 4, '^(buy|sell)$'),
              private.jnum(v_item, 'volume', 0, 1e9), private.jnum(v_item, 'price_open', 0, 1e12),
              private.jnum(v_item, 'price_current', 0, 1e12, false), private.jnum(v_item, 'stop_loss', 0, 1e12, false),
              private.jnum(v_item, 'take_profit', 0, 1e12, false), private.jnum(v_item, 'profit', -1e15, 1e15),
              private.jnum(v_item, 'swap', -1e15, 1e15), private.jts(v_item, 'opened_at'), v_observed)
      on conflict (connection_id, ticket) do update set
        symbol = excluded.symbol, side = excluded.side, volume = excluded.volume, price_open = excluded.price_open,
        price_current = excluded.price_current, stop_loss = excluded.stop_loss, take_profit = excluded.take_profit,
        profit = excluded.profit, swap = excluded.swap, opened_at = excluded.opened_at, observed_at = excluded.observed_at;
    end loop;
    update public.mt5_connections set last_positions_at = v_now where id = v_conn.id;
    return jsonb_build_object('accepted', true, 'status', 'verified');
  end if;

  if p_kind = 'orders' then
    if jsonb_typeof(p_data -> 'orders') <> 'array' or jsonb_array_length(p_data -> 'orders') > 200 then
      raise exception 'orders must be a list of at most 200 entries' using errcode = 'TPV01';
    end if;
    select coalesce(array_agg(private.jnum(x, 'ticket', 1, 9e18)::bigint), '{}') into v_tickets from jsonb_array_elements(p_data -> 'orders') x;
    delete from public.mt5_orders where connection_id = v_conn.id and not (ticket = any (v_tickets));
    for v_item in select * from jsonb_array_elements(p_data -> 'orders') loop
      insert into public.mt5_orders (connection_id, owner_user_id, ticket, symbol, order_type, volume_initial, volume_current,
                                     price_open, price_stoplimit, stop_loss, take_profit, placed_at, observed_at)
      values (v_conn.id, v_conn.owner_user_id, private.jnum(v_item, 'ticket', 1, 9e18)::bigint,
              private.jtext(v_item, 'symbol', 32, '^[A-Za-z0-9._#+&!$@-]{1,32}$'),
              private.jtext(v_item, 'order_type', 16, '^(buy_limit|sell_limit|buy_stop|sell_stop|buy_stop_limit|sell_stop_limit|other)$'),
              private.jnum(v_item, 'volume_initial', 0, 1e9), private.jnum(v_item, 'volume_current', 0, 1e9),
              private.jnum(v_item, 'price_open', 0, 1e12), private.jnum(v_item, 'price_stoplimit', 0, 1e12, false),
              private.jnum(v_item, 'stop_loss', 0, 1e12, false), private.jnum(v_item, 'take_profit', 0, 1e12, false),
              private.jts(v_item, 'placed_at'), v_observed)
      on conflict (connection_id, ticket) do update set
        symbol = excluded.symbol, order_type = excluded.order_type, volume_initial = excluded.volume_initial,
        volume_current = excluded.volume_current, price_open = excluded.price_open, price_stoplimit = excluded.price_stoplimit,
        stop_loss = excluded.stop_loss, take_profit = excluded.take_profit, placed_at = excluded.placed_at,
        observed_at = excluded.observed_at;
    end loop;
    update public.mt5_connections set last_orders_at = v_now where id = v_conn.id;
    return jsonb_build_object('accepted', true, 'status', 'verified');
  end if;

  -- deals: the result of one bounded history read replaces the stored window.
  if jsonb_typeof(p_data -> 'deals') <> 'array' or jsonb_array_length(p_data -> 'deals') > 500 then
    raise exception 'deals must be a list of at most 500 entries' using errcode = 'TPV01';
  end if;
  delete from public.mt5_deals where connection_id = v_conn.id;
  for v_item in select * from jsonb_array_elements(p_data -> 'deals') loop
    insert into public.mt5_deals (connection_id, owner_user_id, ticket, order_ticket, position_id, symbol, deal_type, entry,
                                  volume, price, profit, commission, swap, fee, executed_at, observed_at)
    values (v_conn.id, v_conn.owner_user_id, private.jnum(v_item, 'ticket', 1, 9e18)::bigint,
            private.jnum(v_item, 'order_ticket', 0, 9e18, false)::bigint, private.jnum(v_item, 'position_id', 0, 9e18, false)::bigint,
            coalesce(private.jtext(v_item, 'symbol', 32, '^[A-Za-z0-9._#+&!$@-]{0,32}$', false), ''),
            private.jtext(v_item, 'deal_type', 12, '^(buy|sell|balance|credit|charge|correction|bonus|commission|other)$'),
            private.jtext(v_item, 'entry', 7, '^(in|out|inout|out_by)$', false),
            private.jnum(v_item, 'volume', 0, 1e9), private.jnum(v_item, 'price', 0, 1e12),
            private.jnum(v_item, 'profit', -1e15, 1e15), private.jnum(v_item, 'commission', -1e15, 1e15),
            private.jnum(v_item, 'swap', -1e15, 1e15), private.jnum(v_item, 'fee', -1e15, 1e15),
            private.jts(v_item, 'executed_at'), v_observed)
    on conflict (connection_id, ticket) do nothing;
  end loop;
  update public.mt5_connections set last_deals_at = v_now where id = v_conn.id;
  return jsonb_build_object('accepted', true, 'status', 'verified');
end;
$$;

-- -----------------------------------------------------------------------------
-- Owner functions (browser, via RPC)
-- -----------------------------------------------------------------------------

create function private.owned_mt5_connection(p_connection_id uuid)
returns public.mt5_connections
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_owner_session();
  v public.mt5_connections;
begin
  select * into v from public.mt5_connections where id = p_connection_id and owner_user_id = v_user for update;
  if v.id is null then
    raise exception 'that MetaTrader 5 connection was not found' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Choose which symbols the connector streams quotes for (at most 8).
create function public.set_mt5_monitored_symbols(p_connection_id uuid, p_symbols text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.mt5_connections := private.owned_mt5_connection(p_connection_id);
  v_symbols text[] := coalesce(p_symbols, '{}');
begin
  if cardinality(v_symbols) > 8 then
    raise exception 'choose at most 8 symbols' using errcode = 'TPV01';
  end if;
  if exists (select 1 from unnest(v_symbols) s
             where not exists (select 1 from public.mt5_symbols m
                               where m.connection_id = v.id and m.name = s and m.available)) then
    raise exception 'one of the symbols is not offered by the connected terminal' using errcode = 'TPV01';
  end if;
  update public.mt5_symbols set monitored = (name = any (v_symbols))
   where connection_id = v.id and monitored is distinct from (name = any (v_symbols));
  delete from public.mt5_quotes where connection_id = v.id and not (symbol = any (v_symbols));
  perform private.write_audit(v.owner_user_id, 'connector.symbols_selected', 'connection', v.id::text,
                              jsonb_build_object('symbols', to_jsonb(v_symbols)));
  return private.mt5_connection_state(v);
end;
$$;

create function public.update_mt5_connection_settings(
  p_connection_id uuid,
  p_quote_interval_ms int,
  p_account_interval_s int,
  p_snapshot_interval_s int,
  p_history_days int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.mt5_connections := private.owned_mt5_connection(p_connection_id);
begin
  update public.mt5_connections
     set quote_interval_ms = p_quote_interval_ms, account_interval_s = p_account_interval_s,
         snapshot_interval_s = p_snapshot_interval_s, history_days = p_history_days
   where id = v.id returning * into v;
  return private.mt5_connection_state(v);
end;
$$;

-- Stops publication for this connection. The connector keeps running on the
-- PC (the website cannot stop a local process) but every publish is refused.
create function public.disconnect_mt5_connection(p_connection_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.mt5_connections := private.owned_mt5_connection(p_connection_id);
begin
  update public.mt5_connections
     set status = 'disconnected', status_reason = 'disconnected_by_owner', disconnected_at = clock_timestamp()
   where id = v.id returning * into v;
  perform private.write_audit(v.owner_user_id, 'connector.disconnected', 'connection', v.id::text, '{}'::jsonb);
  return private.mt5_connection_state(v);
end;
$$;

-- Resume after a disconnect or a block. The connector must verify again.
-- p_accept_new_account: forget the bound account (and its stored data) so a
-- different demo account can be verified.
create function public.resume_mt5_connection(p_connection_id uuid, p_accept_new_account boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.mt5_connections := private.owned_mt5_connection(p_connection_id);
begin
  if exists (select 1 from public.agents where id = v.agent_id and revoked_at is not null) then
    raise exception 'the connector''s agent was revoked; pair a new connector' using errcode = 'TPS01';
  end if;
  if coalesce(p_accept_new_account, false) then
    delete from public.mt5_account_state where connection_id = v.id;
    delete from public.mt5_account_snapshots where connection_id = v.id;
    delete from public.mt5_positions where connection_id = v.id;
    delete from public.mt5_orders where connection_id = v.id;
    delete from public.mt5_deals where connection_id = v.id;
    delete from public.mt5_quotes where connection_id = v.id;
    delete from public.mt5_bars where connection_id = v.id;
    update public.mt5_connections
       set account_fingerprint = null, masked_account = null, server = null, company = null, currency = null,
           currency_digits = null, leverage = null, first_verified_at = null, verified_at = null,
           last_snapshot_at = null, detected_trade_mode = null
     where id = v.id;
  end if;
  update public.mt5_connections
     set status = 'awaiting_verification', status_reason = null, disconnected_at = null
   where id = v.id returning * into v;
  perform private.write_audit(v.owner_user_id, 'connector.resumed', 'connection', v.id::text,
                              jsonb_build_object('new_account', coalesce(p_accept_new_account, false)));
  return private.mt5_connection_state(v);
end;
$$;

-- The owner revokes one of their agents from the website (no service-role key needed).
create function public.revoke_agent(p_agent_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_owner_session();
begin
  update public.agents set revoked_at = now()
   where id = p_agent_id and owner_user_id = v_user and revoked_at is null;
  if not found then
    raise exception 'no active agent with that id in your workspace' using errcode = 'P0002';
  end if;
  delete from private.agent_credentials where agent_id = p_agent_id;
  update public.mt5_connections
     set status = 'disconnected', status_reason = 'agent_revoked', disconnected_at = coalesce(disconnected_at, clock_timestamp())
   where agent_id = p_agent_id;
  perform private.write_audit(v_user, 'agent.revoked', 'agent', p_agent_id::text, '{}'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges, RLS, Realtime, retention
-- -----------------------------------------------------------------------------

revoke all on table public.mt5_connections, public.mt5_account_state, public.mt5_account_snapshots, public.mt5_symbols,
  public.mt5_quotes, public.mt5_bars, public.mt5_positions, public.mt5_orders, public.mt5_deals
  from anon, authenticated, service_role;
grant select on table public.mt5_connections, public.mt5_account_state, public.mt5_account_snapshots, public.mt5_symbols,
  public.mt5_quotes, public.mt5_bars, public.mt5_positions, public.mt5_orders, public.mt5_deals
  to authenticated, service_role;

revoke all on function
  private.jnum(jsonb, text, numeric, numeric, boolean), private.jtext(jsonb, text, int, text, boolean),
  private.jts(jsonb, text, boolean), private.json_has_credential_key(jsonb), private.guard_task_target(), private.touch_mt5_connection(),
  private.mt5_task_target(uuid, text, jsonb), private.authenticate_mt5_agent(bytea),
  private.mt5_connection_state(public.mt5_connections), private.set_mt5_status(public.mt5_connections, text, text),
  private.owned_mt5_connection(uuid)
  from public;

revoke all on function public.create_agent_pairing(text), public.set_mt5_monitored_symbols(uuid, text[]),
  public.update_mt5_connection_settings(uuid, int, int, int, int), public.disconnect_mt5_connection(uuid),
  public.resume_mt5_connection(uuid, boolean), public.revoke_agent(uuid)
  from public, anon;
grant execute on function public.create_agent_pairing(text), public.set_mt5_monitored_symbols(uuid, text[]),
  public.update_mt5_connection_settings(uuid, int, int, int, int), public.disconnect_mt5_connection(uuid),
  public.resume_mt5_connection(uuid, boolean), public.revoke_agent(uuid)
  to authenticated;

revoke all on function public.agent_pair(bytea, bytea, text, text), public.mt5_report_connection(bytea, jsonb),
  public.mt5_publish(bytea, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_pair(bytea, bytea, text, text), public.mt5_report_connection(bytea, jsonb),
  public.mt5_publish(bytea, uuid, text, text, jsonb)
  to service_role;

-- create or replace keeps earlier grants; restate the Phase 3 ones for clarity.
revoke all on function public.submit_task(text, jsonb, text) from public, anon;
grant execute on function public.submit_task(text, jsonb, text) to authenticated;
revoke all on function public.agent_claim(bytea), public.admin_register_agent(text, text[], bytea, int) from public, anon, authenticated;
grant execute on function public.agent_claim(bytea), public.admin_register_agent(text, text[], bytea, int) to service_role;

alter table public.mt5_connections enable row level security;
alter table public.mt5_account_state enable row level security;
alter table public.mt5_account_snapshots enable row level security;
alter table public.mt5_symbols enable row level security;
alter table public.mt5_quotes enable row level security;
alter table public.mt5_bars enable row level security;
alter table public.mt5_positions enable row level security;
alter table public.mt5_orders enable row level security;
alter table public.mt5_deals enable row level security;

create policy "Users read their own MT5 connections" on public.mt5_connections for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 account state" on public.mt5_account_state for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 account snapshots" on public.mt5_account_snapshots for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 symbols" on public.mt5_symbols for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 quotes" on public.mt5_quotes for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 bars" on public.mt5_bars for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 positions" on public.mt5_positions for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 orders" on public.mt5_orders for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));
create policy "Users read their own MT5 deals" on public.mt5_deals for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));

alter publication supabase_realtime add table public.mt5_connections, public.mt5_account_state, public.mt5_quotes,
  public.mt5_positions, public.mt5_orders;

-- Retention: equity snapshots older than 180 days; expired/used pairing codes after a day.
create function private.prune_mt5_history()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.mt5_account_snapshots where observed_at < now() - interval '180 days';
  delete from private.agent_pairings where expires_at < now() - interval '1 day';
$$;
revoke all on function private.prune_mt5_history() from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tradepilot-prune-mt5', '17 3 * * *', 'select private.prune_mt5_history()');
  end if;
exception when others then
  raise notice 'pg_cron schedule skipped (%)', sqlerrm;
end;
$$;
