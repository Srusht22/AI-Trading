begin;
\ir _helpers.inc
select plan(7);

delete from private.app_owner;
select pg_temp.create_user('limits-owner@example.test') as owner \gset
insert into private.app_owner (singleton, user_id) values (true, :'owner');

select pg_temp.act_as_service();
select public.admin_register_agent('Limits agent', array['system.health_check'], extensions.digest('tok-limits', 'sha256'), 1);
select public.agent_heartbeat(extensions.digest('tok-limits', 'sha256'), '0.1.0', array['system.health_check'], null);
select pg_temp.reset_role();

-- At most 5 unfinished tasks per owner.
select pg_temp.act_as(:'owner');
select public.submit_task('system.health_check', '{}', 'limit-key-' || i) from generate_series(1, 5) i;
select throws_ok($$ select public.submit_task('system.health_check', '{}', 'limit-key-6') $$,
                 'TPR01', 'too many tasks are already waiting or running', 'a sixth unfinished task is refused');
select lives_ok($$ select public.submit_task('system.health_check', '{}', 'limit-key-1') $$,
                'an idempotent replay is still answered at the limit');

-- At most 10 submissions per minute, even when earlier ones finished.
select public.cancel_task(id) from public.tasks where owner_user_id = :'owner';
select public.submit_task('system.health_check', '{}', 'limit-key-b' || i) from generate_series(1, 5) i;
select public.cancel_task(id) from public.tasks where owner_user_id = :'owner' and status = 'queued';
select throws_ok($$ select public.submit_task('system.health_check', '{}', 'limit-key-c1') $$,
                 'TPR01', 'too many tasks submitted in the last minute', 'the per-minute rate limit applies');
select is((select count(*)::int from public.tasks), 10, 'exactly ten tasks were created');
select pg_temp.reset_role();

-- A revoked session cannot submit or cancel.
select pg_temp.session_for(:'owner') as sess \gset
delete from auth.sessions where id = :'sess';
select pg_temp.act_as_session(:'owner', :'sess');
select throws_ok($$ select public.submit_task('system.health_check', '{}', 'limit-key-d1') $$,
                 '28000', null, 'a signed-out session cannot submit tasks');
select throws_ok(format($$ select public.cancel_task(%L) $$, gen_random_uuid()),
                 '28000', null, 'nor cancel them');
select is((select count(*)::int from public.tasks), 0, 'nor read them');
select pg_temp.reset_role();

select * from finish();
rollback;
