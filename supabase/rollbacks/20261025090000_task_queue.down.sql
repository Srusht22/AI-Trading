-- Reverses 20261025090000_task_queue.sql. DESTROYS all tasks, attempts and
-- agent registrations. Run manually as the postgres role.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'tradepilot-recover-tasks';
  end if;
end;
$$;

alter publication supabase_realtime drop table public.tasks, public.agents;

drop function if exists public.admin_recover_tasks();
drop function if exists public.admin_revoke_agent(uuid);
drop function if exists public.admin_register_agent(text, text[], bytea, int);
drop function if exists public.agent_ack_cancel(bytea, uuid, uuid);
drop function if exists public.agent_fail_task(bytea, uuid, uuid, text, text, boolean);
drop function if exists public.agent_complete_task(bytea, uuid, uuid, jsonb);
drop function if exists public.agent_renew_lease(bytea, uuid, uuid, int, text);
drop function if exists public.agent_start_task(bytea, uuid, uuid);
drop function if exists public.agent_claim(bytea);
drop function if exists public.agent_heartbeat(bytea, text, text[], text);
drop function if exists public.cancel_task(uuid);
drop function if exists public.submit_task(text, jsonb, text);

drop function if exists private.recover_tasks();
drop function if exists private.end_attempt(uuid, smallint, text, jsonb);
drop function if exists private.retry_delay(text, int);
drop function if exists private.lock_leased_task(uuid, uuid, uuid);
drop function if exists private.authenticate_agent(bytea);
drop function if exists private.require_owner_session();

drop table if exists public.task_attempts;
drop table if exists private.task_leases;
drop table if exists public.tasks;
drop table if exists private.agent_credentials;
drop table if exists public.agents;
drop table if exists public.task_types;

drop function if exists private.block_task_delete();
drop function if exists private.guard_task_update();
drop function if exists private.agent_is_online(timestamptz, timestamptz);
drop function if exists private.is_valid_task_payload(text, jsonb);
drop function if exists private.parse_version(text);
drop function if exists private.is_valid_task_error(jsonb);
drop function if exists private.is_safe_task_json(jsonb, int);
drop function if exists private.json_has_secret_like_key(jsonb, int);
