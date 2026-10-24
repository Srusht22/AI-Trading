-- =============================================================================
-- TradePilot AI — Phase 3: durable task queue and agent dispatch
--
-- A Postgres-backed queue. Nothing here runs trading work: the only task type
-- that can execute is `system.health_check`; the MT5 / strategy types are
-- registered so the contract is fixed, but are marked unavailable and are
-- rejected on submission and never offered to an agent.
--
-- Who can do what
--   * owner (authenticated, live session, is_owner):  submit_task(), cancel_task(),
--     read own tasks / attempts, read agents and task types.
--   * agents: never talk to the database directly. A server-side endpoint
--     (functions/api/agent/*) authenticates the agent's bearer token and calls
--     the agent_* functions below with the token's SHA-256 hash, using the
--     service-role key. Those functions are executable by service_role only.
--   * nobody (service_role included) can INSERT/UPDATE/DELETE the queue tables
--     directly; every change goes through a SECURITY DEFINER function, and a
--     trigger enforces the state machine even for those.
--
-- State machine (enforced by private.guard_task_update):
--   queued           -> claimed | cancelled | expired
--   claimed          -> running | queued (retry) | failed | cancel_requested | cancelled
--   running          -> succeeded | failed | queued (retry) | cancel_requested
--   cancel_requested -> cancelled | succeeded | failed
--   succeeded, failed, cancelled, expired: terminal
--
-- Rollback: supabase/rollbacks/20261025090000_task_queue.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Validation helpers
-- -----------------------------------------------------------------------------

-- Keys that look like credentials are refused anywhere in task JSON.
create function private.json_has_secret_like_key(j jsonb, depth int default 0)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if depth > 4 then
    return true; -- too deep counts as unsafe
  end if;
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      if k !~ '^[a-z][a-z0-9_]{0,39}$'
         or k ~* '(pass|secret|token|apikey|api_key|credential|authorization|cookie|session|jwt|private_key|login)' then
        return true;
      end if;
      if private.json_has_secret_like_key(v, depth + 1) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    if jsonb_array_length(j) > 50 then
      return true;
    end if;
    for v in select * from jsonb_array_elements(j) loop
      if private.json_has_secret_like_key(v, depth + 1) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

-- A small JSON object (payload or result) that cannot carry credentials.
create function private.is_safe_task_json(j jsonb, max_bytes int)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select j is not null
     and jsonb_typeof(j) = 'object'
     and pg_catalog.octet_length(j::text) <= max_bytes
     and not private.json_has_secret_like_key(j);
$$;

-- Structured error: {code, message, retryable}; nothing else.
create function private.is_valid_task_error(e jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(e) = 'object'
     and (select count(*) from jsonb_object_keys(e)) = 3
     and e ? 'code' and e ? 'message' and e ? 'retryable'
     and jsonb_typeof(e -> 'code') = 'string'
     and (e ->> 'code') ~ '^[a-z][a-z0-9_]{0,39}$'
     and jsonb_typeof(e -> 'message') = 'string'
     and char_length(e ->> 'message') between 1 and 300
     and jsonb_typeof(e -> 'retryable') = 'boolean';
$$;

-- 'major.minor.patch' -> int[] for comparisons; null when malformed.
create function private.parse_version(v text)
returns int[]
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'
              then string_to_array(v, '.')::int[] end;
$$;

-- -----------------------------------------------------------------------------
-- Task types (registry)
-- -----------------------------------------------------------------------------

create table public.task_types (
  task_type            text primary key check (task_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  label                text not null check (char_length(label) between 1 and 80),
  description          text not null check (char_length(description) between 1 and 300),
  available            boolean not null default false,
  unavailable_reason   text check (unavailable_reason is null or char_length(unavailable_reason) between 1 and 200),
  required_capability  text not null check (required_capability ~ '^[a-z][a-z0-9_.]{0,59}$'),
  min_agent_version    text not null default '0.1.0' check (private.parse_version(min_agent_version) is not null),
  max_attempts         smallint not null default 3 check (max_attempts between 1 and 10),
  lease_seconds        int not null default 60 check (lease_seconds between 10 and 3600),
  queue_ttl_seconds    int not null default 600 check (queue_ttl_seconds between 30 and 86400),
  retry_base_seconds   int not null default 5 check (retry_base_seconds between 1 and 600),
  max_payload_bytes    int not null default 1024 check (max_payload_bytes between 2 and 4096),
  check (available or unavailable_reason is not null)
);

comment on table public.task_types is
  'Registry of task types. Only types with available = true can be submitted or claimed.';

insert into public.task_types
  (task_type, label, description, available, unavailable_reason, required_capability,
   min_agent_version, max_attempts, lease_seconds, queue_ttl_seconds, retry_base_seconds, max_payload_bytes)
values
  ('system.health_check', 'Health check',
   'Asks a diagnostics agent to report its runtime, clock offset and connection latency. Touches no trading system.',
   true, null, 'system.health_check', '0.1.0', 3, 30, 600, 5, 256),
  ('mt5.compile_ea', 'Compile Expert Advisor',
   'Compile MQL5 source on a Windows MetaTrader 5 connector.',
   false, 'The MetaTrader 5 connector is not available yet.', 'mt5.compile', '1.0.0', 1, 300, 3600, 30, 4096),
  ('mt5.backtest', 'Run backtest',
   'Run a Strategy Tester backtest on a Windows MetaTrader 5 connector.',
   false, 'The MetaTrader 5 connector is not available yet.', 'mt5.backtest', '1.0.0', 1, 600, 3600, 30, 4096),
  ('mt5.collect_report', 'Collect backtest report',
   'Collect a Strategy Tester report from a Windows MetaTrader 5 connector.',
   false, 'The MetaTrader 5 connector is not available yet.', 'mt5.report', '1.0.0', 2, 120, 3600, 30, 4096),
  ('strategy.evaluate', 'Evaluate strategy',
   'Evaluate a strategy specification against stored backtest results.',
   false, 'Strategy evaluation is not available yet.', 'strategy.evaluate', '1.0.0', 1, 300, 3600, 30, 4096);

-- Per-type payload contracts. Unknown keys are rejected, so nothing
-- (credentials included) can ride along in a payload.
create function private.is_valid_task_payload(p_type text, p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;
  case p_type
    when 'system.health_check' then
      -- {} or {"note": "<= 80 printable characters"}
      return not exists (select 1 from jsonb_object_keys(p_payload) k where k <> 'note')
         and (not p_payload ? 'note'
              or (jsonb_typeof(p_payload -> 'note') = 'string'
                  and char_length(p_payload ->> 'note') between 1 and 80
                  and (p_payload ->> 'note') !~ '[[:cntrl:]]'));
    else
      -- Types without a contract cannot carry anything yet.
      return false;
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agents
-- -----------------------------------------------------------------------------

create table public.agents (
  id                     uuid primary key default gen_random_uuid(),
  display_name           text not null check (char_length(display_name) between 1 and 60 and display_name !~ '[[:cntrl:]]'),
  -- What the owner allowed this agent to do (set at registration).
  allowed_capabilities   text[] not null check (cardinality(allowed_capabilities) between 1 and 20),
  -- What the agent says it supports (heartbeat). Effective = intersection.
  reported_capabilities  text[] not null default '{}' check (cardinality(reported_capabilities) <= 20),
  agent_version          text check (agent_version is null or private.parse_version(agent_version) is not null),
  platform               text check (platform is null or (char_length(platform) <= 60 and platform !~ '[[:cntrl:]]')),
  max_concurrent_tasks   smallint not null default 1 check (max_concurrent_tasks between 1 and 8),
  last_heartbeat_at      timestamptz,
  created_at             timestamptz not null default clock_timestamp(),
  revoked_at             timestamptz
);

comment on table public.agents is
  'Registered worker agents. Credentials are kept in private.agent_credentials (hash only).';

-- Hash of the agent's bearer token. The raw token is shown once to the
-- person registering the agent and never stored.
create table private.agent_credentials (
  agent_id     uuid primary key references public.agents (id) on delete cascade,
  token_sha256 bytea not null unique check (octet_length(token_sha256) = 32),
  created_at   timestamptz not null default clock_timestamp()
);

create function private.agent_is_online(p_last_heartbeat timestamptz, p_revoked timestamptz)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select p_revoked is null and p_last_heartbeat is not null and p_last_heartbeat > clock_timestamp() - interval '45 seconds';
$$;

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  origin               text not null check (origin in ('user', 'system')),
  owner_user_id        uuid references auth.users (id) on delete cascade,
  task_type            text not null references public.task_types (task_type),
  payload              jsonb not null default '{}'::jsonb check (private.is_safe_task_json(payload, 4096)),
  idempotency_key      text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  status               text not null default 'queued'
                       check (status in ('queued', 'claimed', 'running', 'succeeded', 'failed',
                                         'cancel_requested', 'cancelled', 'expired')),
  created_at           timestamptz not null default clock_timestamp(),
  updated_at           timestamptz not null default clock_timestamp(),
  available_at         timestamptz not null default clock_timestamp(),
  expires_at           timestamptz not null,
  claimed_by_agent     uuid references public.agents (id) on delete set null,
  claimed_at           timestamptz,
  lease_expires_at     timestamptz,
  started_at           timestamptz,
  attempt_count        smallint not null default 0,
  max_attempts         smallint not null check (max_attempts between 1 and 10),
  progress_percent     smallint check (progress_percent between 0 and 100),
  progress_message     text check (progress_message is null
                                   or (char_length(progress_message) between 1 and 200 and progress_message !~ '[[:cntrl:]]')),
  result               jsonb check (result is null or private.is_safe_task_json(result, 4096)),
  error                jsonb check (error is null or private.is_valid_task_error(error)),
  cancel_requested_at  timestamptz,
  completed_at         timestamptz,
  revision             int not null default 1,

  check ((origin = 'user') = (owner_user_id is not null)),
  check (attempt_count between 0 and max_attempts),
  check (expires_at > created_at),
  -- A lease exists exactly while an agent holds the task.
  check ((status in ('claimed', 'running', 'cancel_requested'))
         = (claimed_by_agent is not null and claimed_at is not null and lease_expires_at is not null)),
  check (status not in ('running') or started_at is not null),
  check (status <> 'cancel_requested' or cancel_requested_at is not null),
  -- Terminal states carry a completion time; non-terminal ones do not.
  check ((status in ('succeeded', 'failed', 'cancelled', 'expired')) = (completed_at is not null)),
  check (status <> 'succeeded' or (result is not null and error is null)),
  check (status <> 'failed' or error is not null),
  check (status <> 'queued' or (result is null and progress_percent is null))
);

create unique index tasks_idempotency_idx on public.tasks (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), idempotency_key);
create index tasks_owner_created_idx on public.tasks (owner_user_id, created_at desc, id desc);
create index tasks_claimable_idx on public.tasks (available_at, created_at) where status = 'queued';
create index tasks_leased_idx on public.tasks (lease_expires_at) where status in ('claimed', 'running', 'cancel_requested');
create index tasks_agent_idx on public.tasks (claimed_by_agent) where status in ('claimed', 'running', 'cancel_requested');

comment on table public.tasks is
  'Durable task queue. Written only through submit_task/cancel_task and the service-role agent_* functions.';

-- Lease tokens live outside the API-visible table (and outside Realtime
-- payloads). A stale worker holding an old token cannot touch a re-leased task.
create table private.task_leases (
  task_id      uuid primary key references public.tasks (id) on delete cascade,
  agent_id     uuid not null references public.agents (id) on delete cascade,
  lease_token  uuid not null unique,
  attempt      smallint not null
);

create table public.task_attempts (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks (id) on delete cascade,
  attempt_number  smallint not null check (attempt_number between 1 and 10),
  agent_id        uuid references public.agents (id) on delete set null,
  claimed_at      timestamptz not null,
  started_at      timestamptz,
  ended_at        timestamptz,
  outcome         text check (outcome in ('succeeded', 'failed', 'retry_scheduled', 'lease_expired', 'cancelled')),
  error           jsonb check (error is null or private.is_valid_task_error(error)),
  unique (task_id, attempt_number),
  check ((outcome is null) = (ended_at is null))
);

create index task_attempts_task_idx on public.task_attempts (task_id, attempt_number);

-- -----------------------------------------------------------------------------
-- State-machine guard (applies to every role, including the function owner)
-- -----------------------------------------------------------------------------

create function private.guard_task_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed boolean;
begin
  if new.id <> old.id or new.origin <> old.origin
     or new.owner_user_id is distinct from old.owner_user_id
     or new.task_type <> old.task_type or new.payload <> old.payload
     or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at
     or new.max_attempts <> old.max_attempts or new.expires_at <> old.expires_at then
    raise exception 'task identity, payload and limits are immutable' using errcode = '42501';
  end if;

  if new.attempt_count < old.attempt_count then
    raise exception 'attempt count cannot decrease' using errcode = '23514';
  end if;

  if new.status <> old.status then
    allowed := case old.status
      when 'queued'           then new.status in ('claimed', 'cancelled', 'expired')
      when 'claimed'          then new.status in ('running', 'queued', 'failed', 'cancel_requested', 'cancelled')
      when 'running'          then new.status in ('succeeded', 'failed', 'queued', 'cancel_requested')
      when 'cancel_requested' then new.status in ('cancelled', 'succeeded', 'failed')
      else false
    end;
    if not allowed then
      raise exception 'invalid task transition % -> %', old.status, new.status using errcode = 'TPS01';
    end if;
    if new.status = 'claimed' and new.attempt_count <> old.attempt_count + 1 then
      raise exception 'a claim must start a new attempt' using errcode = '23514';
    end if;
  elsif old.status in ('succeeded', 'failed', 'cancelled', 'expired') then
    raise exception 'finished tasks cannot change' using errcode = 'TPS01';
  end if;

  new.updated_at := clock_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;

create trigger tasks_guard
  before update on public.tasks
  for each row execute function private.guard_task_update();

create function private.block_task_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Rows disappear only through the owning user's account deletion (FK cascade).
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'tasks cannot be deleted' using errcode = '42501';
end;
$$;

create trigger tasks_no_delete
  before delete on public.tasks
  for each row execute function private.block_task_delete();

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------

-- Resolves an agent from a token hash; raises TPA01 for unknown or revoked agents.
create function private.authenticate_agent(p_token_sha256 bytea)
returns public.agents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent public.agents;
begin
  select a.* into v_agent
  from private.agent_credentials c
  join public.agents a on a.id = c.agent_id
  where c.token_sha256 = p_token_sha256;
  if v_agent.id is null or v_agent.revoked_at is not null then
    raise exception 'agent not recognised' using errcode = 'TPA01';
  end if;
  return v_agent;
end;
$$;

-- Validates that the agent still holds the lease it presents. Raises TPL01
-- ("lease lost") otherwise: expired, re-leased to another worker, or finished.
create function private.lock_leased_task(p_agent uuid, p_task_id uuid, p_lease_token uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select t.* into v_task from public.tasks t where t.id = p_task_id for update;
  if v_task.id is null
     or not exists (select 1 from private.task_leases l
                    where l.task_id = p_task_id and l.agent_id = p_agent and l.lease_token = p_lease_token)
     or v_task.status not in ('claimed', 'running', 'cancel_requested')
     or v_task.lease_expires_at <= clock_timestamp() then
    raise exception 'lease lost' using errcode = 'TPL01';
  end if;
  return v_task;
end;
$$;

create function private.retry_delay(p_type text, p_attempt int)
returns interval
language sql
stable
set search_path = ''
as $$
  select make_interval(secs => least(300, tt.retry_base_seconds * power(2, greatest(p_attempt - 1, 0))))
  from public.task_types tt where tt.task_type = p_type;
$$;

create function private.end_attempt(p_task uuid, p_attempt smallint, p_outcome text, p_error jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.task_attempts
     set ended_at = clock_timestamp(), outcome = p_outcome, error = p_error
   where task_id = p_task and attempt_number = p_attempt and ended_at is null;
$$;

-- Releases leases that ran out and expires queued tasks past their deadline.
-- Safe to call concurrently (SKIP LOCKED); called by pg_cron when available
-- and lazily on every agent claim, so correctness never depends on the cron.
create function private.recover_tasks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_requeued int := 0;
  v_failed int := 0;
  v_cancelled int := 0;
  v_expired int := 0;
  v_error jsonb := jsonb_build_object('code', 'lease_expired',
                                      'message', 'The agent stopped reporting progress before finishing.',
                                      'retryable', true);
begin
  for v_task in
    select t.* from public.tasks t
    where t.status in ('claimed', 'running', 'cancel_requested') and t.lease_expires_at <= clock_timestamp()
    for update skip locked
  loop
    perform private.end_attempt(v_task.id, v_task.attempt_count, 'lease_expired', v_error);
    delete from private.task_leases where task_id = v_task.id;
    if v_task.status = 'cancel_requested' then
      update public.tasks set status = 'cancelled', completed_at = clock_timestamp(),
             claimed_by_agent = null, claimed_at = null, lease_expires_at = null
       where id = v_task.id;
      v_cancelled := v_cancelled + 1;
    elsif v_task.attempt_count < v_task.max_attempts and v_task.expires_at > clock_timestamp() then
      update public.tasks set status = 'queued',
             available_at = clock_timestamp() + private.retry_delay(v_task.task_type, v_task.attempt_count),
             claimed_by_agent = null, claimed_at = null, lease_expires_at = null, started_at = null,
             progress_percent = null, progress_message = null, error = v_error
       where id = v_task.id;
      v_requeued := v_requeued + 1;
    else
      update public.tasks set status = 'failed', completed_at = clock_timestamp(),
             claimed_by_agent = null, claimed_at = null, lease_expires_at = null,
             error = jsonb_set(v_error, '{retryable}', 'false')
       where id = v_task.id;
      v_failed := v_failed + 1;
    end if;
  end loop;

  with expired as (
    update public.tasks set status = 'expired', completed_at = clock_timestamp(),
           error = jsonb_build_object('code', 'queue_timeout',
                                      'message', 'No agent picked up this task before its deadline.',
                                      'retryable', false)
     where id in (select id from public.tasks
                  where status = 'queued' and expires_at <= clock_timestamp()
                  for update skip locked)
    returning 1
  )
  select count(*) into v_expired from expired;

  return jsonb_build_object('requeued', v_requeued, 'failed', v_failed,
                            'cancelled', v_cancelled, 'expired', v_expired);
end;
$$;

-- -----------------------------------------------------------------------------
-- Owner-facing functions (browser, via PostgREST RPC)
-- -----------------------------------------------------------------------------

create function private.require_owner_session()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_active_session() then
    raise exception 'session is no longer active' using errcode = '28000';
  end if;
  if not public.is_owner() then
    raise exception 'only the workspace owner can run tasks' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Submit a task. Idempotent per (owner, idempotency key): repeating the call
-- with the same key returns the original task instead of creating another.
create function public.submit_task(p_task_type text, p_payload jsonb, p_idempotency_key text)
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
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'idempotency key must be 8-64 letters, digits, dashes or underscores' using errcode = 'TPV01';
  end if;

  -- Replay: same key returns the existing task (or a conflict if it differs).
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

  -- Serialise this owner's submissions so the limits below cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('tp.submit:' || v_user::text, 0));

  -- Re-check the key under the lock (a concurrent duplicate may have won).
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
      and v_type.required_capability = any (a.allowed_capabilities)
      and v_type.required_capability = any (a.reported_capabilities)
      and private.parse_version(a.agent_version) >= private.parse_version(v_type.min_agent_version)
  ) then
    raise exception 'no online agent can run this task right now' using errcode = 'TPU02';
  end if;

  insert into public.tasks (origin, owner_user_id, task_type, payload, idempotency_key,
                            expires_at, max_attempts)
  values ('user', v_user, p_task_type, v_payload, p_idempotency_key,
          clock_timestamp() + make_interval(secs => v_type.queue_ttl_seconds), v_type.max_attempts)
  returning * into v_task;

  perform private.write_audit(v_user, 'task.submitted', 'task', v_task.id::text,
                              jsonb_build_object('task_type', p_task_type));
  return v_task;
end;
$$;

-- Cancel a task: queued tasks are cancelled immediately; tasks an agent holds
-- are marked cancel_requested and the agent is told at its next heartbeat.
create function public.cancel_task(p_task_id uuid)
returns public.tasks
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.require_owner_session();
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id and owner_user_id = v_user for update;
  if v_task.id is null then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if v_task.status = 'queued' then
    update public.tasks set status = 'cancelled', cancel_requested_at = clock_timestamp(),
           completed_at = clock_timestamp()
     where id = p_task_id returning * into v_task;
  elsif v_task.status in ('claimed', 'running') then
    update public.tasks set status = 'cancel_requested', cancel_requested_at = clock_timestamp()
     where id = p_task_id returning * into v_task;
  elsif v_task.status = 'cancel_requested' then
    return v_task; -- already requested; repeating is harmless
  else
    raise exception 'this task has already finished' using errcode = 'TPS01';
  end if;

  perform private.write_audit(v_user, 'task.cancel_requested', 'task', v_task.id::text,
                              jsonb_build_object('task_type', v_task.task_type, 'status', v_task.status));
  return v_task;
end;
$$;

-- -----------------------------------------------------------------------------
-- Agent protocol (service_role only; called by the server-side agent API)
-- -----------------------------------------------------------------------------

create function public.agent_heartbeat(
  p_token_sha256 bytea,
  p_agent_version text,
  p_capabilities text[],
  p_platform text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
begin
  if private.parse_version(p_agent_version) is null then
    raise exception 'agent version must look like 1.2.3' using errcode = 'TPV01';
  end if;
  if p_capabilities is null or cardinality(p_capabilities) > 20
     or exists (select 1 from unnest(p_capabilities) c where c !~ '^[a-z][a-z0-9_.]{0,59}$') then
    raise exception 'capabilities are not valid' using errcode = 'TPV01';
  end if;
  if p_platform is not null and (char_length(p_platform) > 60 or p_platform ~ '[[:cntrl:]]') then
    raise exception 'platform is not valid' using errcode = 'TPV01';
  end if;

  update public.agents
     set last_heartbeat_at = clock_timestamp(), agent_version = p_agent_version,
         reported_capabilities = p_capabilities, platform = p_platform
   where id = v_agent.id;

  return jsonb_build_object(
    'agent_id', v_agent.id,
    'effective_capabilities',
      (select coalesce(jsonb_agg(c order by c), '[]'::jsonb)
         from unnest(p_capabilities) c where c = any (v_agent.allowed_capabilities)),
    'server_time', clock_timestamp()
  );
end;
$$;

-- Claim at most one task the agent is allowed and able to run.
-- Concurrent claims never receive the same task (FOR UPDATE SKIP LOCKED).
create function public.agent_claim(p_token_sha256 bytea)
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

create function public.agent_start_task(p_token_sha256 bytea, p_task_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
  v_task public.tasks := private.lock_leased_task(v_agent.id, p_task_id, p_lease_token);
begin
  if v_task.status = 'claimed' then
    update public.tasks set status = 'running', started_at = clock_timestamp()
     where id = p_task_id returning * into v_task;
    update public.task_attempts set started_at = v_task.started_at
     where task_id = p_task_id and attempt_number = v_task.attempt_count;
  end if;
  return jsonb_build_object('status', v_task.status, 'cancel_requested', v_task.status = 'cancel_requested');
end;
$$;

-- Extends the lease and records real progress. Tells the agent whether the
-- owner asked to cancel.
create function public.agent_renew_lease(
  p_token_sha256 bytea,
  p_task_id uuid,
  p_lease_token uuid,
  p_progress_percent int default null,
  p_progress_message text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
  v_task public.tasks := private.lock_leased_task(v_agent.id, p_task_id, p_lease_token);
  v_lease_seconds int;
begin
  if p_progress_percent is not null and (p_progress_percent < 0 or p_progress_percent > 100) then
    raise exception 'progress must be between 0 and 100' using errcode = 'TPV01';
  end if;
  if p_progress_percent is not null and v_task.progress_percent is not null
     and p_progress_percent < v_task.progress_percent then
    raise exception 'progress cannot go backwards' using errcode = 'TPV01';
  end if;
  if p_progress_message is not null
     and (char_length(p_progress_message) not between 1 and 200 or p_progress_message ~ '[[:cntrl:]]') then
    raise exception 'progress message is not valid' using errcode = 'TPV01';
  end if;
  if v_task.status = 'claimed' and p_progress_percent is not null then
    raise exception 'start the task before reporting progress' using errcode = 'TPS01';
  end if;

  select lease_seconds into v_lease_seconds from public.task_types where task_type = v_task.task_type;

  update public.tasks
     set lease_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
         progress_percent = coalesce(p_progress_percent, progress_percent),
         progress_message = coalesce(p_progress_message, progress_message)
   where id = p_task_id
  returning * into v_task;

  update public.agents set last_heartbeat_at = clock_timestamp() where id = v_agent.id;

  return jsonb_build_object('lease_expires_at', v_task.lease_expires_at,
                            'cancel_requested', v_task.status = 'cancel_requested');
end;
$$;

create function public.agent_complete_task(
  p_token_sha256 bytea,
  p_task_id uuid,
  p_lease_token uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
  v_task public.tasks := private.lock_leased_task(v_agent.id, p_task_id, p_lease_token);
begin
  if v_task.status = 'claimed' then
    raise exception 'start the task before completing it' using errcode = 'TPS01';
  end if;
  if not private.is_safe_task_json(p_result, 4096) then
    raise exception 'result must be a small JSON object without credential-like fields' using errcode = 'TPV01';
  end if;

  update public.tasks
     set status = 'succeeded', result = p_result, error = null, completed_at = clock_timestamp(),
         progress_percent = case when progress_percent is null then null else 100 end,
         claimed_by_agent = null, claimed_at = null, lease_expires_at = null
   where id = p_task_id
  returning * into v_task;

  delete from private.task_leases where task_id = p_task_id;
  perform private.end_attempt(p_task_id, v_task.attempt_count, 'succeeded', null);
  if v_task.owner_user_id is not null then
    perform private.write_audit(null, 'task.succeeded', 'task', v_task.id::text,
                                jsonb_build_object('task_type', v_task.task_type, 'attempt', v_task.attempt_count));
  end if;
  return jsonb_build_object('status', v_task.status);
end;
$$;

-- Reports a failure. Retryable failures are re-queued with exponential
-- backoff until max_attempts; others (or the last attempt) fail the task.
create function public.agent_fail_task(
  p_token_sha256 bytea,
  p_task_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
  v_task public.tasks := private.lock_leased_task(v_agent.id, p_task_id, p_lease_token);
  v_error jsonb := jsonb_build_object('code', p_error_code, 'message', p_error_message,
                                      'retryable', coalesce(p_retryable, false));
  v_retry boolean;
begin
  if not private.is_valid_task_error(v_error) then
    raise exception 'error must have a short code and message' using errcode = 'TPV01';
  end if;

  v_retry := coalesce(p_retryable, false)
             and v_task.status <> 'cancel_requested'
             and v_task.attempt_count < v_task.max_attempts
             and v_task.expires_at > clock_timestamp();

  delete from private.task_leases where task_id = p_task_id;
  perform private.end_attempt(p_task_id, v_task.attempt_count,
                              case when v_retry then 'retry_scheduled' else 'failed' end, v_error);

  if v_retry then
    update public.tasks
       set status = 'queued', error = v_error,
           available_at = clock_timestamp() + private.retry_delay(v_task.task_type, v_task.attempt_count),
           claimed_by_agent = null, claimed_at = null, lease_expires_at = null, started_at = null,
           progress_percent = null, progress_message = null
     where id = p_task_id
    returning * into v_task;
  else
    update public.tasks
       set status = 'failed', error = jsonb_set(v_error, '{retryable}', 'false'), completed_at = clock_timestamp(),
           claimed_by_agent = null, claimed_at = null, lease_expires_at = null
     where id = p_task_id
    returning * into v_task;
    if v_task.owner_user_id is not null then
      perform private.write_audit(null, 'task.failed', 'task', v_task.id::text,
                                  jsonb_build_object('task_type', v_task.task_type, 'error_code', p_error_code));
    end if;
  end if;

  return jsonb_build_object('status', v_task.status, 'retry_at',
                            case when v_retry then v_task.available_at end);
end;
$$;

-- The agent confirms it stopped work after a cancel request.
create function public.agent_ack_cancel(p_token_sha256 bytea, p_task_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_agent public.agents := private.authenticate_agent(p_token_sha256);
  v_task public.tasks := private.lock_leased_task(v_agent.id, p_task_id, p_lease_token);
begin
  if v_task.status <> 'cancel_requested' then
    raise exception 'cancellation was not requested' using errcode = 'TPS01';
  end if;
  update public.tasks
     set status = 'cancelled', completed_at = clock_timestamp(),
         claimed_by_agent = null, claimed_at = null, lease_expires_at = null
   where id = p_task_id
  returning * into v_task;
  delete from private.task_leases where task_id = p_task_id;
  perform private.end_attempt(p_task_id, v_task.attempt_count, 'cancelled', null);
  return jsonb_build_object('status', v_task.status);
end;
$$;

-- -----------------------------------------------------------------------------
-- Trusted administration (service_role only; run from scripts/)
-- -----------------------------------------------------------------------------

create function public.admin_register_agent(
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
begin
  if exists (select 1 from unnest(p_capabilities) c where c !~ '^[a-z][a-z0-9_.]{0,59}$') then
    raise exception 'capabilities are not valid' using errcode = 'TPV01';
  end if;
  insert into public.agents (display_name, allowed_capabilities, max_concurrent_tasks)
  values (btrim(p_display_name), p_capabilities, p_max_concurrent_tasks)
  returning id into v_id;
  insert into private.agent_credentials (agent_id, token_sha256) values (v_id, p_token_sha256);
  perform private.write_audit(null, 'agent.registered', 'agent', v_id::text,
                              jsonb_build_object('capabilities', to_jsonb(p_capabilities)));
  return v_id;
end;
$$;

-- Revoking an agent drops its credentials; leases it held run out and are
-- recovered like any other lost worker.
create function public.admin_revoke_agent(p_agent_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.agents set revoked_at = clock_timestamp() where id = p_agent_id and revoked_at is null;
  if not found then
    raise exception 'no active agent with that id' using errcode = 'P0002';
  end if;
  delete from private.agent_credentials where agent_id = p_agent_id;
  perform private.write_audit(null, 'agent.revoked', 'agent', p_agent_id::text, '{}'::jsonb);
end;
$$;

create function public.admin_recover_tasks()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.recover_tasks();
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------

revoke all on table public.task_types, public.agents, public.tasks, public.task_attempts
  from anon, authenticated, service_role;
revoke all on table private.agent_credentials, private.task_leases from public, anon, authenticated, service_role;

grant select on table public.task_types, public.agents, public.tasks, public.task_attempts to authenticated;
-- service_role reads for tooling; writes only through the functions above.
grant select on table public.task_types, public.agents, public.tasks, public.task_attempts to service_role;

revoke all on function
  private.json_has_secret_like_key(jsonb, int), private.is_safe_task_json(jsonb, int),
  private.is_valid_task_error(jsonb), private.parse_version(text), private.is_valid_task_payload(text, jsonb),
  private.agent_is_online(timestamptz, timestamptz), private.guard_task_update(), private.block_task_delete(),
  private.authenticate_agent(bytea), private.lock_leased_task(uuid, uuid, uuid), private.retry_delay(text, int),
  private.end_attempt(uuid, smallint, text, jsonb), private.recover_tasks(), private.require_owner_session()
  from public;

-- CHECK constraints evaluate as the writing role (the definer functions run
-- as postgres, but grant these for completeness of constraint evaluation).
grant execute on function
  private.json_has_secret_like_key(jsonb, int), private.is_safe_task_json(jsonb, int),
  private.is_valid_task_error(jsonb), private.parse_version(text)
  to authenticated, service_role;

revoke all on function public.submit_task(text, jsonb, text), public.cancel_task(uuid) from public, anon;
grant execute on function public.submit_task(text, jsonb, text), public.cancel_task(uuid) to authenticated;

revoke all on function
  public.agent_heartbeat(bytea, text, text[], text), public.agent_claim(bytea),
  public.agent_start_task(bytea, uuid, uuid), public.agent_renew_lease(bytea, uuid, uuid, int, text),
  public.agent_complete_task(bytea, uuid, uuid, jsonb), public.agent_fail_task(bytea, uuid, uuid, text, text, boolean),
  public.agent_ack_cancel(bytea, uuid, uuid),
  public.admin_register_agent(text, text[], bytea, int), public.admin_revoke_agent(uuid), public.admin_recover_tasks()
  from public, anon, authenticated;
grant execute on function
  public.agent_heartbeat(bytea, text, text[], text), public.agent_claim(bytea),
  public.agent_start_task(bytea, uuid, uuid), public.agent_renew_lease(bytea, uuid, uuid, int, text),
  public.agent_complete_task(bytea, uuid, uuid, jsonb), public.agent_fail_task(bytea, uuid, uuid, text, text, boolean),
  public.agent_ack_cancel(bytea, uuid, uuid),
  public.admin_register_agent(text, text[], bytea, int), public.admin_revoke_agent(uuid), public.admin_recover_tasks()
  to service_role;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

alter table public.task_types enable row level security;
alter table public.agents enable row level security;
alter table public.tasks enable row level security;
alter table public.task_attempts enable row level security;
alter table private.agent_credentials enable row level security;  -- no policies
alter table private.task_leases enable row level security;        -- no policies

create policy "Signed-in users read task types"
  on public.task_types for select to authenticated
  using ((select public.has_active_session()));

create policy "Owner reads agents"
  on public.agents for select to authenticated
  using ((select public.is_owner()));

create policy "Users read their own tasks"
  on public.tasks for select to authenticated
  using (owner_user_id = (select auth.uid()) and (select public.has_active_session()));

create policy "Users read attempts of their own tasks"
  on public.task_attempts for select to authenticated
  using ((select public.has_active_session())
         and exists (select 1 from public.tasks t
                     where t.id = task_attempts.task_id and t.owner_user_id = (select auth.uid())));

-- -----------------------------------------------------------------------------
-- Realtime: task and agent changes reach the owner's browser (RLS applies).
-- Lease tokens and credentials are in private tables and never published.
-- -----------------------------------------------------------------------------

alter publication supabase_realtime add table public.tasks, public.agents;

-- -----------------------------------------------------------------------------
-- Scheduled recovery (pg_cron, available on Supabase incl. the free plan).
-- Optional: agent_claim() also recovers, so the queue stays correct without it.
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('tradepilot-recover-tasks', '* * * * *', 'select private.recover_tasks()');
  end if;
exception when others then
  raise notice 'pg_cron not enabled (%); relying on recovery during agent claims', sqlerrm;
end;
$$;
