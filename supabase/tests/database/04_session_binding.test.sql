begin;
\ir _helpers.inc
select plan(14);

select pg_temp.create_user('sess-a@example.test') as a \gset
select pg_temp.create_user('sess-b@example.test') as b \gset
select pg_temp.session_for(:'a') as sa \gset
select pg_temp.session_for(:'b') as sb \gset

-- Live session: normal access ------------------------------------------------
select pg_temp.act_as_session(:'a', :'sa');
select ok(public.has_active_session(), 'a live session is recognised');
select is((select count(*)::int from public.user_settings), 1, 'live session reads own settings');
select pg_temp.reset_role();

-- Token without a session_id (forged or legacy) -------------------------------
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', :'a', 'role', 'authenticated')::text, true);
select ok(not public.has_active_session(), 'a token without session_id is not active');
select is((select count(*)::int from public.user_settings), 0, 'and reads nothing');
select pg_temp.reset_role();

-- Someone else's session id in my token ---------------------------------------
select pg_temp.act_as_session(:'a', :'sb');
select ok(not public.has_active_session(), 'another user''s session id does not count');
select is((select count(*)::int from public.profiles), 0, 'and reads nothing');
select pg_temp.reset_role();

-- Expired session (not_after in the past) -------------------------------------
update auth.sessions set not_after = now() - interval '1 minute' where id = :'sb';
select pg_temp.act_as_session(:'b', :'sb');
select ok(not public.has_active_session(), 'a session past not_after is not active');
select is_empty($$ update public.user_settings set theme = 'light' returning user_id $$, 'and cannot update');
select pg_temp.reset_role();

-- Signed-out / revoked session: the token still verifies, access does not -------
delete from auth.sessions where id = :'sa';
select pg_temp.act_as_session(:'a', :'sa');
select ok(not public.has_active_session(), 'a deleted (signed-out) session is not active');
select is((select count(*)::int from public.user_settings), 0, 'revoked token reads no settings');
select is((select count(*)::int from public.audit_events), 0, 'revoked token reads no audit events');
select is_empty($$ update public.profiles set display_name = 'After sign-out' returning id $$, 'revoked token cannot update profile');
select throws_ok($$ select * from public.get_my_access() $$, '28000', 'session is no longer active', 'access check reports the revoked session');
select ok(not public.is_owner(), 'revoked token is never treated as owner');
select pg_temp.reset_role();

select * from finish();
rollback;
