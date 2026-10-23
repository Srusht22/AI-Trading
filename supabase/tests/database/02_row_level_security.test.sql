begin;
\ir _helpers.inc
select plan(30);

select pg_temp.create_user('rls-a@example.test') as a \gset
select pg_temp.create_user('rls-b@example.test') as b \gset

-- Anonymous visitors ------------------------------------------------------------
select pg_temp.act_as_anon();
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select * from public.user_settings $$, '42501', null, 'anon cannot read settings');
select throws_ok($$ select * from public.audit_events $$, '42501', null, 'anon cannot read audit events');
select throws_ok($$ select public.get_my_access() $$, '42501', null, 'anon cannot call get_my_access');
select throws_ok($$ select * from private.app_owner $$, '42501', null, 'anon cannot see the owner table');
select pg_temp.reset_role();

-- User A sees only their own rows ----------------------------------------------
select pg_temp.act_as(:'a');
select is((select count(*)::int from public.profiles), 1, 'user sees exactly one profile');
select is((select id from public.profiles), :'a'::uuid, 'and it is their own');
select is((select count(*)::int from public.user_settings where user_id = :'b'), 0, 'user cannot read another user''s settings');
select is((select count(*)::int from public.audit_events where actor_user_id = :'b'), 0, 'user cannot read another user''s audit events');

-- ...and cannot change anyone else's rows (RLS filters them: zero rows affected)
select is_empty($$ update public.profiles set display_name = 'Hacked' where id = '$$ || :'b' || $$' returning id $$,
                'updating another user''s profile affects no rows');
select is_empty($$ update public.user_settings set theme = 'light' where user_id = '$$ || :'b' || $$' returning user_id $$,
                'updating another user''s settings affects no rows');
select throws_ok($$ insert into public.profiles (id, display_name) values ('$$ || :'b' || $$', 'Squatter') $$,
                 '42501', null, 'cannot create a profile for another user');
select throws_ok($$ delete from public.profiles $$, '42501', null, 'profiles cannot be deleted by users');

-- Ownership fields are not writable at all
select throws_ok($$ update public.profiles set id = '$$ || :'b' || $$' $$, '42501', null, 'profile id column is not updatable');
select throws_ok($$ update public.user_settings set user_id = '$$ || :'b' || $$' $$, '42501', null, 'settings user_id column is not updatable');
select throws_ok($$ update public.user_settings set revision = 99 $$, '42501', null, 'revision is server-controlled');
select throws_ok($$ update public.profiles set created_at = now() - interval '1 year' $$, '42501', null, 'created_at is not updatable');

-- Audit log is read-only for browser roles
select throws_ok($$ insert into public.audit_events (event_type, resource_type) values ('fake.event', 'test') $$,
                 '42501', null, 'users cannot forge audit events');
select throws_ok($$ update public.audit_events set event_type = 'x.y' $$, '42501', null, 'users cannot edit audit events');
select throws_ok($$ delete from public.audit_events $$, '42501', null, 'users cannot delete audit events');

-- Owner privileges cannot be self-granted
select throws_ok($$ select public.admin_assign_owner('rls-a@example.test') $$, '42501', null,
                 'an authenticated user cannot assign the owner');
select throws_ok($$ insert into private.app_owner (user_id) values (auth.uid()) $$, '42501', null,
                 'an authenticated user cannot write the owner table');
select is((select is_owner from public.get_my_access()), false, 'a registered user is not the owner by default');
select pg_temp.reset_role();

-- Trusted bootstrap via service_role -------------------------------------------------
select pg_temp.act_as_service();
select is(public.admin_assign_owner('RLS-A@example.test'), :'a'::uuid, 'service_role can assign the owner (email case-insensitive)');
select throws_ok($$ select public.admin_assign_owner('rls-b@example.test') $$, '23505', null,
                 'reassignment requires an explicit replace flag');
select pg_temp.reset_role();

select pg_temp.act_as(:'a');
select is((select is_owner from public.get_my_access()), true, 'assigned owner is recognised');
select ok((select count(*) from public.audit_events where actor_user_id = :'b') > 0, 'owner can review other users'' audit events');
select is((select count(*)::int from public.user_settings), 1, 'owner still cannot read other users'' settings');
select pg_temp.reset_role();

select pg_temp.act_as(:'b');
select is((select is_owner from public.get_my_access()), false, 'other users remain non-owners');
select is((select owner_configured from public.get_my_access()), true, 'but can see that an owner exists');
select pg_temp.reset_role();

select * from finish();
rollback;
