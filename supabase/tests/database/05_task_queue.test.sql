begin;
\ir _helpers.inc
select plan(82);

-- Fixtures --------------------------------------------------------------------
delete from private.app_owner;
select pg_temp.create_user('queue-owner@example.test') as owner \gset
select pg_temp.create_user('queue-other@example.test') as other \gset
insert into private.app_owner (singleton, user_id) values (true, :'owner');

create function pg_temp.h(p_token text) returns bytea language sql as $$
  select extensions.digest(p_token, 'sha256');
$$;

-- Registers an agent the way scripts/register-agent.mjs does and sends a heartbeat.
create function pg_temp.make_agent(p_name text, p_token text, p_version text default '0.1.0',
                                   p_max int default 1) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.act_as_service();
  v := public.admin_register_agent(p_name, array['system.health_check'], pg_temp.h(p_token), p_max);
  perform public.agent_heartbeat(pg_temp.h(p_token), p_version, array['system.health_check'], 'test');
  perform pg_temp.reset_role();
  return v;
end $$;

-- Structure -------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_attempts'::regclass), 'task_attempts has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.agents'::regclass), 'agents has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.task_types'::regclass), 'task_types has RLS');
select ok(not has_table_privilege('authenticated', 'public.tasks', 'INSERT,UPDATE,DELETE'), 'authenticated cannot write tasks directly');
select ok(not has_table_privilege('service_role', 'public.tasks', 'INSERT,UPDATE,DELETE'), 'service_role cannot write tasks directly');
select ok(not has_table_privilege('anon', 'public.tasks', 'SELECT'), 'anon cannot read tasks');
select ok(not has_table_privilege('service_role', 'private.agent_credentials', 'SELECT'), 'service_role cannot read agent credentials');
select ok(not has_table_privilege('authenticated', 'private.task_leases', 'SELECT'), 'lease tokens are not readable by users');
select ok(not has_function_privilege('authenticated', 'public.agent_claim(bytea)', 'EXECUTE'), 'users cannot claim work');
select ok(not has_function_privilege('anon', 'public.agent_claim(bytea)', 'EXECUTE'), 'anonymous callers cannot claim work');
select ok(not has_function_privilege('authenticated', 'public.admin_register_agent(text,text[],bytea,int)', 'EXECUTE'), 'users cannot register agents');
select ok(not has_function_privilege('anon', 'public.submit_task(text,jsonb,text)', 'EXECUTE'), 'anonymous callers cannot submit');
select is((select array_agg(task_type order by task_type) from public.task_types where not available),
          array['mt5.backtest', 'mt5.collect_report', 'mt5.compile_ea', 'strategy.evaluate'],
          'MT5 and strategy task types are registered but unavailable');
select ok((select available from public.task_types where task_type = 'system.health_check'), 'health check is available');

-- Submission rules --------------------------------------------------------------
select pg_temp.act_as(:'other');
select throws_ok($$ select public.submit_task('system.health_check', '{}', 'key-other-001') $$,
                 '42501', null, 'a non-owner cannot submit tasks');

select pg_temp.act_as(:'owner');
select throws_ok($$ select public.submit_task('system.health_check', '{}', 'key-noagent-1') $$,
                 'TPU02', null, 'submission is refused while no eligible agent is online');
select throws_ok($$ select public.submit_task('mt5.backtest', '{}', 'key-mt5-00001') $$,
                 'TPU01', 'The MetaTrader 5 connector is not available yet.', 'unavailable task types are refused with their reason');
select pg_temp.reset_role();

select pg_temp.make_agent('Diagnostics A', 'tok-agent-a') as agent_a \gset
select pg_temp.make_agent('Diagnostics B', 'tok-agent-b') as agent_b \gset

select pg_temp.act_as(:'owner');
select throws_ok($$ select public.submit_task('system.health_check', '{"password":"x"}', 'key-bad-00001') $$,
                 'TPV01', null, 'unknown/credential-like payload fields are refused');
select throws_ok($$ select public.submit_task('system.health_check', '{"note":"x"}', 'bad key!') $$,
                 'TPV01', null, 'malformed idempotency keys are refused');
select throws_ok($$ select public.submit_task('system.nope', '{}', 'key-unknown-1') $$,
                 'TPV01', null, 'unknown task types are refused');
select throws_ok($$ select public.submit_task('system.health_check', jsonb_build_object('note', repeat('x', 81)), 'key-long-0001') $$,
                 'TPV01', null, 'oversized payload values are refused');

select (public.submit_task('system.health_check', '{"note":"first"}', 'key-task-0001')).id as t1 \gset
select is((select status from public.tasks where id = :'t1'), 'queued', 'a submitted task is queued');
select is((public.submit_task('system.health_check', '{"note":"first"}', 'key-task-0001')).id, :'t1'::uuid,
          'repeating a submission with the same idempotency key returns the same task');
select is((select count(*)::int from public.tasks where idempotency_key = 'key-task-0001'), 1, 'and creates no duplicate');
select throws_ok($$ select public.submit_task('system.health_check', '{"note":"changed"}', 'key-task-0001') $$,
                 'TPI01', null, 'reusing a key for a different request is a conflict');
select is((select count(*)::int from public.audit_events where event_type = 'task.submitted' and resource_id = :'t1'), 1,
          'submission is audited once');
select pg_temp.reset_role();

-- Claiming ----------------------------------------------------------------------
select pg_temp.act_as_service();
select throws_ok($$ select public.agent_claim(pg_temp.h('wrong-token')) $$, 'TPA01', null, 'unknown agent tokens are rejected');
select public.agent_claim(pg_temp.h('tok-agent-a')) as claim1 \gset
select is((:'claim1'::jsonb ->> 'task_id')::uuid, :'t1'::uuid, 'agent A claims the queued task');
select ok((:'claim1'::jsonb ->> 'lease_token') is not null, 'the claim carries a lease token');
select is(public.agent_claim(pg_temp.h('tok-agent-b')), null, 'agent B gets nothing: a task is claimed once');
select is(public.agent_claim(pg_temp.h('tok-agent-a')), null, 'agent A is at its concurrency limit');
select pg_temp.reset_role();
select is((select status from public.tasks where id = :'t1'), 'claimed', 'the task is claimed');
select is((select attempt_count::int from public.tasks where id = :'t1'), 1, 'attempt 1 started');
select is((select claimed_by_agent from public.tasks where id = :'t1'), :'agent_a'::uuid, 'claim records the agent');

select pg_temp.act_as_service();
select throws_ok(format($$ select public.agent_start_task(pg_temp.h('tok-agent-b'), %L, %L) $$,
                        :'t1', :'claim1'::jsonb ->> 'lease_token'),
                 'TPL01', null, 'another agent cannot use the lease');
select throws_ok(format($$ select public.agent_start_task(pg_temp.h('tok-agent-a'), %L, gen_random_uuid()) $$, :'t1'),
                 'TPL01', null, 'a wrong lease token is rejected');
select is(public.agent_start_task(pg_temp.h('tok-agent-a'), :'t1', (:'claim1'::jsonb ->> 'lease_token')::uuid) ->> 'status',
          'running', 'the lease holder starts the task');
select is((public.agent_renew_lease(pg_temp.h('tok-agent-a'), :'t1', (:'claim1'::jsonb ->> 'lease_token')::uuid, 50, 'Measuring')
           ->> 'cancel_requested')::boolean, false, 'renewing reports no cancellation');
select throws_ok(format($$ select public.agent_renew_lease(pg_temp.h('tok-agent-a'), %L, %L, 20, null) $$,
                        :'t1', :'claim1'::jsonb ->> 'lease_token'),
                 'TPV01', null, 'progress cannot go backwards');
select throws_ok(format($$ select public.agent_complete_task(pg_temp.h('tok-agent-a'), %L, %L, '{"api_token":"x"}') $$,
                        :'t1', :'claim1'::jsonb ->> 'lease_token'),
                 'TPV01', null, 'results with credential-like fields are refused');
select is(public.agent_complete_task(pg_temp.h('tok-agent-a'), :'t1', (:'claim1'::jsonb ->> 'lease_token')::uuid,
                                     '{"ok":true,"checks":[{"name":"clock","ok":true}]}') ->> 'status',
          'succeeded', 'the lease holder completes the task');
select throws_ok(format($$ select public.agent_complete_task(pg_temp.h('tok-agent-a'), %L, %L, '{"ok":true}') $$,
                        :'t1', :'claim1'::jsonb ->> 'lease_token'),
                 'TPL01', null, 'a finished task cannot be completed twice');
select pg_temp.reset_role();
select is((select progress_percent::int from public.tasks where id = :'t1'), 100, 'completion sets progress to 100 when progress was reported');
select is((select outcome from public.task_attempts where task_id = :'t1' and attempt_number = 1), 'succeeded', 'the attempt is recorded');
select ok(not exists (select 1 from private.task_leases where task_id = :'t1'), 'the lease is released');

-- State machine guard (applies even to the table owner) ------------------------
select throws_ok(format($$ update public.tasks set status = 'queued' where id = %L $$, :'t1'),
                 'TPS01', null, 'a finished task cannot be re-opened');
select throws_ok(format($$ update public.tasks set payload = '{}' where id = %L $$, :'t1'),
                 '42501', null, 'payloads are immutable');
select throws_ok(format($$ delete from public.tasks where id = %L $$, :'t1'), '42501', null, 'tasks cannot be deleted');

-- Retries with backoff ---------------------------------------------------------
select pg_temp.act_as(:'owner');
select (public.submit_task('system.health_check', '{}', 'key-task-0002')).id as t2 \gset
select pg_temp.act_as_service();
select public.agent_claim(pg_temp.h('tok-agent-a')) as c2 \gset
select public.agent_start_task(pg_temp.h('tok-agent-a'), :'t2', (:'c2'::jsonb ->> 'lease_token')::uuid);
select is(public.agent_fail_task(pg_temp.h('tok-agent-a'), :'t2', (:'c2'::jsonb ->> 'lease_token')::uuid,
                                 'probe_failed', 'Clock probe failed', true) ->> 'status',
          'queued', 'a retryable failure re-queues the task');
select pg_temp.reset_role();
select ok((select available_at > now() from public.tasks where id = :'t2'), 'the retry is delayed (backoff)');
select is((select outcome from public.task_attempts where task_id = :'t2' and attempt_number = 1), 'retry_scheduled', 'attempt 1 is marked for retry');
select pg_temp.act_as_service();
select is(public.agent_claim(pg_temp.h('tok-agent-a')), null, 'the task is not claimable during backoff');
select pg_temp.reset_role();
update public.tasks set available_at = now() - interval '1 second' where id = :'t2';
select pg_temp.act_as_service();
select public.agent_claim(pg_temp.h('tok-agent-a')) as c2b \gset
select is((:'c2b'::jsonb ->> 'attempt')::int, 2, 'after backoff the task is claimed again as attempt 2');
select throws_ok(format($$ select public.agent_start_task(pg_temp.h('tok-agent-a'), %L, %L) $$, :'t2', :'c2'::jsonb ->> 'lease_token'),
                 'TPL01', null, 'the attempt-1 lease no longer works');
select public.agent_start_task(pg_temp.h('tok-agent-a'), :'t2', (:'c2b'::jsonb ->> 'lease_token')::uuid);
select is(public.agent_fail_task(pg_temp.h('tok-agent-a'), :'t2', (:'c2b'::jsonb ->> 'lease_token')::uuid,
                                 'probe_failed', 'Clock probe failed', false) ->> 'status',
          'failed', 'a non-retryable failure fails the task');
select pg_temp.reset_role();
select is((select error ->> 'code' from public.tasks where id = :'t2'), 'probe_failed', 'the structured error is stored');

-- Lease expiry and stale workers ------------------------------------------------
select pg_temp.act_as(:'owner');
select (public.submit_task('system.health_check', '{}', 'key-task-0003')).id as t3 \gset
select pg_temp.act_as_service();
select public.agent_claim(pg_temp.h('tok-agent-b')) as c3 \gset
select public.agent_start_task(pg_temp.h('tok-agent-b'), :'t3', (:'c3'::jsonb ->> 'lease_token')::uuid);
select pg_temp.reset_role();
update public.tasks set lease_expires_at = now() - interval '1 second' where id = :'t3';
select pg_temp.act_as_service();
select throws_ok(format($$ select public.agent_renew_lease(pg_temp.h('tok-agent-b'), %L, %L, null, null) $$, :'t3', :'c3'::jsonb ->> 'lease_token'),
                 'TPL01', null, 'an expired lease cannot be renewed');
select is((public.admin_recover_tasks() ->> 'requeued')::int, 1, 'recovery re-queues the task with the expired lease');
select pg_temp.reset_role();
select is((select status from public.tasks where id = :'t3'), 'queued', 'the task is queued again');
select is((select outcome from public.task_attempts where task_id = :'t3' and attempt_number = 1), 'lease_expired', 'the lost attempt is recorded');
update public.tasks set available_at = now() - interval '1 second' where id = :'t3';
select pg_temp.act_as_service();
select public.agent_claim(pg_temp.h('tok-agent-a')) as c3b \gset
select is((:'c3b'::jsonb ->> 'task_id')::uuid, :'t3'::uuid, 'another agent picks the task up');
select throws_ok(format($$ select public.agent_complete_task(pg_temp.h('tok-agent-b'), %L, %L, '{"ok":true}') $$, :'t3', :'c3'::jsonb ->> 'lease_token'),
                 'TPL01', null, 'the stale worker cannot complete a task it lost');
select public.agent_start_task(pg_temp.h('tok-agent-a'), :'t3', (:'c3b'::jsonb ->> 'lease_token')::uuid);
select public.agent_complete_task(pg_temp.h('tok-agent-a'), :'t3', (:'c3b'::jsonb ->> 'lease_token')::uuid, '{"ok":true}');
select pg_temp.reset_role();
select is((select status from public.tasks where id = :'t3'), 'succeeded', 'the new lease holder finishes it');

-- Cancellation -----------------------------------------------------------------
select pg_temp.act_as(:'owner');
select (public.submit_task('system.health_check', '{}', 'key-task-0004')).id as t4 \gset
select is((public.cancel_task(:'t4')).status, 'cancelled', 'cancelling a queued task cancels it immediately');
select throws_ok(format($$ select public.cancel_task(%L) $$, :'t4'), 'TPS01', null, 'a finished task cannot be cancelled');
select (public.submit_task('system.health_check', '{}', 'key-task-0005')).id as t5 \gset
select pg_temp.act_as_service();
select public.agent_claim(pg_temp.h('tok-agent-a')) as c5 \gset
select public.agent_start_task(pg_temp.h('tok-agent-a'), :'t5', (:'c5'::jsonb ->> 'lease_token')::uuid);
select pg_temp.act_as(:'other');
select throws_ok(format($$ select public.cancel_task(%L) $$, :'t5'), '42501', null, 'other users cannot cancel the owner''s task');
select pg_temp.act_as(:'owner');
select is((public.cancel_task(:'t5')).status, 'cancel_requested', 'cancelling a running task requests cancellation');
select pg_temp.act_as_service();
select is((public.agent_renew_lease(pg_temp.h('tok-agent-a'), :'t5', (:'c5'::jsonb ->> 'lease_token')::uuid, null, null)
           ->> 'cancel_requested')::boolean, true, 'the agent learns about the request at its next renewal');
select is(public.agent_ack_cancel(pg_temp.h('tok-agent-a'), :'t5', (:'c5'::jsonb ->> 'lease_token')::uuid) ->> 'status',
          'cancelled', 'the agent acknowledges and the task is cancelled');
select pg_temp.reset_role();

-- Queue deadline -----------------------------------------------------------------
insert into public.tasks (origin, task_type, idempotency_key, created_at, available_at, expires_at, max_attempts)
values ('system', 'system.health_check', 'key-system-01', now() - interval '2 hours', now() - interval '2 hours',
        now() - interval '1 hour', 1)
returning id as t6 \gset
select private.recover_tasks();
select is((select status from public.tasks where id = :'t6'), 'expired', 'queued tasks past their deadline expire');

-- Row-Level Security ---------------------------------------------------------------
select pg_temp.act_as(:'other');
select is((select count(*)::int from public.tasks), 0, 'other users see no tasks of the owner');
select is((select count(*)::int from public.task_attempts), 0, 'nor their attempts');
select is((select count(*)::int from public.agents), 0, 'non-owners see no agents');
select pg_temp.act_as(:'owner');
select is((select count(*)::int from public.tasks), 5, 'the owner sees exactly their own tasks (not system or other users'' tasks)');
select is((select count(*)::int from public.agents where id in (:'agent_a', :'agent_b')), 2, 'the owner sees the agents');
select pg_temp.act_as_anon();
select throws_ok($$ select count(*) from public.tasks $$, '42501', null, 'anonymous callers cannot read tasks');
select pg_temp.reset_role();

-- Agent eligibility ----------------------------------------------------------------
select pg_temp.make_agent('Old agent', 'tok-agent-old', '0.0.9') as agent_old \gset
select pg_temp.act_as(:'owner');
select (public.submit_task('system.health_check', '{}', 'key-task-0007')).id as t7 \gset
select pg_temp.act_as_service();
select is(public.agent_claim(pg_temp.h('tok-agent-old')), null, 'an agent below the minimum version gets no work');
select public.admin_revoke_agent(:'agent_a');
select throws_ok($$ select public.agent_claim(pg_temp.h('tok-agent-a')) $$, 'TPA01', null, 'a revoked agent is rejected');
select pg_temp.reset_role();
update public.agents set last_heartbeat_at = now() - interval '5 minutes' where id = :'agent_b';
select pg_temp.act_as_service();
select throws_ok($$ select public.agent_claim(pg_temp.h('tok-agent-b')) $$, 'TPA02', null, 'an agent must heartbeat before claiming');
select pg_temp.act_as(:'owner');
select throws_ok($$ select public.submit_task('system.health_check', '{}', 'key-task-0008') $$,
                 'TPU02', null, 'with no eligible agent online, submission is refused');
select pg_temp.reset_role();
select is((select count(*)::int from public.audit_events where event_type = 'agent.revoked' and resource_id = :'agent_a'), 1,
          'agent revocation is audited');

select * from finish();
rollback;
