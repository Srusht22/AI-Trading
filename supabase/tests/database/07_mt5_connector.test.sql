begin;
\ir _helpers.inc
select plan(74);

delete from private.app_owner;
select pg_temp.create_user('mt5-owner@example.test') as owner \gset
select pg_temp.create_user('mt5-other@example.test') as other \gset
insert into private.app_owner (singleton, user_id) values (true, :'owner');

create function pg_temp.h(p text) returns bytea language sql as $$ select extensions.digest(p, 'sha256') $$;
create function pg_temp.fp(p text) returns text language sql as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

-- A demo report as the connector sends it.
create function pg_temp.report(p_mode text, p_code int, p_fp text, p_state text default 'ok') returns jsonb language sql as $$
  select jsonb_build_object('state', p_state, 'connector_version', '1.0.0', 'terminal_build', 5200, 'terminal_connected', true,
    'trade_mode', p_mode, 'trade_mode_code', p_code, 'account_fingerprint', p_fp, 'masked_account', '****821',
    'server', 'Broker-Demo', 'company', 'Example Broker Ltd', 'currency', 'EUR', 'currency_digits', 2, 'leverage', 100,
    'broker_utc_offset_minutes', 120, 'broker_offset_source', 'estimated');
$$;

create function pg_temp.account(p_equity numeric) returns jsonb language sql as $$
  select jsonb_build_object('balance', 10000, 'credit', 0, 'equity', p_equity, 'profit', p_equity - 10000, 'margin', 120.5,
    'margin_free', p_equity - 120.5, 'margin_level', round(p_equity / 120.5 * 100, 2), 'currency', 'EUR', 'currency_digits', 2,
    'leverage', 100, 'observed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
$$;

create function pg_temp.iso(p timestamptz) returns text language sql as $$
  select to_char(p at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- Structure and privileges ------------------------------------------------------
select ok(bool_and(c.relrowsecurity), 'all MT5 tables have RLS')
  from pg_class c where c.oid in ('public.mt5_connections'::regclass, 'public.mt5_account_state'::regclass,
    'public.mt5_account_snapshots'::regclass, 'public.mt5_symbols'::regclass, 'public.mt5_quotes'::regclass,
    'public.mt5_bars'::regclass, 'public.mt5_positions'::regclass, 'public.mt5_orders'::regclass, 'public.mt5_deals'::regclass);
select ok(not has_table_privilege('authenticated', 'public.mt5_account_state', 'INSERT,UPDATE,DELETE'), 'browsers cannot write account data');
select ok(not has_table_privilege('service_role', 'public.mt5_quotes', 'INSERT,UPDATE,DELETE'), 'service_role cannot write quotes directly');
select ok(not has_table_privilege('authenticated', 'public.mt5_connections', 'UPDATE'), 'browsers cannot update connections directly');
select ok(not has_table_privilege('anon', 'public.mt5_positions', 'SELECT'), 'anonymous callers cannot read positions');
select ok(not has_function_privilege('authenticated', 'public.mt5_publish(bytea,uuid,text,text,jsonb)', 'EXECUTE'), 'browsers cannot publish as a connector');
select ok(not has_function_privilege('authenticated', 'public.mt5_report_connection(bytea,jsonb)', 'EXECUTE'), 'browsers cannot report verification');
select ok(not has_function_privilege('anon', 'public.agent_pair(bytea,bytea,text,text)', 'EXECUTE'), 'anonymous callers cannot pair directly');
select ok(not has_table_privilege('service_role', 'private.agent_pairings', 'SELECT'), 'pairing hashes are not readable');
select is((select array_agg(task_type order by task_type) from public.task_types where available and task_type like 'mt5.%'),
          array['mt5.account_snapshot', 'mt5.pending_orders_read', 'mt5.positions_read', 'mt5.price_history',
                'mt5.recent_history_read', 'mt5.symbol_list', 'mt5.terminal_status'],
          'exactly the read-only MT5 task types are available');
select is((select array_agg(task_type order by task_type) from public.task_types where not available),
          array['mt5.backtest', 'mt5.collect_report', 'mt5.compile_ea', 'strategy.evaluate'], 'unimplemented types stay refused');
select ok(not exists (select 1 from public.task_types where task_type ~ '(send|close|modify|place|execute|cancel|start|trade)'), 'no trading task type exists');
select is((select count(*)::int from public.task_types where task_type like 'mt5.%' and available and required_capability <> 'mt5.read'), 0,
          'every available MT5 task requires mt5.read');

-- Pairing -----------------------------------------------------------------------------
select pg_temp.act_as(:'other');
select throws_ok($$ select public.create_agent_pairing('x') $$, '42501', null, 'a non-owner cannot create pairing codes');
select pg_temp.act_as(:'owner');
select public.create_agent_pairing('Windows PC') ->> 'code' as code \gset
select ok(:'code' ~ '^[0-9A-F]{4}(-[0-9A-F]{4}){4}$', 'the pairing code is 80 bits, grouped for typing');
select pg_temp.reset_role();
select is((select count(*)::int from private.agent_pairings where display_name = 'Windows PC' and capabilities = array['mt5.read']), 1,
          'only the hash is stored, with the mt5.read capability only');

select pg_temp.act_as_service();
select (public.agent_pair(pg_temp.h(replace(:'code', '-', '')), pg_temp.h('tok-mt5'), '1.0.0', 'Windows/AMD64') ->> 'agent_id') as agent \gset
select throws_ok(format($$ select public.agent_pair(pg_temp.h(%L), pg_temp.h('tok-again'), '1.0.0', null) $$, replace(:'code', '-', '')),
                 'TPP01', null, 'a pairing code works once');
select throws_ok($$ select public.agent_pair(pg_temp.h('0000000000000000000A'), pg_temp.h('tok-guess'), '1.0.0', null) $$,
                 'TPP01', null, 'an unknown pairing code is refused');
select pg_temp.reset_role();
select is((select owner_user_id from public.agents where id = :'agent'), :'owner'::uuid, 'the paired agent belongs to the issuing owner');
select is((select allowed_capabilities from public.agents where id = :'agent'), array['mt5.read'], 'and holds only mt5.read');

-- A second, ordinary agent without the MT5 capability.
select pg_temp.act_as_service();
select public.admin_register_agent('Diagnostics', array['system.health_check'], pg_temp.h('tok-diag'), 1) as diag \gset
select throws_ok($$ select public.mt5_report_connection(pg_temp.h('tok-diag'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'))) $$,
                 'TPA03', null, 'an agent without mt5.read cannot report an MT5 connection');

-- Verification ----------------------------------------------------------------------------
select public.agent_heartbeat(pg_temp.h('tok-mt5'), '1.0.0', array['mt5.read'], 'Windows/AMD64');
select (public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'), 'terminal_unavailable')) ->> 'connection_id') as conn \gset
select pg_temp.reset_role();
select is((select status || '/' || status_reason from public.mt5_connections where id = :'conn'), 'awaiting_verification/terminal_unavailable',
          'an unavailable terminal leaves the connection unverified');

select pg_temp.act_as_service();
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('real', 2, pg_temp.fp('acc-real'))) ->> 'status', 'blocked',
          'a real account is blocked');
select pg_temp.reset_role();
select is((select status_reason from public.mt5_connections where id = :'conn'), 'unsupported_account_type', 'with the reason recorded');
select ok((select masked_account is null and server is null and currency is null from public.mt5_connections where id = :'conn'),
          'nothing about the real account is stored');
select pg_temp.act_as_service();
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('contest', 1, pg_temp.fp('acc-c'))) ->> 'status', 'blocked',
          'a contest account is blocked');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('unknown', null, pg_temp.fp('acc-u'))) ->> 'status', 'blocked',
          'an unknown account mode is blocked');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 2, pg_temp.fp('acc-x'))) ->> 'status', 'blocked',
          'a "demo" label with a non-demo mode code is blocked');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'))) ->> 'status', 'verified',
          'a demo account (mode code 0) is verified');
select pg_temp.reset_role();
select ok((select masked_account = '****821' and currency = 'EUR' and detected_trade_mode = 'demo' and verified_at is not null
           from public.mt5_connections where id = :'conn'), 'the verified account is described without its login number');
select is((select count(*)::int from public.audit_events where event_type = 'connector.verified' and resource_id = :'conn'), 1,
          'verification is audited');

-- Publishing -------------------------------------------------------------------------------
select pg_temp.act_as_service();
select is(public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'account', pg_temp.account(10012.34)) ->> 'accepted', 'true',
          'the verified connector publishes the account summary');
select pg_temp.reset_role();
select is((select equity from public.mt5_account_state where connection_id = :'conn'), 10012.34, 'the reported equity is stored as reported');
select is((select count(*)::int from public.mt5_account_snapshots where connection_id = :'conn'), 1, 'and a history snapshot is taken');
update public.mt5_connections set last_account_at = now() - interval '10 seconds' where id = :'conn';
select pg_temp.act_as_service();
select public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'account', pg_temp.account(10020));
select pg_temp.reset_role();
select is((select count(*)::int from public.mt5_account_snapshots where connection_id = :'conn'), 1, 'snapshots respect the capture interval');

select pg_temp.act_as_service();
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'account', pg_temp.account(1)) $$, :'conn'),
                 'TPR02', null, 'updates faster than the limit are refused');
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'positions',
                          '{"observed_at":"2026-10-24T10:00:00Z","positions":[],"password":"x"}') $$, :'conn'),
                 'TPV01', null, 'credential-like fields are refused');
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-diag'), %L, pg_temp.fp('acc-1'), 'quotes', '{}') $$, :'conn'),
                 'TPA03', null, 'another agent cannot publish to this connection');
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'orders_send', '{}') $$, :'conn'),
                 'TPV01', null, 'unknown data kinds (e.g. anything order-related) are refused');

-- Symbols, monitoring and quotes
select public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'symbols', jsonb_build_object(
  'batch_id', '11111111-1111-4111-8111-111111111111', 'page', 0, 'final', true, 'symbols', jsonb_build_array(
    jsonb_build_object('name', 'EURUSD.r', 'description', 'Euro vs US Dollar', 'digits', 5, 'point', 0.00001, 'currency_base', 'EUR', 'currency_profit', 'USD', 'trade_mode', 4, 'visible', true),
    jsonb_build_object('name', 'XAUUSD', 'description', 'Gold', 'digits', 2, 'point', 0.01, 'trade_mode', 4, 'visible', false))));
select pg_temp.reset_role();
select is((select count(*)::int from public.mt5_symbols where connection_id = :'conn'), 2, 'broker symbols are stored with their real names');

select pg_temp.act_as(:'owner');
select throws_ok(format($$ select public.set_mt5_monitored_symbols(%L, array['EURUSD']) $$, :'conn'),
                 'TPV01', null, 'only symbols the terminal offers can be monitored');
select is(public.set_mt5_monitored_symbols(:'conn', array['EURUSD.r']) -> 'monitored_symbols', '["EURUSD.r"]'::jsonb,
          'the owner chooses symbols to monitor');
select pg_temp.reset_role();

select pg_temp.act_as_service();
select is(public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'quotes', jsonb_build_object(
  'observed_at', pg_temp.iso(now()), 'quotes', jsonb_build_array(
    jsonb_build_object('symbol', 'EURUSD.r', 'bid', 1.08412, 'ask', 1.08419, 'tick_time', pg_temp.iso(now() - interval '1 second')),
    jsonb_build_object('symbol', 'XAUUSD', 'bid', 2400.1, 'ask', 2400.5, 'tick_time', pg_temp.iso(now()))))) ->> 'stored', '1',
  'quotes are stored only for monitored symbols');
select pg_temp.reset_role();
select ok((select tick_time < observed_at and bid = 1.08412 from public.mt5_quotes where connection_id = :'conn' and symbol = 'EURUSD.r'),
          'the broker tick time and the observation time are kept separately');
update public.mt5_connections set last_quotes_at = now() - interval '2 seconds' where id = :'conn';
select pg_temp.act_as_service();
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'quotes', jsonb_build_object(
  'observed_at', pg_temp.iso(now()), 'quotes', jsonb_build_array(jsonb_build_object('symbol', 'EURUSD.r', 'bid', 1.2, 'ask', 1.1,
  'tick_time', pg_temp.iso(now()))))) $$, :'conn'), 'TPV01', null, 'a crossed quote (ask below bid) is refused');

-- Bars
select is(public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'bars', jsonb_build_object(
  'symbol', 'EURUSD.r', 'timeframe', 'M5', 'bars', jsonb_build_array(
    jsonb_build_object('open_time', pg_temp.iso(date_trunc('hour', now()) - interval '10 minutes'), 'open', 1.084, 'high', 1.0845, 'low', 1.0838, 'close', 1.0842, 'tick_volume', 311),
    jsonb_build_object('open_time', pg_temp.iso(date_trunc('hour', now()) - interval '5 minutes'), 'open', 1.0842, 'high', 1.0846, 'low', 1.0840, 'close', 1.0841, 'tick_volume', 290)))) ->> 'stored', '2',
  'OHLC bars are stored');
select pg_temp.reset_role();
update public.mt5_connections set last_bars_at = null where id = :'conn';
select pg_temp.act_as_service();
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'bars', jsonb_build_object(
  'symbol', 'EURUSD.r', 'timeframe', 'M5', 'bars', jsonb_build_array(jsonb_build_object('open_time', '2026-10-01T00:00:00Z',
  'open', 1.2, 'high', 1.1, 'low', 1.0, 'close', 1.05)))) $$, :'conn'), 'TPV01', null, 'inconsistent OHLC values are refused');
select pg_temp.reset_role();
update public.mt5_connections set last_bars_at = null where id = :'conn';
select pg_temp.act_as_service();
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'bars', jsonb_build_object(
  'symbol', 'EURUSD.r', 'timeframe', 'D1', 'bars', '[]'::jsonb)) $$, :'conn'), 'TPV01', null, 'unsupported timeframes are refused');

select pg_temp.reset_role();
update public.mt5_connections set last_bars_at = null where id = :'conn';
select pg_temp.act_as_service();
select is(public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'bars', jsonb_build_object(
  'symbol', 'EURUSD.r', 'timeframe', 'H1', 'bars', (select jsonb_agg(jsonb_build_object('open_time', pg_temp.iso(date_trunc('hour', now()) - make_interval(hours => g)),
    'open', 1.08, 'high', 1.081, 'low', 1.079, 'close', 1.0805)) from generate_series(1, 300) g))) ->> 'stored', '300',
  'large bounded batches (300 bars) are accepted');

-- Positions / orders / deals (read-only snapshots)
select public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'positions', jsonb_build_object(
  'observed_at', pg_temp.iso(now()), 'positions', jsonb_build_array(jsonb_build_object('ticket', 5001, 'symbol', 'EURUSD.r', 'side', 'buy',
  'volume', 0.1, 'price_open', 1.0801, 'price_current', 1.0841, 'profit', 40, 'swap', -0.3, 'opened_at', pg_temp.iso(now() - interval '1 day')))));
select pg_temp.reset_role();
select is((select count(*)::int from public.mt5_positions where connection_id = :'conn'), 1, 'open positions are stored as read');
update public.mt5_connections set last_positions_at = now() - interval '5 seconds' where id = :'conn';
select pg_temp.act_as_service();
select public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-1'), 'positions', jsonb_build_object('observed_at', pg_temp.iso(now()), 'positions', '[]'::jsonb));
select pg_temp.reset_role();
select is((select count(*)::int from public.mt5_positions where connection_id = :'conn'), 0, 'a closed position disappears from the current set');

-- Row-Level Security --------------------------------------------------------------------------
select pg_temp.act_as(:'other');
select is((select count(*)::int from public.mt5_connections), 0, 'another user sees no connection');
select is((select count(*)::int from public.mt5_account_state), 0, 'nor account data');
select is((select count(*)::int from public.mt5_quotes), 0, 'nor quotes');
select throws_ok(format($$ select public.disconnect_mt5_connection(%L) $$, :'conn'), '42501', null, 'nor can they disconnect it');
select pg_temp.act_as(:'owner');
select is((select count(*)::int from public.mt5_quotes), 1, 'the owner sees their quotes');
select pg_temp.reset_role();
select throws_ok(format($$ update public.mt5_connections set owner_user_id = %L where id = %L $$, :'other', :'conn'),
                 '42501', null, 'connection ownership cannot be changed');

-- Targeted read-only tasks ----------------------------------------------------------------------
select pg_temp.act_as(:'owner');
select (public.submit_task('mt5.price_history', jsonb_build_object('connection_id', :'conn', 'symbol', 'EURUSD.r', 'timeframe', 'M5', 'count', 200),
                           'mt5-task-0001')).id as t1 \gset
select throws_ok($$ select public.submit_task('mt5.backtest', '{}', 'mt5-task-0002') $$, 'TPU01', null, 'backtests stay unavailable');
select throws_ok(format($$ select public.submit_task('mt5.price_history', jsonb_build_object('connection_id', %L, 'symbol', 'EURUSD.r',
                 'timeframe', 'M5', 'count', 200, 'script', 'x'), 'mt5-task-0003') $$, :'conn'), 'TPV01', null, 'extra payload fields are refused');
select pg_temp.reset_role();
select is((select target_agent_id from public.tasks where id = :'t1'), :'agent'::uuid, 'the task targets the connection''s connector');

select pg_temp.act_as_service();
select public.admin_register_agent('Other MT5', array['mt5.read'], pg_temp.h('tok-mt5-b'), 1);
select public.agent_heartbeat(pg_temp.h('tok-mt5-b'), '1.0.0', array['mt5.read'], null);
select is(public.agent_claim(pg_temp.h('tok-mt5-b')), null, 'another MT5 connector cannot claim it');
select is((public.agent_claim(pg_temp.h('tok-mt5')) ->> 'task_id')::uuid, :'t1'::uuid, 'the connection''s connector claims it');

-- Account switch, disconnect, resume, revoke ---------------------------------------------------
select is(public.mt5_publish(pg_temp.h('tok-mt5'), :'conn', pg_temp.fp('acc-2'), 'deals', '{}') ->> 'reason', 'account_changed',
          'data carrying another account''s fingerprint blocks the connection');
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'deals', '{}') $$, :'conn'),
                 'TPC02', null, 'a blocked connection refuses all data');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-2'))) ->> 'status', 'blocked',
          'a different demo account is not silently accepted');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'))) ->> 'status', 'verified',
          'switching back to the approved demo account re-verifies it');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('real', 2, pg_temp.fp('acc-1'))) ->> 'status', 'blocked',
          'a verified connection is blocked as soon as the account reports a non-demo mode');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'))) ->> 'status', 'verified',
          'and verified again only by a fresh demo report for the approved account');

select pg_temp.act_as(:'owner');
select is(public.disconnect_mt5_connection(:'conn') ->> 'status', 'disconnected', 'the owner can disconnect the feed');
select pg_temp.act_as_service();
select throws_ok(format($$ select public.mt5_publish(pg_temp.h('tok-mt5'), %L, pg_temp.fp('acc-1'), 'deals', '{}') $$, :'conn'),
                 'TPC01', null, 'a disconnected connection refuses data');
select is(public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'))) ->> 'status', 'disconnected',
          'and stays disconnected until the owner resumes it');
select pg_temp.act_as(:'owner');
select is(public.resume_mt5_connection(:'conn', true) ->> 'status', 'awaiting_verification', 'resuming requires a fresh verification');
select pg_temp.reset_role();
select is((select count(*)::int from public.mt5_account_snapshots where connection_id = :'conn'), 0,
          'accepting a new account removes the previous account''s data');
select pg_temp.act_as(:'owner');
select public.revoke_agent(:'agent');
select pg_temp.act_as_service();
select throws_ok($$ select public.mt5_report_connection(pg_temp.h('tok-mt5'), pg_temp.report('demo', 0, pg_temp.fp('acc-1'))) $$,
                 'TPA01', null, 'a revoked connector is locked out');

select * from finish();
rollback;
