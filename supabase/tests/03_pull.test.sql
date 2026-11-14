-- Pulling changes: paging, incremental pulls, purge and resync.

do $$
declare
  u      uuid := test.new_user('pull@example.com');
  other  uuid := test.new_user('pull-other@example.com');
  phone  uuid := gen_random_uuid();
  ids    uuid[];
  ops    jsonb;
  res    jsonb;
  since  bigint := 0;
  pages  integer := 0;
  seen   bigint := 0;
  seen_ids uuid[] := '{}';
  last_since bigint;
  cursor_before_delete bigint;
  n      bigint;
  doomed uuid;
  doomed_rev bigint;
begin
  select array_agg(gen_random_uuid()) into ids from generate_series(1, 25);

  -- Another user's rows are interleaved, to prove paging never leaks or miscounts.
  insert into public.tasks (id, user_id, title)
  select gen_random_uuid(), other, 'other ' || g from generate_series(1, 7) g;

  perform test.login(u);

  select jsonb_agg(test.op('tasks', ids[g], jsonb_build_object('title', 'Task ' || g), test.ts(g, phone)))
    into ops from generate_series(1, 25) g;
  res := public.sync_push(phone, ops);
  ops := jsonb_build_array(
    test.op('subtasks', gen_random_uuid(), jsonb_build_object('task_id', ids[1], 'title', 'Step one'), test.ts(100, phone)),
    test.op('reminders', gen_random_uuid(), jsonb_build_object('task_id', ids[1], 'kind', 'before_due', 'offset_minutes', 30), test.ts(101, phone)));
  res := public.sync_push(phone, ops);
  perform test.ok((select bool_and(e ->> 'status' = 'applied') from jsonb_array_elements(res -> 'results') e),
                  'a subtask and a relative reminder are created');

  -- Page through everything, 10 changes at a time (profile + 25 tasks + 2 children = 28).
  loop
    res := public.sync_pull(since, 10);
    pages := pages + 1;
    perform test.ok((res ->> 'reset')::boolean = false, format('page %s is a normal page', pages));
    select count(*) into n from jsonb_each(res -> 'changes') t, jsonb_array_elements(t.value) e;
    perform test.ok(n <= 10, format('page %s holds at most 10 changes', pages));
    seen := seen + n;
    select seen_ids || coalesce(array_agg((e ->> 'id')::uuid), '{}') into seen_ids
      from jsonb_each(res -> 'changes') t, jsonb_array_elements(t.value) e;
    last_since := since;
    since := (res ->> 'next_since')::bigint;
    perform test.ok(since > last_since, format('page %s moves the cursor forward', pages));
    exit when not (res ->> 'has_more')::boolean;
    perform test.ok(pages < 10, 'paging terminates');
  end loop;
  perform test.ok(pages = 3, 'twenty-eight changes arrive in three pages of ten');
  perform test.ok(seen = 28, 'every change arrives exactly once across the pages');
  perform test.ok((select count(distinct x) from unnest(seen_ids) x) = 28, 'no row is delivered twice');
  perform test.ok(ids <@ seen_ids, 'all 25 tasks were delivered');
  perform test.ok(since = (res ->> 'rev')::bigint, 'the cursor ends at the user''s current revision');

  res := public.sync_pull(0, 5000);
  perform test.ok(res::text not like '%other %', 'another user''s tasks never appear in a pull');
  perform test.ok(not (res -> 'changes' -> 'tasks' -> 0 ? 'user_id'), 'rows are sent without user_id');
  perform test.ok(res -> 'changes' -> 'tasks' -> 0 ? 'field_ts', 'rows carry their per-field edit times');

  -- Nothing new: an empty page.
  res := public.sync_pull(since);
  perform test.ok(res -> 'changes' = '{}'::jsonb and not (res ->> 'has_more')::boolean, 'a pull with nothing new is empty');

  -- One edit: exactly that row comes back.
  perform public.sync_push(phone, jsonb_build_array(
    test.op('tasks', ids[3], '{"status": "in_progress"}', test.ts(200, phone))));
  res := public.sync_pull(since);
  perform test.ok(jsonb_array_length(res -> 'changes' -> 'tasks') = 1
                  and res -> 'changes' -> 'tasks' -> 0 ->> 'id' = ids[3]::text
                  and res -> 'changes' -> 'tasks' -> 0 ->> 'status' = 'in_progress',
                  'after one edit, the next pull returns exactly that row');
  perform test.ok((select count(*) from jsonb_object_keys(res -> 'changes')) = 1, 'and nothing from other tables');
  since := (res ->> 'next_since')::bigint;

  -- A cursor ahead of the server (database restored from backup) forces a resync.
  res := public.sync_pull(since + 1000);
  perform test.ok((res ->> 'reset')::boolean, 'a device ahead of the server is told to resync');

  -- Delete a task; a tombstone is pulled like any other change.
  cursor_before_delete := since;
  doomed := ids[5];
  perform public.sync_push(phone, jsonb_build_array(test.op('tasks', doomed, '{}', test.ts(300, phone), 'delete')));
  res := public.sync_pull(since);
  perform test.ok(res -> 'changes' -> 'tasks' -> 0 ->> 'deleted_at' is not null, 'a delete reaches other devices as a tombstone');
  since := (res ->> 'next_since')::bigint;

  -- ------------------------------------------------------------- purge job
  perform test.logout();
  select rev into doomed_rev from public.tasks where id = doomed;
  -- Age the tombstone and some history past the 90-day window.
  alter table public.tasks disable trigger sync_touch;
  alter table public.tasks disable trigger sync_history;
  update public.tasks set deleted_at = now() - interval '100 days' where id = doomed;
  alter table public.tasks enable trigger sync_touch;
  alter table public.tasks enable trigger sync_history;
  update public.change_history set changed_at = now() - interval '100 days' where row_id = ids[3];

  perform test.login_service();
  n := public.purge_expired(90);
  perform test.ok(n = 1, 'the purge removes the one expired tombstone');
  perform test.logout();

  select count(*) into n from public.tasks where id = doomed;
  perform test.ok(n = 0, 'the purged row is gone');
  select count(*) into n from public.tasks where user_id = u;
  perform test.ok(n = 24, 'live tasks are untouched by the purge');
  select count(*) into n from public.change_history where row_id = ids[3];
  perform test.ok(n = 0, 'history past the window is purged');
  select purge_rev into n from public.sync_state where user_id = u;
  perform test.ok(n = doomed_rev, 'the user''s purge mark records how far the purge reached');

  perform test.login(u);
  res := public.sync_pull(cursor_before_delete);
  perform test.ok((res ->> 'reset')::boolean, 'a device that never saw the purged tombstone is told to resync');
  res := public.sync_pull(since);
  perform test.ok(not (res ->> 'reset')::boolean, 'a device that had seen it carries on normally');
  res := public.sync_pull(0, 5000);
  perform test.ok(not (res ->> 'reset')::boolean and jsonb_array_length(res -> 'changes' -> 'tasks') = 24,
                  'a resync from zero returns the 24 live tasks');

  perform test.logout();
end;
$$;
