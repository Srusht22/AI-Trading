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

-- Act as a signed-in user, the way PostgREST does for a request with that JWT.
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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
