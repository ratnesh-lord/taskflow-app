-- Phase 8: goals, habits, habit logs, daily notes and focus sessions.

do $$
declare
  u uuid := test.new_user('planner@example.com', 'Planner');
  phone uuid := gen_random_uuid();
  laptop uuid := gen_random_uuid();
  goal uuid := gen_random_uuid();
  task uuid := gen_random_uuid();
  habit uuid := gen_random_uuid();
  note uuid := gen_random_uuid();
  session uuid := gen_random_uuid();
  tables text[] := public.sync_tables();
  res jsonb;
  n bigint;
  s text;
begin
  perform test.ok(array_position(tables, 'goals') < array_position(tables, 'tasks'), 'goals come before the tasks that point at them');
  perform test.ok(tables @> array['goals', 'habits', 'habit_logs', 'daily_notes', 'focus_sessions'], 'the new tables are synced');
  perform test.ok(array_position(tables, 'habits') < array_position(tables, 'habit_logs'), 'habits come before their logs');

  perform test.login(u);

  -- A goal and a task linked to it, in one push.
  res := public.sync_push(phone, jsonb_build_array(
    test.op('goals', goal, '{"title": "Run a half marathon", "target_date": "2027-03-01"}', test.ts(0, phone)),
    test.op('tasks', task, format('{"title": "Buy shoes", "goal_id": "%s"}', goal)::jsonb, test.ts(0, phone, 1))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a goal is created');
  perform test.eq(res -> 'results' -> 1 ->> 'status', 'applied', 'a task is linked to the goal in the same push');
  perform test.eq((select goal_id::text from public.tasks where id = task), goal::text, 'the link is stored');

  res := public.sync_push(phone, jsonb_build_array(
    test.op('tasks', task, format('{"goal_id": "%s"}', gen_random_uuid())::jsonb, test.ts(0, phone, 2))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a task cannot point at a goal that does not exist');

  -- Habits and their rules.
  res := public.sync_push(phone, jsonb_build_array(
    test.op('habits', habit, '{"title": "Drink water", "target": 8, "unit": "glasses", "schedule": "daily", "reminder_time": "10:00"}', test.ts(0, phone, 3))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a habit is created');
  -- Each change needs a newer edit time than the last, or it is (rightly) stale.
  n := 40;
  foreach s in array array['days:1,3,5', 'week:3', 'days:0'] loop
    n := n + 1;
    res := public.sync_push(phone, jsonb_build_array(test.op('habits', habit, jsonb_build_object('schedule', s), test.ts(0, phone, n::int))));
    perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', format('the schedule %s is accepted', s));
  end loop;
  foreach s in array array['weekly', 'days:7', 'week:0', 'week:8', 'days:', ''] loop
    res := public.sync_push(phone, jsonb_build_array(test.op('habits', habit, jsonb_build_object('schedule', s), test.ts(0, phone, 50))));
    perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', format('the schedule "%s" is refused', s));
  end loop;
  res := public.sync_push(phone, jsonb_build_array(test.op('habits', habit, '{"target": 0}', test.ts(0, phone, 6))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a habit needs a target of at least 1');

  -- Two devices log the same habit offline: both count.
  res := public.sync_push(phone, jsonb_build_array(
    test.op('habit_logs', gen_random_uuid(), format('{"habit_id": "%s", "log_date": "2026-11-25", "amount": 1, "logged_at": "2026-11-25T08:00:00Z"}', habit)::jsonb, test.ts(0, phone, 7))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'the phone logs a glass');
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('habit_logs', gen_random_uuid(), format('{"habit_id": "%s", "log_date": "2026-11-25", "amount": 2, "logged_at": "2026-11-25T08:01:00Z"}', habit)::jsonb, test.ts(0, laptop))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'the laptop logs two glasses');
  select coalesce(sum(amount), 0) into n from public.habit_logs where habit_id = habit and log_date = '2026-11-25' and deleted_at is null;
  perform test.ok(n = 3, 'both devices'' logs count: 3 glasses');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('habit_logs', gen_random_uuid(), format('{"habit_id": "%s", "log_date": "2026-11-25", "amount": 0}', habit)::jsonb, test.ts(0, phone, 8))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a log of nothing is refused');

  -- A note written on two devices merges field by field.
  res := public.sync_push(phone, jsonb_build_array(
    test.op('daily_notes', note, '{"note_date": "2026-11-25", "kind": "day", "body": "from the phone"}', test.ts(0, phone, 9))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'the phone writes the day''s note');
  res := public.sync_push(laptop, jsonb_build_array(
    test.op('daily_notes', note, '{"note_date": "2026-11-25", "kind": "day", "planned_at": "2026-11-25T08:05:00Z"}', test.ts(-60000, laptop))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'the laptop, offline earlier, marks the day planned');
  perform test.ok((select body = 'from the phone' and planned_at is not null from public.daily_notes where id = note),
                  'the note keeps the phone''s text and the laptop''s planned time');
  perform test.throws(
    'insert into public.daily_notes (id, note_date, kind) values (gen_random_uuid(), ''2026-11-25'', ''day'')',
    'duplicate key', 'a second live note for the same day is refused');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('daily_notes', gen_random_uuid(), '{"note_date": "2026-11-24", "kind": "month"}', test.ts(0, phone, 10))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a note is for a day or a week');

  -- Focus sessions.
  res := public.sync_push(phone, jsonb_build_array(
    test.op('focus_sessions', session, format('{"task_id": "%s", "kind": "focus", "started_at": "2026-11-25T09:00:00Z", "planned_minutes": 25, "device_id": "%s"}', task, phone)::jsonb, test.ts(0, phone, 11))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a focus session starts');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('focus_sessions', session, '{"ended_at": "2026-11-25T09:20:00Z"}', test.ts(0, phone, 12))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'applied', 'a focus session is stopped early');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('focus_sessions', gen_random_uuid(), '{"kind": "focus", "started_at": "2026-11-25T10:00:00Z", "planned_minutes": 0}', test.ts(0, phone, 13))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a session lasts at least a minute');
  res := public.sync_push(phone, jsonb_build_array(
    test.op('focus_sessions', gen_random_uuid(), '{"kind": "nap", "started_at": "2026-11-25T10:00:00Z", "planned_minutes": 5}', test.ts(0, phone, 14))));
  perform test.eq(res -> 'results' -> 0 ->> 'status', 'rejected', 'a session is focus or a break');

  -- Everything comes back in a pull.
  res := public.sync_pull(0);
  perform test.ok((res -> 'changes') ?& array['goals', 'habits', 'habit_logs', 'daily_notes', 'focus_sessions'], 'a pull returns the new tables');
  perform test.ok(jsonb_array_length(res -> 'changes' -> 'habit_logs') = 2, 'a pull returns both logs');

  -- Deleting syncs as a tombstone; the purge later removes the rows for good.
  res := public.sync_push(phone, jsonb_build_array(
    test.op('habits', habit, '{}', test.ts(0, phone, 15), 'delete'),
    test.op('goals', goal, '{}', test.ts(0, phone, 16), 'delete')));
  perform test.ok((select count(*) from public.habits where id = habit and deleted_at is not null) = 1, 'a deleted habit stays as a tombstone');
  perform test.logout();

  update public.habits set deleted_at = now() - interval '100 days' where id = habit;
  update public.goals set deleted_at = now() - interval '100 days' where id = goal;
  perform test.login_service();
  perform public.purge_expired(90);
  perform test.logout();
  select count(*) into n from public.habit_logs where habit_id = habit;
  perform test.ok(n = 0, 'purging a habit removes its logs');
  perform test.ok((select goal_id is null from public.tasks where id = task), 'purging a goal unlinks its tasks and keeps them');
end;
$$;
