-- Usernames, groups, assigned and private tasks (migration 20261128000100).
-- Four people: Alice creates a group and invites Bob and Carol; Dave is never in it.

-- Status of the first op in a sync_push reply.
create function test.status(p_reply jsonb) returns text language sql as $$
  select p_reply -> 'results' -> 0 ->> 'status'
$$;
create function test.error(p_reply jsonb) returns text language sql as $$
  select p_reply -> 'results' -> 0 ->> 'error'
$$;

-- Everything sync_pull_groups returns for one group, pulled from 0 in pages
-- of p_limit, as { table: { id: row } } (later pages overwrite earlier rows).
create function test.group_rows(p_group uuid, p_limit integer default 1000, p_since bigint default 0) returns jsonb
language plpgsql as $$
declare
  v_since bigint := p_since;
  v_out   jsonb := '{}'::jsonb;
  v_page  jsonb;
  v_tab   text;
  v_row   jsonb;
  n       integer := 0;
begin
  loop
    n := n + 1;
    if n > 200 then raise exception 'too many pages'; end if;
    select p into v_page
      from jsonb_array_elements(public.sync_pull_groups(jsonb_build_object(p_group::text, v_since), p_limit) -> 'pages') p
     where p ->> 'id' = p_group::text;
    exit when v_page is null;
    if (v_page ->> 'reset')::boolean then
      return jsonb_build_object('reset', true);
    end if;
    for v_tab in select jsonb_object_keys(v_page -> 'changes') loop
      for v_row in select jsonb_array_elements(v_page -> 'changes' -> v_tab) loop
        v_out := jsonb_set(v_out, array[v_tab], coalesce(v_out -> v_tab, '{}'::jsonb) || jsonb_build_object(v_row ->> 'id', v_row));
      end loop;
    end loop;
    v_since := (v_page ->> 'next_since')::bigint;
    exit when not (v_page ->> 'has_more')::boolean;
  end loop;
  return v_out || jsonb_build_object('since', v_since);
end;
$$;
grant execute on all functions in schema test to anon, authenticated, service_role;

do $$
declare
  a uuid := test.new_user('groups-alice@example.com', 'Alice A');
  b uuid := test.new_user('groups-bob@example.com', 'Bob B');
  c uuid := test.new_user('groups-carol@example.com', 'Carol C');
  d uuid := test.new_user('groups-dave@example.com', 'Dave D');
  pa uuid := gen_random_uuid();
  pb uuid := gen_random_uuid();
  pc uuid := gen_random_uuid();
  pd uuid := gen_random_uuid();
  g uuid;
  t1 uuid := gen_random_uuid();  -- assigned to Bob
  t2 uuid := gen_random_uuid();  -- private, assigned to Bob
  t3 uuid := gen_random_uuid();  -- private, Alice's own
  t4 uuid := gen_random_uuid();  -- shared with everyone, nobody assigned
  s1 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  r1 uuid := gen_random_uuid();
  p_task uuid := gen_random_uuid();
  p_sub uuid := gen_random_uuid();
  a_project uuid := gen_random_uuid();
  res jsonb;
  got jsonb;
  rows jsonb;
  since_c bigint;
  rev_before bigint;
  n bigint;
  v text;
begin
  -- ---------------------------------------------------------------- usernames
  perform test.login(a);
  perform test.throws('select public.create_group(''Home'')', 'username first', 'a group needs a username first');
  perform test.throws('select public.claim_username(''Al'')', '3 to 20', 'a username of two letters is refused');
  perform test.throws('select public.claim_username(''al ice'')', '3 to 20', 'a username with a space is refused');
  perform test.eq(public.claim_username('  Alice '), 'alice', 'a username is trimmed and lower-cased');
  perform test.eq((select username from public.profiles where id = a), 'alice', 'the username is on the profile');

  perform test.login(b);
  perform test.throws('select public.claim_username(''ALICE'')', 'taken', 'a username is unique whatever its case');
  perform test.eq(public.claim_username('bob'), 'bob', 'Bob claims bob');
  res := public.sync_push(pb, jsonb_build_array(test.op('profiles', b, '{"username":"bobby"}', test.ts(0, pb))));
  perform test.eq((select username from public.profiles where id = b), 'bob', 'sync_push cannot change a username');
  got := public.find_user('BOB');
  perform test.eq(got::text, jsonb_build_object('username', 'bob', 'name', 'Bob B')::text,
                  'find_user gives only username and name (no email, no id)');
  perform test.ok(public.find_user('bo') is null, 'find_user matches whole usernames only');

  perform test.login(c);
  perform public.claim_username('carol');
  perform test.login(d);
  perform public.claim_username('dave');

  perform test.login_anon();
  perform test.throws('select public.find_user(''bob'')', 'permission denied', 'signed-out callers cannot look people up');

  -- ------------------------------------------------------------ the group
  perform test.login(a);
  g := public.create_group('  Household ');
  perform test.throws('select * from public.groups', 'permission denied', 'groups cannot be read directly, only pulled');
  perform test.throws('select * from public.group_members', 'permission denied', 'nor can memberships');
  got := public.sync_pull_groups('{}', 1000);
  perform test.eq(got -> 'member_of' ->> 0, g::text, 'Alice is a member of her group');
  rows := test.group_rows(g);
  perform test.eq(rows -> 'groups' -> g::text ->> 'name', 'Household', 'her pull brings the group, name trimmed');
  perform test.eq((select string_agg(r ->> 'username' || '/' || (r ->> 'role') || '/' || (r ->> 'status'), ',')
                     from jsonb_each(rows -> 'group_members') e(k, r)), 'alice/owner/active', 'and her membership as owner');

  perform test.throws(format('select public.invite_to_group(%L, ''nobody'')', g), 'Nobody has the username', 'inviting an unknown username fails');
  perform test.logout();
  select rev into rev_before from public.sync_state where user_id = b;
  perform test.login(a);
  perform public.invite_to_group(g, 'Bob');
  perform test.throws(format('select public.invite_to_group(%L, ''bob'')', g), 'already invited', 'an invite is not sent twice');
  perform public.invite_to_group(g, 'carol');

  perform test.login(b);
  perform test.ok((select rev from public.sync_state where user_id = b) > rev_before, 'an invite moves Bob''s revision, so his devices sync');
  got := public.sync_pull_groups('{}', 1000);
  perform test.eq(jsonb_array_length(got -> 'member_of')::text, '0', 'an invited person is not yet a member');
  perform test.eq(got -> 'invites' -> 'groups' -> 0 ->> 'name', 'Household', 'Bob sees the invite with the group''s name');
  perform test.eq(got -> 'invites' -> 'group_members' -> 0 ->> 'invited_by_username', 'alice', 'and who invited him');
  perform test.eq(jsonb_array_length(got -> 'pages')::text, '0', 'but none of the group''s rows');
  res := public.sync_push(pb, jsonb_build_array(test.op('tasks', gen_random_uuid(), jsonb_build_object('title', 'sneaky', 'group_id', g), test.ts(0, pb))));
  perform test.eq(test.status(res), 'rejected', 'an invited person cannot add tasks to the group');
  perform test.throws(format('select public.invite_to_group(%L, ''dave'')', g), 'owner or an admin', 'an invited person cannot invite');
  perform public.respond_to_invite(g, true);
  perform test.throws(format('select public.respond_to_invite(%L, true)', g), 'no longer open', 'an invite is answered once');

  perform test.login(c);
  perform public.respond_to_invite(g, true);
  perform test.throws(format('select public.invite_to_group(%L, ''dave'')', g), 'owner or an admin', 'an ordinary member cannot invite');
  perform test.throws(format('select public.rename_group(%L, ''Mine'')', g), 'owner or an admin', 'an ordinary member cannot rename');

  -- --------------------------------------------------------- group tasks
  perform test.login(a);
  insert into public.projects (id, user_id, name) values (a_project, a, 'Alice project');
  res := public.sync_push(pa, jsonb_build_array(
    test.op('tasks', t1, jsonb_build_object('title', 'Take bins out', 'group_id', g, 'owner_id', b, 'project_id', a_project), test.ts(0, pa, 1)),
    test.op('tasks', t2, jsonb_build_object('title', 'Bob''s surprise', 'group_id', g, 'owner_id', b, 'is_private', true), test.ts(0, pa, 2)),
    test.op('tasks', t3, jsonb_build_object('title', 'Alice only', 'group_id', g, 'is_private', true), test.ts(0, pa, 3)),
    test.op('tasks', t4, jsonb_build_object('title', 'Shopping', 'group_id', g), test.ts(0, pa, 4)),
    test.op('subtasks', s1, jsonb_build_object('task_id', t1, 'title', 'Green bin'), test.ts(0, pa, 5)),
    test.op('subtasks', s3, jsonb_build_object('task_id', t3, 'title', 'Secret step'), test.ts(0, pa, 6))));
  perform test.ok((select bool_and(e ->> 'status' = 'applied') from jsonb_array_elements(res -> 'results') e), 'Alice adds four group tasks and two subtasks');
  perform test.eq((select created_by::text from public.tasks where id = t1), a::text, 'the creator is recorded');
  perform test.ok((select project_id is null from public.tasks where id = t1), 'a group task has no (personal) project');
  perform test.eq((select group_id::text from public.subtasks where id = s1), g::text, 'a subtask belongs to its task''s group');

  got := public.sync_pull(0, 1000);
  perform test.ok(not (got -> 'changes' ? 'tasks'), 'group tasks are not in Alice''s personal pull');

  perform test.login(b);
  rows := test.group_rows(g);
  perform test.eq(rows -> 'tasks' -> t1::text ->> 'title', 'Take bins out', 'Bob sees the task assigned to him');
  perform test.eq(rows -> 'tasks' -> t1::text ->> 'created_by', a::text, 'with who created it');
  perform test.ok(not (rows -> 'tasks' -> t1::text ? 'user_id'), 'rows arrive without user_id, as in sync_pull');
  perform test.eq(rows -> 'tasks' -> t2::text ->> 'title', 'Bob''s surprise', 'Bob sees a private task assigned to him');
  perform test.eq(rows -> 'tasks' -> t3::text ->> 'hidden', 'true', 'Alice''s private task reaches Bob only as a hidden stub');
  perform test.ok(not (rows -> 'tasks' -> t3::text ? 'title'), 'the stub has no title');
  perform test.eq(rows -> 'subtasks' -> s3::text ->> 'hidden', 'true', 'and so does its subtask');
  perform test.eq(rows -> 'subtasks' -> s1::text ->> 'title', 'Green bin', 'Bob sees the subtask of his task');
  perform test.eq((select count(*) from jsonb_object_keys(rows -> 'group_members'))::text, '3', 'Bob sees all three members');
  perform test.ok(not (rows::text like '%example.com%'), 'no email address appears anywhere in a group pull');

  -- Paging returns the same rows as one big page.
  perform test.eq(test.group_rows(g, 2)::text, rows::text, 'pulling two rows at a time gives the same result');

  perform test.eq((select count(*) from public.tasks)::text, '3', 'Bob can read three of the four group tasks directly');

  -- The owner may change everything; the change merges like any other edit.
  res := public.sync_push(pb, jsonb_build_array(
    test.op('tasks', t1, '{"title":"Take both bins out"}', test.ts(10, pb, 1)),
    test.op('subtasks', s1, '{"is_completed":true}', test.ts(10, pb, 2)),
    test.op('reminders', r1, jsonb_build_object('task_id', t1, 'kind', 'before_due', 'offset_minutes', 30), test.ts(10, pb, 3))));
  perform test.ok((select bool_and(e ->> 'status' = 'applied') from jsonb_array_elements(res -> 'results') e), 'Bob edits his assigned task, ticks a subtask and adds a reminder');
  perform test.logout();
  perform test.eq((select user_id::text from public.reminders where id = r1), a::text, 'the reminder is filed under the task''s creator');
  perform test.eq((select group_id::text from public.reminders where id = r1), g::text, 'and belongs to the group');

  perform test.login(c);
  rows := test.group_rows(g);
  perform test.eq(rows -> 'tasks' -> t2::text ->> 'hidden', 'true', 'Carol gets Bob''s private task only as a stub');
  perform test.eq(rows -> 'tasks' -> t1::text ->> 'title', 'Take both bins out', 'Carol sees Bob''s edit');
  since_c := (rows ->> 'since')::bigint;
  res := public.sync_push(pc, jsonb_build_array(test.op('tasks', t1, '{"title":"Carol was here"}', test.ts(20, pc))));
  perform test.eq(test.status(res), 'rejected', 'Carol, neither creator nor owner, cannot change the task');
  perform test.ok(test.error(res) like '%created this task or the person it is assigned to%', 'and is told why');
  res := public.sync_push(pc, jsonb_build_array(test.op('subtasks', gen_random_uuid(), jsonb_build_object('task_id', t1, 'title', 'x'), test.ts(21, pc))));
  perform test.eq(test.status(res), 'rejected', 'nor add a subtask to it');
  res := public.sync_push(pc, jsonb_build_array(test.op('tasks', t2, '{"title":"peek"}', test.ts(22, pc))));
  perform test.eq(test.status(res), 'rejected', 'nor touch a private task she cannot see');
  res := public.sync_push(pc, jsonb_build_array(test.op('focus_sessions', gen_random_uuid(),
    jsonb_build_object('task_id', t1, 'started_at', now(), 'planned_minutes', 25), test.ts(23, pc))));
  perform test.eq(test.status(res), 'applied', 'a member can time a focus session on a group task she can see');
  res := public.sync_push(pc, jsonb_build_array(test.op('focus_sessions', gen_random_uuid(),
    jsonb_build_object('task_id', t3, 'started_at', now(), 'planned_minutes', 25), test.ts(24, pc))));
  perform test.eq(test.status(res), 'rejected', 'but not on a private one she cannot see');

  perform test.login(d);
  res := public.sync_push(pd, jsonb_build_array(test.op('tasks', t1, '{"title":"outsider"}', test.ts(25, pd))));
  perform test.eq(test.status(res), 'rejected', 'someone outside the group cannot change its tasks');
  perform test.eq((select count(*) from public.tasks)::text, '0', 'nor read them');
  perform test.eq(jsonb_array_length(public.sync_pull_groups('{}', 1000) -> 'pages')::text, '0', 'nor pull them');

  -- Reassigning: Bob hands the task to Carol; then only Alice and Carol may change it.
  perform test.login(b);
  res := public.sync_push(pb, jsonb_build_array(test.op('tasks', t1, jsonb_build_object('owner_id', c), test.ts(30, pb))));
  perform test.eq(test.status(res), 'applied', 'the owner reassigns the task to Carol');
  res := public.sync_push(pb, jsonb_build_array(test.op('tasks', t1, '{"title":"Bob again"}', test.ts(31, pb))));
  perform test.eq(test.status(res), 'rejected', 'after that Bob can no longer change it');
  perform test.login(c);
  res := public.sync_push(pc, jsonb_build_array(test.op('tasks', t1, '{"status":"in_progress"}', test.ts(32, pc))));
  perform test.eq(test.status(res), 'applied', 'Carol now can');
  -- The owner of a private task can hand it back, after which it is hidden from him.
  perform test.login(b);
  res := public.sync_push(pb, jsonb_build_array(test.op('tasks', t2, jsonb_build_object('owner_id', null), test.ts(32, pb, 1))));
  perform test.eq(test.status(res), 'applied', 'Bob hands Alice''s private task back to her');
  rows := test.group_rows(g);
  perform test.eq(rows -> 'tasks' -> t2::text ->> 'hidden', 'true', 'and his next pull hides it');
  res := public.sync_push(pb, jsonb_build_array(test.op('tasks', t2, '{"title":"again"}', test.ts(32, pb, 2))));
  perform test.eq(test.status(res), 'rejected', 'nor can he change it any more');
  perform test.login(c);
  -- Assigning to someone outside the group gives the task back to its creator.
  res := public.sync_push(pc, jsonb_build_array(test.op('tasks', t1, jsonb_build_object('owner_id', d), test.ts(33, pc))));
  perform test.eq(test.status(res), 'applied', 'assigning to an outsider is accepted');
  perform test.ok((select owner_id is null from public.tasks where id = t1), 'but leaves the task with its creator');
  -- A group task stays in its group.
  perform test.login(a);
  res := public.sync_push(pa, jsonb_build_array(test.op('tasks', t1, '{"group_id":null}', test.ts(34, pa))));
  perform test.eq((select group_id::text from public.tasks where id = t1), g::text, 'a group task cannot be taken out of its group');

  -- Making a task private hides it, children included; making it public brings it back.
  perform test.login(c);
  since_c := (test.group_rows(g) ->> 'since')::bigint;
  perform test.login(a);
  insert into public.subtasks (id, user_id, task_id, title) values (gen_random_uuid(), a, t4, 'Milk');
  res := public.sync_push(pa, jsonb_build_array(test.op('tasks', t4, '{"is_private":true}', test.ts(40, pa))));
  perform test.eq(test.status(res), 'applied', 'Alice makes the shopping task private');
  perform test.login(c);
  rows := test.group_rows(g, 1000, since_c);
  perform test.eq(rows -> 'tasks' -> t4::text ->> 'hidden', 'true', 'Carol''s next pull hides it');
  perform test.eq((select string_agg(r ->> 'hidden', ',') from jsonb_each(rows -> 'subtasks') e(k, r)), 'true', 'and its subtask');
  since_c := (rows ->> 'since')::bigint;
  perform test.login(a);
  res := public.sync_push(pa, jsonb_build_array(test.op('tasks', t4, '{"is_private":false}', test.ts(41, pa))));
  perform test.login(c);
  rows := test.group_rows(g, 1000, since_c);
  perform test.eq(rows -> 'tasks' -> t4::text ->> 'title', 'Shopping', 'when it is shared again Carol gets it back');
  perform test.eq((select string_agg(r ->> 'title', ',') from jsonb_each(rows -> 'subtasks') e(k, r)), 'Milk', 'with its subtask');

  -- A personal task moved into the group brings its subtasks along.
  perform test.login(a);
  res := public.sync_push(pa, jsonb_build_array(
    test.op('tasks', p_task, '{"title":"Fix the tap"}', test.ts(50, pa, 1)),
    test.op('subtasks', p_sub, jsonb_build_object('task_id', p_task, 'title', 'Buy washer'), test.ts(50, pa, 2))));
  perform test.ok((select group_id is null from public.subtasks where id = p_sub), 'a personal subtask has no group');
  perform test.login(c);
  since_c := (test.group_rows(g) ->> 'since')::bigint;
  perform test.login(a);
  res := public.sync_push(pa, jsonb_build_array(test.op('tasks', p_task, jsonb_build_object('group_id', g), test.ts(51, pa))));
  perform test.eq(test.status(res), 'applied', 'Alice shares a personal task with the group');
  perform test.login(c);
  rows := test.group_rows(g, 1000, since_c);
  perform test.eq(rows -> 'tasks' -> p_task::text ->> 'title', 'Fix the tap', 'Carol receives the moved task');
  perform test.eq(rows -> 'subtasks' -> p_sub::text ->> 'title', 'Buy washer', 'and its subtask');
  perform test.login(d);
  res := public.sync_push(pd, jsonb_build_array(test.op('tasks', gen_random_uuid(), jsonb_build_object('title', 'x', 'group_id', g), test.ts(52, pd))));
  perform test.eq(test.status(res), 'rejected', 'an outsider cannot add a task to the group');

  -- Live updates: a member can read the group's counter, others cannot.
  perform test.login(c);
  perform test.eq((select count(*) from public.group_sync_state)::text, '1', 'a member can watch the group''s revision');
  perform test.login(d);
  perform test.eq((select count(*) from public.group_sync_state)::text, '0', 'an outsider cannot');
  perform test.throws(format('select private.bump_group(%L)', g), 'permission denied', 'the private helpers cannot be called by the app');

  -- ------------------------------------------------------------ roles
  perform test.login(c);
  perform test.throws(format('select public.remove_member(%L, %L)', g, b), 'can remove people', 'a member cannot remove anyone');
  perform test.throws(format('select public.set_member_role(%L, %L, ''admin'')', g, c), 'Only the group''s owner', 'nor make herself an admin');
  perform test.login(a);
  perform public.set_member_role(g, b, 'admin');
  perform test.login(b);
  perform public.invite_to_group(g, 'dave');
  perform test.login(d);
  perform test.eq(public.sync_pull_groups('{}', 1000) -> 'invites' -> 'groups' -> 0 ->> 'name', 'Household', 'an admin can invite');
  perform public.respond_to_invite(g, false);
  perform test.eq(jsonb_array_length(public.sync_pull_groups('{}', 1000) -> 'invites' -> 'groups')::text, '0', 'a declined invite disappears');
  perform test.login(b);
  perform test.throws(format('select public.remove_member(%L, %L)', g, a), 'can remove people', 'an admin cannot remove the owner');
  perform test.login(a);
  perform test.throws(format('select public.leave_group(%L)', g), 'cannot leave', 'the owner cannot leave her own group');
  perform public.rename_group(g, 'Home');

  -- Removing Carol: tasks assigned to her go back to their creators.
  perform test.login(c);
  res := public.sync_push(pc, jsonb_build_array(test.op('tasks', gen_random_uuid(), jsonb_build_object('title', 'Carol private', 'group_id', g, 'is_private', true), test.ts(60, pc))));
  perform test.login(a);
  res := public.sync_push(pa, jsonb_build_array(test.op('tasks', t4, jsonb_build_object('owner_id', c), test.ts(61, pa))));
  perform test.logout();
  select rev into rev_before from public.sync_state where user_id = c;
  perform test.login(a);
  perform public.remove_member(g, c);
  perform test.logout();
  perform test.ok((select owner_id is null from public.tasks where id = t4), 'a removed member''s tasks go back to their creator');
  perform test.ok((select deleted_at is not null from public.tasks where title = 'Carol private'), 'a private task only she could see is deleted');
  perform test.ok((select rev from public.sync_state where user_id = c) > rev_before, 'her devices are told to sync');
  perform test.login(c);
  perform test.eq(jsonb_array_length(public.sync_pull_groups('{}', 1000) -> 'member_of')::text, '0', 'her devices then drop the group');
  perform test.eq((select count(*) from public.tasks)::text, '0', 'and she can no longer read its tasks');
  perform test.login(a);
  rows := test.group_rows(g);
  perform test.ok((select r ->> 'deleted_at' from jsonb_each(rows -> 'group_members') e(k, r) where r ->> 'member_id' = c::text) is not null,
                  'members see her membership end');

  perform test.login(b);
  perform public.leave_group(g);
  perform test.eq(jsonb_array_length(public.sync_pull_groups('{}', 1000) -> 'member_of')::text, '0', 'Bob can leave');

  -- ------------------------------------------------------------ purge
  perform test.login(a);
  rows := test.group_rows(g);
  res := public.sync_push(pa, jsonb_build_array(test.op('tasks', t4, '{}', test.ts(70, pa), 'delete')));
  perform test.logout();
  update public.tasks set deleted_at = now() - interval '100 days' where id = t4;
  perform test.login_service();
  perform public.purge_expired(90);
  perform test.logout();
  perform test.ok((select purge_rev from public.group_sync_state where group_id = g) > 0, 'purging a group''s tombstones moves the group''s purge mark');
  perform test.ok(not exists (select 1 from public.tasks where id = t4), 'the old tombstone is gone');
  perform test.login(a);
  perform test.eq(test.group_rows(g, 1000, 1)::text, '{"reset": true}', 'a device behind the purge mark is told to start the group over');

  -- ------------------------------------------------------------ deleting
  perform test.login(b);
  perform test.throws(format('select public.delete_group(%L)', g), 'Only the group''s owner', 'only the owner can delete the group');
  perform test.login(a);
  perform public.delete_group(g);
  perform test.eq(jsonb_array_length(public.sync_pull_groups('{}', 1000) -> 'member_of')::text, '0', 'the deleted group is gone from Alice''s list');
  perform test.logout();
  perform test.eq((select count(*) from public.tasks where group_id = g)::text, '0', 'and its tasks are deleted with it');
  perform test.eq((select count(*) from public.subtasks where id = p_sub)::text, '0', 'children included');
end;
$$;
