-- Scenario 12: a user can never read or change another user's data.

do $$
declare
  a uuid := test.new_user('a@example.com', 'User A');
  b uuid := test.new_user('b@example.com', 'User B');
  dev_a uuid := gen_random_uuid();
  b_project uuid := gen_random_uuid();
  b_category uuid := gen_random_uuid();
  b_tag uuid := gen_random_uuid();
  b_task uuid := gen_random_uuid();
  b_goal uuid := gen_random_uuid();
  b_habit uuid := gen_random_uuid();
  tables text[] := public.sync_tables();
  t text;
  n bigint;
  before_b jsonb;
  after_b jsonb;
  res jsonb;
begin
  -- B's data, written by the database owner so it exists before A looks.
  insert into public.projects (id, user_id, name) values (b_project, b, 'B project');
  insert into public.categories (id, user_id, name) values (b_category, b, 'B category');
  insert into public.tags (id, user_id, name) values (b_tag, b, 'b-tag');
  insert into public.tasks (id, user_id, title, project_id, category_id)
    values (b_task, b, 'B secret task', b_project, b_category);
  insert into public.subtasks (id, user_id, task_id, title) values (gen_random_uuid(), b, b_task, 'B subtask');
  insert into public.reminders (id, user_id, task_id, remind_at) values (gen_random_uuid(), b, b_task, now() + interval '1 day');
  insert into public.task_occurrences (id, user_id, task_id, occurrence_date) values (gen_random_uuid(), b, b_task, current_date);
  insert into public.task_tags (id, user_id, task_id, tag_id) values (gen_random_uuid(), b, b_task, b_tag);
  insert into public.attachments (id, user_id, task_id, file_url) values (gen_random_uuid(), b, b_task, 'https://example.com/b');
  insert into public.saved_filters (id, user_id, name) values (gen_random_uuid(), b, 'B filter');
  insert into public.calendar_links (id, user_id, task_id, calendar_id, event_id) values (gen_random_uuid(), b, b_task, 'primary', 'evt');
  insert into public.goals (id, user_id, title) values (b_goal, b, 'B goal');
  update public.tasks set goal_id = b_goal where id = b_task;
  insert into public.habits (id, user_id, title) values (b_habit, b, 'B habit');
  insert into public.habit_logs (id, user_id, habit_id, log_date) values (gen_random_uuid(), b, b_habit, current_date);
  insert into public.daily_notes (id, user_id, note_date, body) values (gen_random_uuid(), b, current_date, 'B private note');
  insert into public.focus_sessions (id, user_id, task_id, started_at, planned_minutes) values (gen_random_uuid(), b, b_task, now(), 25);
  insert into public.devices (id, user_id, platform) values (gen_random_uuid(), b, 'android');

  select jsonb_object_agg(x.t, x.c) into before_b from (
    select u.t, (xpath('/row/c/text()', query_to_xml(format('select md5(coalesce(string_agg(r::text, ''|'' order by r.id), '''')) as c from public.%I r where user_id = %L', u.t, b), false, true, '')))[1]::text as c
    from unnest(public.sync_tables()) u(t)) x;

  -- ------------------------------------------------------------------ as A
  perform test.login(a);

  foreach t in array tables loop
    execute format('select count(*) from public.%I where user_id = $1', t) into n using b;
    perform test.ok(n = 0, format('A sees none of B''s rows in %s', t));

    execute format('select count(*) from public.%I', t) into n;
    perform test.ok(n = case when t = 'profiles' then 1 else 0 end, format('A sees only A''s own rows in %s', t));

    execute format('update public.%I set deleted_at = now() where user_id = $1', t) using b;
    get diagnostics n = row_count;
    perform test.ok(n = 0, format('A''s update touches none of B''s rows in %s', t));

    perform test.throws(format('delete from public.%I', t), 'permission denied',
                        format('the app cannot hard-delete from %s', t));
  end loop;

  perform test.throws(format('insert into public.tasks (id, user_id, title) values (gen_random_uuid(), %L, ''planted'')', b),
                      'row-level security', 'A cannot insert a task owned by B');
  perform test.throws(format('insert into public.subtasks (id, task_id, title) values (gen_random_uuid(), %L, ''planted'')', b_task),
                      'foreign key', 'A cannot attach a subtask to B''s task');
  perform test.throws(format('insert into public.tasks (id, title, project_id) values (gen_random_uuid(), ''x'', %L)', b_project),
                      'foreign key', 'A cannot file a task under B''s project');

  perform test.throws(format('insert into public.tasks (id, title, goal_id) values (gen_random_uuid(), ''x'', %L)', b_goal),
                      'foreign key', 'A cannot link a task to B''s goal');
  perform test.throws(format('insert into public.habit_logs (id, habit_id, log_date) values (gen_random_uuid(), %L, current_date)', b_habit),
                      'foreign key', 'A cannot log B''s habit');
  perform test.throws(format('insert into public.focus_sessions (id, task_id, started_at, planned_minutes) values (gen_random_uuid(), %L, now(), 25)', b_task),
                      'foreign key', 'A cannot time a focus session on B''s task');

  select count(*) into n from public.devices;
  perform test.ok(n = 0, 'A sees none of B''s devices');
  select count(*) into n from public.change_history;
  perform test.ok(n = 0, 'A sees none of B''s history');
  select count(*) into n from public.sync_state where user_id = b;
  perform test.ok(n = 0, 'A cannot see B''s revision');
  perform test.throws('update public.sync_state set rev = 0', 'permission denied', 'the app cannot write sync_state');
  perform test.throws('insert into public.change_history (user_id, table_name, row_id, old_values) values (auth.uid(), ''tasks'', gen_random_uuid(), ''{}'')',
                      'permission denied', 'the app cannot write history');
  perform test.throws('select public.purge_expired(1)', 'permission denied', 'the app cannot run the purge');

  -- Through the sync functions.
  res := public.sync_pull(0);
  perform test.eq((select string_agg(k, ',' order by k) from jsonb_object_keys(res -> 'changes') k), 'profiles',
                  'A''s first pull contains only A''s profile');
  perform test.ok(res::text not like '%B secret task%', 'A''s pull does not contain B''s task');
  perform test.ok(res::text not like '%B private note%', 'A''s pull does not contain B''s note');

  res := public.sync_push(dev_a, jsonb_build_array(
    test.op('tasks', b_task, '{"title": "hijacked"}', test.ts(0, dev_a))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'A''s push to B''s task id is rejected');

  res := public.sync_push(dev_a, jsonb_build_array(
    test.op('tasks', b_task, '{}', test.ts(0, dev_a), 'delete')));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'missing', 'A''s delete of B''s task finds nothing');

  -- ------------------------------------------------------------ signed out
  perform test.login_anon();
  perform test.throws('select public.sync_tables()', 'permission denied', 'a signed-out visitor cannot list the synced tables');
  foreach t in array tables loop
    perform test.throws(format('select count(*) from public.%I', t), 'permission denied',
                        format('a signed-out visitor cannot read %s', t));
  end loop;
  perform test.throws('select public.sync_pull(0)', 'permission denied', 'a signed-out visitor cannot pull');
  perform test.throws(format('select public.sync_push(%L, ''[]'')', dev_a), 'permission denied', 'a signed-out visitor cannot push');
  perform test.throws('select count(*) from public.devices', 'permission denied', 'a signed-out visitor cannot read devices');

  -- ---------------------------------------------------- B's data untouched
  perform test.logout();
  select jsonb_object_agg(x.t, x.c) into after_b from (
    select u.t, (xpath('/row/c/text()', query_to_xml(format('select md5(coalesce(string_agg(r::text, ''|'' order by r.id), '''')) as c from public.%I r where user_id = %L', u.t, b), false, true, '')))[1]::text as c
    from unnest(public.sync_tables()) u(t)) x;
  perform test.ok(before_b = after_b, 'every one of B''s rows is byte-for-byte unchanged');

  -- Every table in the public schema has row-level security switched on.
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  perform test.ok(n = 0, 'row-level security is on for every public table');
end;
$$;
