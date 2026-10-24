-- Reverses 20261026090000_mt5_connector.sql. DESTROYS all MT5 connection data,
-- pairing codes and mt5.* tasks; restores the Phase 3 function versions.
-- Run manually as the postgres role.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'tradepilot-prune-mt5';
  end if;
end;
$$;

alter publication supabase_realtime drop table public.mt5_connections, public.mt5_account_state, public.mt5_quotes,
  public.mt5_positions, public.mt5_orders;

drop function if exists private.prune_mt5_history();
drop function if exists public.revoke_agent(uuid);
drop function if exists public.resume_mt5_connection(uuid, boolean);
drop function if exists public.disconnect_mt5_connection(uuid);
drop function if exists public.update_mt5_connection_settings(uuid, int, int, int, int);
drop function if exists public.set_mt5_monitored_symbols(uuid, text[]);
drop function if exists private.owned_mt5_connection(uuid);
drop function if exists public.mt5_publish(bytea, uuid, text, text, jsonb);
drop function if exists public.mt5_report_connection(bytea, jsonb);
drop function if exists private.set_mt5_status(public.mt5_connections, text, text);
drop function if exists private.mt5_connection_state(public.mt5_connections);
drop function if exists private.authenticate_mt5_agent(bytea);
drop function if exists public.agent_pair(bytea, bytea, text, text);
drop function if exists public.create_agent_pairing(text);

-- mt5.* tasks cannot outlive their task types.
alter table public.tasks disable trigger tasks_no_delete;
delete from public.tasks where task_type in ('mt5.terminal_status', 'mt5.account_snapshot', 'mt5.symbol_list', 'mt5.price_history',
  'mt5.positions_read', 'mt5.pending_orders_read', 'mt5.recent_history_read');
alter table public.tasks enable trigger tasks_no_delete;
delete from public.task_types where task_type in ('mt5.terminal_status', 'mt5.account_snapshot', 'mt5.symbol_list',
  'mt5.price_history', 'mt5.positions_read', 'mt5.pending_orders_read', 'mt5.recent_history_read');

drop trigger if exists tasks_target_guard on public.tasks;
drop function if exists private.guard_task_target();
drop function if exists private.mt5_task_target(uuid, text, jsonb);

drop table if exists public.mt5_deals, public.mt5_orders, public.mt5_positions, public.mt5_bars, public.mt5_quotes,
  public.mt5_symbols, public.mt5_account_snapshots, public.mt5_account_state, public.mt5_connections;
drop function if exists private.touch_mt5_connection();
drop function if exists private.jts(jsonb, text, boolean);
drop function if exists private.json_has_credential_key(jsonb);
drop function if exists private.jtext(jsonb, text, int, text, boolean);
drop function if exists private.jnum(jsonb, text, numeric, numeric, boolean);
drop table if exists private.agent_pairings;

-- Phase 3 function versions.
create or replace function private.is_valid_task_payload(p_type text, p_payload jsonb)
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

alter table public.tasks drop column if exists target_agent_id;
drop index if exists public.agents_owner_idx;
alter table public.agents drop column if exists owner_user_id;
