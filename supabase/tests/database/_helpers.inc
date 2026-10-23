-- Shared helpers for pgTAP tests. Included by each test file via \ir.
-- Everything lives in pg_temp and disappears with the session.

create extension if not exists pgtap with schema extensions;

-- Create a confirmed auth user exactly as GoTrue would (fires the same triggers).
create function pg_temp.create_user(p_email text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          crypt('Irrelevant-Pass-123', gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now());
  return v_id;
end $$;

-- Act as a signed-in user, the way PostgREST does for a request carrying a
-- real GoTrue access token: role authenticated, sub = user, session_id = a
-- live row in auth.sessions (reused per user so tests can count audit rows).
create function pg_temp.session_for(p_user uuid) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from auth.sessions where user_id = p_user order by created_at limit 1;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.sessions (id, user_id, created_at, updated_at) values (v_id, p_user, now(), now());
  end if;
  return v_id;
end $$;

create function pg_temp.act_as_session(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
end $$;

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
declare v_session uuid;
begin
  perform pg_temp.reset_role();
  v_session := pg_temp.session_for(p_user);
  perform pg_temp.act_as_session(p_user, v_session);
end $$;

create function pg_temp.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create function pg_temp.act_as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end $$;

create function pg_temp.reset_role() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
