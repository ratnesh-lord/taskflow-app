-- Accounts, profiles, devices and account deletion.

do $$
declare
  a uuid := test.new_user('ada@example.com', 'Ada Lovelace');
  b uuid := test.new_user('bob@example.com');
  phone uuid := gen_random_uuid();
  p public.profiles;
  n bigint;
  res jsonb;
  t text;
begin
  select * into p from public.profiles where id = a;
  perform test.ok(found, 'creating an account creates its profile');
  perform test.ok(p.name = 'Ada Lovelace' and p.email = 'ada@example.com', 'the profile takes name and email from the account');
  perform test.ok(p.rev > 0, 'the new profile already has a revision, so the first pull returns it');

  update auth.users set email = 'ada@new.example.com' where id = a;
  select * into p from public.profiles where id = a;
  perform test.eq(p.email, 'ada@new.example.com', 'the profile follows a change of email');

  -- Profile edits go through the same push as everything else.
  perform test.login(a);
  res := public.sync_push(phone, jsonb_build_array(
    test.op('profiles', a, '{"timezone": "Asia/Kolkata", "settings": {"theme": "dark", "week_start": 1}}', test.ts(0, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a user can edit their own profile');
  select * into p from public.profiles where id = a;
  perform test.ok(p.timezone = 'Asia/Kolkata' and p.settings ->> 'theme' = 'dark', 'the profile edit is stored');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('profiles', b, '{"name": "hijacked"}', test.ts(0, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a user cannot edit someone else''s profile');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('profiles', gen_random_uuid(), '{"name": "second profile"}', test.ts(0, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a user cannot create a second profile');

  -- Devices.
  perform public.register_device(phone, 'android', 'Nothing Phone (2a)', '0.1.0', 'token-1');
  select count(*) into n from public.devices where id = phone and user_id = a and push_token = 'token-1';
  perform test.ok(n = 1, 'a device registers itself');
  perform public.register_device(phone, 'android', 'Nothing Phone (2a)', '0.1.1', 'token-2');
  select count(*) into n from public.devices where user_id = a;
  perform test.ok(n = 1, 'registering again updates the same row');
  perform test.throws(format('select public.register_device(%L, ''toaster'')', gen_random_uuid()), 'check constraint',
                      'an unknown platform is refused');

  -- The same phone, signed in as someone else: the token moves with it.
  perform test.login(b);
  perform public.register_device(phone, 'android', 'Nothing Phone (2a)', '0.1.1', 'token-2');
  select count(*) into n from public.devices;
  perform test.ok(n = 1, 'B sees the phone as B''s device');
  perform test.logout();
  select count(*) into n from public.devices where push_token = 'token-2';
  perform test.ok(n = 1, 'a push token belongs to one account at a time');
  select count(*) into n from public.devices where user_id = a;
  perform test.ok(n = 0, 'A no longer receives pushes on that phone');

  -- Deleting the account removes everything it owned.
  perform test.login(a);
  perform public.sync_push(phone, jsonb_build_array(
    test.op('tasks', gen_random_uuid(), '{"title": "Soon gone"}', test.ts(0, phone))));
  perform test.logout();
  delete from auth.users where id = a;
  foreach t in array public.sync_tables() loop
    execute format('select count(*) from public.%I where user_id = $1', t) into n using a;
    perform test.ok(n = 0, format('deleting the account empties %s', t));
  end loop;
  select count(*) into n from public.sync_state where user_id = a;
  perform test.ok(n = 0, 'deleting the account removes its revision counter');
  select count(*) into n from public.change_history where user_id = a;
  perform test.ok(n = 0, 'deleting the account removes its history');
  select count(*) into n from public.profiles where id = b;
  perform test.ok(n = 1, 'another account is untouched');
end;
$$;
