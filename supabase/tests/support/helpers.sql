-- Test support only: tiny assertion and sign-in helpers.

create schema test;
grant usage on schema test to anon, authenticated, service_role;

create function test.new_user(p_email text, p_name text default null) returns uuid
language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
  values (p_email, case when p_name is null then '{}'::jsonb else jsonb_build_object('full_name', p_name) end)
  returning id into v_id;
  return v_id;
end;
$$;

-- Act as a signed-in user, exactly as a request through the Supabase API would.
create function test.login(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, false);
  perform set_config('role', 'authenticated', false);
end;
$$;

create function test.login_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'anon', false);
end;
$$;

create function test.login_service() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'service_role', false);
end;
$$;

-- Back to the database owner.
create function test.logout() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('role', 'none', false);
end;
$$;

create function test.ok(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'FAILED: %', p_message;
  end if;
  raise notice 'ok   %', p_message;
end;
$$;

create function test.eq(p_actual text, p_expected text, p_message text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAILED: % (expected %, got %)', p_message, coalesce(p_expected, 'null'), coalesce(p_actual, 'null');
  end if;
  raise notice 'ok   %', p_message;
end;
$$;

-- Passes when the statement raises an error whose text contains p_like.
create function test.throws(p_sql text, p_like text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' then
      raise notice 'ok   %', p_message;
      return;
    end if;
    raise exception 'FAILED: % (wrong error: %)', p_message, sqlerrm;
  end;
  raise exception 'FAILED: % (no error was raised)', p_message;
end;
$$;

-- A device timestamp p_offset_ms away from the server's clock.
create function test.ts(p_offset_ms bigint, p_device uuid, p_counter integer default 0) returns text
language sql as $$
  select lpad((floor(extract(epoch from clock_timestamp()) * 1000)::bigint + p_offset_ms)::text, 15, '0')
         || ':' || lpad(p_counter::text, 5, '0') || ':' || p_device::text
$$;

-- One op for sync_push.
create function test.op(p_table text, p_id uuid, p_patch jsonb, p_ts text, p_kind text default 'upsert') returns jsonb
language sql as $$
  select jsonb_build_object('op_id', gen_random_uuid(), 'table', p_table, 'id', p_id,
                            'kind', p_kind, 'patch', p_patch, 'ts', p_ts)
$$;

grant execute on all functions in schema test to anon, authenticated, service_role;
