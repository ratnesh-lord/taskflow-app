-- Scenario 8 and friends: two devices edit the same data.

do $$
declare
  u      uuid := test.new_user('merge@example.com');
  phone  uuid := gen_random_uuid();
  laptop uuid := gen_random_uuid();
  task   uuid := gen_random_uuid();
  task2  uuid := gen_random_uuid();
  occ    uuid := gen_random_uuid();
  tag    uuid := gen_random_uuid();
  res    jsonb;
  r      public.tasks;
  n      bigint;
  rev_before bigint;
  rev_after  bigint;
begin
  perform test.login(u);

  -- Create ------------------------------------------------------------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task, '{"title": "Write report", "priority": "high", "due_date": "2026-11-20"}', test.ts(-60000, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a new task is created by a push');
  select * into r from public.tasks where id = task;
  perform test.ok(r.user_id = u, 'the new task belongs to the caller');
  perform test.eq(r.status::text, 'inbox', 'columns left out of the patch take their defaults');
  perform test.ok(r.rev > 0 and r.rev = (res ->> 'rev')::bigint, 'the task carries the user''s newest revision');
  perform test.ok(r.field_ts ? 'title' and r.field_ts ? 'priority' and r.field_ts ? 'due_date',
                  'each written column remembers when it was edited');

  -- Different fields on two devices: both edits survive ----------------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task, '{"title": "Write the report"}', test.ts(-30000, phone))));
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task, '{"due_date": "2026-11-25"}', test.ts(-29000, laptop))));
  select * into r from public.tasks where id = task;
  perform test.ok(r.title = 'Write the report' and r.due_date = date '2026-11-25',
                  'a title edit on the phone and a date edit on the laptop both survive');
  perform test.eq(r.priority::text, 'high', 'an untouched field keeps its value');

  -- Same field: the later edit wins, whichever arrives first -------------------
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task, '{"title": "Laptop title"}', test.ts(-10000, laptop))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'the later edit is applied');
  select rev into rev_before from public.sync_state where user_id = u;
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task, '{"title": "Older phone title"}', test.ts(-20000, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'stale', 'an older edit arriving late is reported stale');
  select * into r from public.tasks where id = task;
  perform test.eq(r.title, 'Laptop title', 'the later edit is still in place');
  select rev into rev_after from public.sync_state where user_id = u;
  perform test.ok(rev_after = rev_before, 'a stale edit does not move the revision');

  -- A mixed patch: the newer column is written, the older one is not -----------
  res := public.sync_push(phone, jsonb_build_array(jsonb_build_object(
    'table', 'tasks', 'id', task,
    'patch', '{"title": "Stale again", "notes": "Fresh note"}'::jsonb,
    'ts', test.ts(-15000, phone),
    'field_ts', jsonb_build_object('notes', test.ts(-5000, phone)))));
  select * into r from public.tasks where id = task;
  perform test.ok(r.title = 'Laptop title' and r.notes = 'Fresh note',
                  'one patch can win on one column and lose on another');

  -- Retrying the same op changes nothing ---------------------------------------
  select rev into rev_before from public.sync_state where user_id = u;
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task2, '{"title": "Sent twice"}', '001700000000000:00001:' || laptop::text),
    test.op('tasks', task2, '{"title": "Sent twice"}', '001700000000000:00001:' || laptop::text)));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'first delivery of an op is applied');
  perform test.eq(res -> 'results' -> 1 ->> 'status', 'stale', 'a repeated delivery is harmless');
  select count(*) into n from public.tasks where id = task2;
  perform test.ok(n = 1, 'the retried insert made one row, not two');

  -- The overwritten value is kept ----------------------------------------------
  select count(*) into n from public.change_history
   where row_id = task and old_values ->> 'title' = 'Write the report';
  perform test.ok(n = 1, 'the title that lost the merge is in the history');
  select count(*) into n from public.change_history where row_id = task and device_id = laptop;
  perform test.ok(n >= 1, 'history records which device made the change');

  -- Delete, late edit, restore ---------------------------------------------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task, '{}', test.ts(-4000, phone), 'delete')));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a delete is applied');
  select * into r from public.tasks where id = task;
  perform test.ok(r.deleted_at is not null, 'deleting marks the row, it does not remove it');

  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task, '{"priority": "low"}', test.ts(-3000, laptop))));
  select * into r from public.tasks where id = task;
  perform test.ok(r.deleted_at is not null and r.priority = 'low',
                  'an edit to a deleted task is kept but does not bring the task back');

  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task, '{}', test.ts(-6000, laptop), 'restore')));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'stale', 'a restore older than the delete loses');

  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task, '{}', test.ts(-2000, laptop), 'restore')));
  select * into r from public.tasks where id = task;
  perform test.ok(r.deleted_at is null, 'a newer restore brings the task back');

  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', gen_random_uuid(), '{}', test.ts(0, phone), 'delete')));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'missing', 'deleting a row that never existed is reported, not an error');

  -- A phone whose clock is a day ahead does not win forever -------------------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task, '{"description": "from the future"}', test.ts(86400000, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'an edit stamped a day ahead is accepted');
  select * into r from public.tasks where id = task;
  perform test.ok((r.field_ts ->> 'description') < test.ts(600001, phone),
                  'its timestamp is pulled back to the server''s clock');
  perform pg_sleep(0.01);
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tasks', task, '{"description": "laptop, a moment later"}', test.ts(0, laptop))));
  select * into r from public.tasks where id = task;
  perform test.eq(r.description, 'laptop, a moment later', 'so a correct clock can still win afterwards');

  -- Invalid ops are rejected one by one; the rest of the batch still runs -------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('secrets', gen_random_uuid(), '{"x": 1}', test.ts(0, phone)),
    test.op('tasks', task, '{"no_such_column": 1}', test.ts(0, phone)),
    test.op('tasks', task, format('{"user_id": "%s"}', gen_random_uuid())::jsonb, test.ts(0, phone)),
    test.op('tasks', task, '{"rev": 999999}', test.ts(0, phone)),
    test.op('tasks', task, '{"status": "not-a-status"}', test.ts(0, phone)),
    test.op('tasks', task, '{"title": "x"}', 'yesterday'),
    test.op('tasks', gen_random_uuid(), '{"description": "no title"}', test.ts(0, phone)),
    test.op('tasks', task, '{"title": ""}', test.ts(0, phone)),
    test.op('subtasks', gen_random_uuid(), format('{"task_id": "%s", "title": "orphan"}', gen_random_uuid())::jsonb, test.ts(0, phone)),
    test.op('tasks', task, '{"estimated_minutes": 90}', test.ts(0, phone))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'an unknown table is rejected');
  perform test.eq(res -> 'results' -> 1 ->> 'status', 'rejected', 'an unknown column is rejected');
  perform test.eq(res -> 'results' -> 2 ->> 'status', 'rejected', 'a patch cannot change the owner');
  perform test.eq(res -> 'results' -> 3 ->> 'status', 'rejected', 'a patch cannot set the revision');
  perform test.eq(res -> 'results' -> 4 ->> 'status', 'rejected', 'an invalid status is rejected');
  perform test.eq(res -> 'results' -> 5 ->> 'status', 'rejected', 'a malformed timestamp is rejected');
  perform test.eq(res -> 'results' -> 6 ->> 'status', 'rejected', 'a new task without a title is rejected');
  perform test.eq(res -> 'results' -> 7 ->> 'status', 'rejected', 'an empty title is rejected');
  perform test.eq(res -> 'results' -> 8 ->> 'status', 'rejected', 'a subtask of a task that does not exist is rejected');
  perform test.eq(res -> 'results' -> 9 ->> 'status', 'applied', 'a valid op after nine bad ones is still applied');
  select * into r from public.tasks where id = task;
  perform test.ok(r.estimated_minutes = 90 and r.user_id = u and r.title = 'Laptop title',
                  'the rejected ops left the task as it was');

  perform test.throws(
    format('select public.sync_push(%L, (select jsonb_agg(test.op(''tasks'', gen_random_uuid(), ''{"title":"x"}'', test.ts(0, %L))) from generate_series(1, 501)))', phone, phone),
    'at most 500', 'a batch over 500 ops is refused whole');
  perform test.throws(format('select public.sync_push(%L, ''{}''::jsonb)', phone), 'must be a JSON array', 'ops must be an array');

  -- Recurring task: two devices complete the same occurrence -----------------------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task2, '{"rrule": "FREQ=WEEKLY;BYDAY=SA", "due_date": "2026-11-14"}', test.ts(0, phone)),
    test.op('task_occurrences', occ, format('{"task_id": "%s", "occurrence_date": "2026-11-14", "status": "completed", "completed_at": "2026-11-14T13:30:00Z", "deleted_at": null}', task2)::jsonb, test.ts(1, phone))));
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('task_occurrences', occ, format('{"task_id": "%s", "occurrence_date": "2026-11-14", "status": "completed", "completed_at": "2026-11-14T13:31:00Z", "deleted_at": null}', task2)::jsonb, test.ts(2, laptop))));
  select count(*) into n from public.task_occurrences where task_id = task2;
  perform test.ok(n = 1, 'the same occurrence completed on two devices is one row');
  select * into r from public.tasks where id = task2;
  perform test.ok(r.rrule = 'FREQ=WEEKLY;BYDAY=SA' and r.completed_at is null and r.status <> 'completed',
                  'completing an occurrence leaves the recurring task itself open');
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('task_occurrences', gen_random_uuid(), format('{"task_id": "%s", "occurrence_date": "2026-11-14"}', task2)::jsonb, test.ts(3, laptop))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a second row for the same occurrence is refused');

  -- Tags: the same tag made offline on two devices -----------------------------------------
  res := public.sync_push(phone, jsonb_build_array(
    test.op('tags', tag, '{"name": "Exam", "deleted_at": null}', test.ts(4, phone))));
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tags', tag, '{"name": "exam", "deleted_at": null}', test.ts(5, laptop))));
  select count(*) into n from public.tags where user_id = u;
  perform test.ok(n = 1, 'the same tag created on two devices is one row');
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('tags', gen_random_uuid(), '{"name": "EXAM"}', test.ts(6, laptop))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a duplicate tag name under another id is refused');

  -- Revisions ------------------------------------------------------------------------------
  select count(*) - count(distinct x.rev) into n from (
    select rev from public.tasks union all select rev from public.task_occurrences
    union all select rev from public.tags union all select rev from public.profiles) x;
  perform test.ok(n = 0, 'no two of the user''s rows share a revision');

  perform test.logout();
end;
$$;
