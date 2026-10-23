begin;
\ir _helpers.inc
select plan(10);

select pg_temp.create_user('audit-a@example.test') as a \gset

-- Settings and profile changes are audited by trigger with field names only ----------
select pg_temp.act_as(:'a');
update public.user_settings set theme = 'light', display_currency = 'EUR';
update public.profiles set display_name = 'Audit Tester';
update public.user_settings set theme = 'light';   -- no actual change
select pg_temp.reset_role();

select is((select count(*)::int from public.audit_events where actor_user_id = :'a' and event_type = 'settings.updated'),
          1, 'one audit event per effective settings change (no-op updates are not logged)');
select is((select metadata -> 'fields' from public.audit_events where actor_user_id = :'a' and event_type = 'settings.updated'),
          '["display_currency", "theme"]'::jsonb, 'settings audit lists changed fields, not values');
select is((select metadata -> 'fields' from public.audit_events where actor_user_id = :'a' and event_type = 'profile.updated'),
          '["display_name"]'::jsonb, 'profile audit lists changed fields');
select ok(not exists (select 1 from public.audit_events where metadata::text ilike '%Audit Tester%'),
          'audit metadata does not copy profile values');

-- Sessions (sign-in / sign-out) ----------------------------------------------
insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), :'a', now(), now());
select is((select count(*)::int from public.audit_events where actor_user_id = :'a' and event_type = 'auth.session_started'),
          1, 'sign-in (session creation) is audited');
delete from auth.sessions where user_id = :'a';
select is((select count(*)::int from public.audit_events where actor_user_id = :'a' and event_type = 'auth.session_ended'),
          1, 'sign-out (session deletion) is audited');

-- Append-only, even for service_role ------------------------------------------
select pg_temp.act_as_service();
select throws_ok($$ update public.audit_events set event_type = 'tampered.event' $$, '42501', 'audit events are append-only',
                 'service_role cannot edit audit events');
select throws_ok($$ delete from public.audit_events $$, '42501', 'audit events are append-only',
                 'service_role cannot delete audit events');
select pg_temp.reset_role();

-- Deleting an account keeps its audit trail but detaches the actor -----------------
delete from auth.users where id = :'a';
select is((select count(*)::int from public.audit_events where actor_user_id = :'a'), 0, 'deleted user is detached from events');
select ok((select count(*) from public.audit_events where actor_user_id is null and resource_id = :'a') > 0,
          'events about the deleted account are retained');

select * from finish();
rollback;
