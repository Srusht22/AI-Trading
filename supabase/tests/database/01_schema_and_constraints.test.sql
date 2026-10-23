begin;
\ir _helpers.inc
select plan(24);

-- Structure -------------------------------------------------------------------
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'user_settings', 'user_settings table exists');
select has_table('public', 'audit_events', 'audit_events table exists');
select has_table('private', 'app_owner', 'owner table lives in the private schema');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.profiles'::regclass, 'public.user_settings'::regclass,
                         'public.audit_events'::regclass, 'private.app_owner'::regclass)),
          'RLS is enabled on every table');
select col_type_is('public', 'audit_events', 'created_at', 'timestamp with time zone', 'audit timestamps are timestamptz');
select col_type_is('public', 'user_settings', 'updated_at', 'timestamp with time zone', 'settings timestamps are timestamptz');
select fk_ok('public', 'profiles', 'id', 'auth', 'users', 'id', 'profiles reference auth.users');

-- Sign-up side effects ----------------------------------------------------------
select pg_temp.create_user('schema-a@example.test') as a \gset
select is((select count(*)::int from public.profiles where id = :'a'), 1, 'new user gets a profile');
select is((select theme from public.user_settings where user_id = :'a'), 'dark', 'new user gets default settings');
select is((select timezone from public.user_settings where user_id = :'a'), 'UTC', 'default display timezone is explicit UTC');
select is((select count(*)::int from public.audit_events where actor_user_id = :'a' and event_type = 'account.created'),
          1, 'account creation is audited');

-- Constraint enforcement (as the owning user, through normal privileges) -----------
select pg_temp.act_as(:'a');
select throws_ok($$ update public.user_settings set theme = 'neon' $$, '23514', null, 'invalid theme rejected');
select throws_ok($$ update public.user_settings set display_currency = 'BTC' $$, '23514', null, 'unsupported currency rejected');
select throws_ok($$ update public.user_settings set timezone = 'Mars/Olympus' $$, '22023', null, 'unknown timezone rejected');
select throws_ok($$ update public.user_settings set notification_preferences = '{"backtests": true}' $$,
                 '23514', null, 'notification preferences must contain every key');
select throws_ok($$ update public.user_settings set notification_preferences = '{"backtests": "yes", "connection": true, "approvals": true, "research": true}' $$,
                 '23514', null, 'notification preferences must be booleans');
select throws_ok($$ update public.profiles set display_name = '  padded ' $$, '23514', null, 'untrimmed display name rejected');
select throws_ok($$ update public.profiles set display_name = repeat('x', 81) $$, '23514', null, 'over-long display name rejected');
select throws_ok($$ insert into public.user_settings (user_id) values (auth.uid()) $$, '23505', null,
                 'duplicate settings row for the same user rejected');

-- Revision increments and timestamps are server-controlled
select lives_ok($$ update public.user_settings set theme = 'light', timezone = 'Europe/London' $$, 'valid settings update succeeds');
select is((select revision from public.user_settings where user_id = :'a'), 2, 'revision increments on update');
select pg_temp.reset_role();

-- Audit metadata safety --------------------------------------------------------
select throws_ok($$ insert into public.audit_events (event_type, resource_type, metadata)
                    values ('test.event', 'test', '{"password": "x"}') $$, '23514', null,
                 'audit metadata cannot carry secret-looking keys');
select throws_ok($$ insert into public.audit_events (event_type, resource_type, metadata)
                    values ('test.event', 'test', '{"nested": {"a": 1}}') $$, '23514', null,
                 'audit metadata must be flat');

select * from finish();
rollback;
