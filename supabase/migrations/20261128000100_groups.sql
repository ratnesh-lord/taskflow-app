-- TaskFlow migration 8: usernames, groups and shared tasks
--
-- What this adds, in plain terms:
--   * Every account can claim a username (3 to 20 lower-case letters, digits
--     or underscores). Other people only ever see the username and the
--     display name, never the email address.
--   * A group is a small circle of people. Its creator (role "owner") invites
--     people by username; an invite waits until the person accepts. The owner
--     can make members admins; owners and admins can invite and remove.
--   * A task can belong to a group. Every member sees it, unless it is marked
--     private: then only the person who created it and the person it is
--     assigned to (its "owner") see it. Only those two can change it.
--   * Subtasks, reminders and repeat history of a group task belong to the
--     group too. Tags, attachments and calendar links stay personal.
--
-- How syncing works for groups:
--   A user's personal rows keep the per-user revision counter (sync_state).
--   Rows that belong to a group take their revision from a per-group counter
--   (group_sync_state) instead, so every member can pull "everything in this
--   group after revision N" exactly as they pull their own rows. sync_pull now
--   leaves group rows out; sync_pull_groups returns them, one page per group.
--   A row the caller may not see (a private task, or a child of one) comes
--   back as { id, rev, hidden: true }, so a device that had it removes it.
--
-- Groups and memberships are never written by sync_push (they are not in
-- sync_tables()); only the functions at the end of this file change them.

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column username text
    constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$');
create unique index profiles_username_idx on public.profiles (username) where username is not null;

-- A username only changes through claim_username, never through sync_push.
create function private.guard_username() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is distinct from old.username
     and coalesce(current_setting('taskflow.trusted', true), '') <> 'on' then
    new.username := old.username;
  end if;
  return new;
end;
$$;

create trigger guard_username before update on public.profiles
  for each row execute function private.guard_username();

-- A timestamp for edits made by the server itself, in the same format as a
-- device's, so they merge field by field like any other edit.
create function private.server_ts() returns text
language sql
volatile
set search_path = ''
as $$
  select lpad(floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text, 15, '0')
         || ':00000:00000000-0000-0000-0000-000000000000'
$$;

-- Trusted mode: the functions in this file switch it on while they make
-- changes on someone's behalf, which the edit rules below then allow.
create function private.set_trusted(p_on boolean) returns void
language sql
set search_path = ''
as $$
  select pg_catalog.set_config('taskflow.trusted', case when p_on then 'on' else '' end, true);
$$;

create function private.is_trusted() returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('taskflow.trusted', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- Groups, members and the per-group revision counter
-- ---------------------------------------------------------------------------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rev        bigint not null default 0,

  name       text not null check (char_length(name) between 1 and 100)
);

create table public.group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups (id) on delete cascade,
  member_id    uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  rev          bigint not null default 0,

  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status       text not null default 'invited' check (status in ('invited', 'active')),
  -- Copied from the member's profile (and kept up to date), so members see
  -- each other's names without being able to read each other's profiles.
  username     text not null default '',
  display_name text not null default '',
  invited_by   uuid references auth.users (id) on delete set null,

  unique (group_id, member_id)
);
create index group_members_member_idx on public.group_members (member_id) where deleted_at is null;
create index group_members_rev_idx on public.group_members (group_id, rev);

create table public.group_sync_state (
  -- Checked at commit: a new group's first revision is taken just before its row exists.
  group_id      uuid primary key references public.groups (id) on delete cascade deferrable initially deferred,
  rev           bigint not null default 0,
  purge_rev     bigint not null default 0,
  origin_device uuid,
  updated_at    timestamptz not null default now()
);
comment on table public.group_sync_state is
  'Current revision per group. Members watch it over Realtime and pull the group when it changes.';

-- Nothing here is readable or writable directly except the counter, which
-- members may read (that is what Realtime needs).
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_sync_state enable row level security;
revoke all on public.groups, public.group_members, public.group_sync_state from anon, authenticated;
grant select on public.group_sync_state to authenticated;

-- Is the signed-in user an active member of the group?
create function private.is_member(p_group uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group
       and m.member_id = (select auth.uid())
       and m.status = 'active'
       and m.deleted_at is null)
$$;

create function private.is_active_member(p_group uuid, p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = p_group and m.member_id = p_user and m.status = 'active' and m.deleted_at is null)
$$;

-- May the signed-in user see this group task (given its group, creator, owner and privacy)?
create function private.task_visible(p_group uuid, p_creator uuid, p_owner uuid, p_private boolean) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_group)
     and (not p_private or p_creator = (select auth.uid()) or p_owner = (select auth.uid()))
$$;

create policy group_sync_state_select_member on public.group_sync_state
  for select to authenticated
  using (private.is_member(group_id));

-- Next revision of a group (takes the counter's row lock until commit, so a
-- group's writers queue up and its revisions commit in order).
create function private.bump_group(p_group uuid) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev bigint;
begin
  insert into public.group_sync_state as s (group_id, rev, origin_device, updated_at)
  values (p_group, 1, nullif(current_setting('app.device_id', true), '')::uuid, now())
  on conflict (group_id) do update
    set rev = s.rev + 1,
        origin_device = excluded.origin_device,
        updated_at = now()
  returning s.rev into v_rev;
  return v_rev;
end;
$$;

-- Tell every device of a user to sync: an invite arrived, or a membership
-- ended. Their personal revision moves without any row changing.
create function private.nudge_user(p_user uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_state as s (user_id, rev, origin_device, updated_at)
  values (p_user, 1, null, now())
  on conflict (user_id) do update set rev = s.rev + 1, origin_device = null, updated_at = now();
$$;

-- Trigger for groups and group_members: stamp the group's next revision.
-- The trigger argument names the column holding the group id.
create function private.group_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
  end if;
  new.rev := private.bump_group((to_jsonb(new) ->> tg_argv[0])::uuid);
  new.updated_at := now();
  return new;
end;
$$;

create trigger sync_touch before insert or update on public.groups
  for each row execute function private.group_touch('id');
create trigger sync_touch before insert or update on public.group_members
  for each row execute function private.group_touch('group_id');

-- ---------------------------------------------------------------------------
-- Group tasks
--   tasks.group_id    the group, or null for a personal task. Once set it
--                     never changes (a personal task may move into a group).
--   tasks.owner_id    who it is assigned to; null means its creator has it.
--   tasks.is_private  only creator and owner see it.
--   tasks.created_by  who created it (user_id, kept for devices, which
--                     never receive user_id).
--   tasks.previous_owner_id  who had it before the last reassignment. Postgres
--                     checks that a changed row is still readable by whoever
--                     changed it; this lets the owner of a private task hand
--                     it on (or back) without being refused for it.
-- Children carry group_id too, copied from their task by a trigger.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column group_id   uuid references public.groups (id) on delete cascade,
  add column owner_id   uuid references auth.users (id) on delete set null,
  add column is_private boolean not null default false,
  add column created_by uuid,
  add column previous_owner_id uuid;
alter table public.subtasks add column group_id uuid;
alter table public.reminders add column group_id uuid;
alter table public.task_occurrences add column group_id uuid;

create index tasks_group_rev_idx on public.tasks (group_id, rev) where group_id is not null;
create index tasks_owner_idx on public.tasks (owner_id) where owner_id is not null;
create index subtasks_group_rev_idx on public.subtasks (group_id, rev) where group_id is not null;
create index reminders_group_rev_idx on public.reminders (group_id, rev) where group_id is not null;
create index task_occurrences_group_rev_idx on public.task_occurrences (group_id, rev) where group_id is not null;

-- May the signed-in user see the group task with this id?
create function private.can_see_task(p_task uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task and t.group_id is not null
       and private.task_visible(t.group_id, t.user_id, t.owner_id, t.is_private))
$$;

-- A focus session or a calendar link stays personal even when its task is a
-- group task someone else created, so these two now point at the task alone.
alter table public.focus_sessions
  drop constraint focus_sessions_task_fk,
  add constraint focus_sessions_task_fk foreign key (task_id)
    references public.tasks (id) on delete set null;
alter table public.calendar_links
  drop constraint calendar_links_task_fk,
  add constraint calendar_links_task_fk foreign key (task_id)
    references public.tasks (id) on delete cascade;

-- In their place, a check that the task is one the row's user may see.
create function private.task_link_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.task_id is null or (tg_op = 'UPDATE' and new.task_id is not distinct from old.task_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.tasks t
     where t.id = new.task_id
       and ((t.group_id is null and t.user_id = new.user_id)
            or (t.group_id is not null
                and private.is_active_member(t.group_id, new.user_id)
                and (not t.is_private or t.user_id = new.user_id or t.owner_id = new.user_id)))) then
    raise exception 'insert or update on table "%" violates foreign key: no such task for this user', tg_table_name
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger group_rules before insert or update on public.focus_sessions
  for each row execute function private.task_link_rules();
create trigger group_rules before insert or update on public.calendar_links
  for each row execute function private.task_link_rules();

-- Rules for a task, before it is written.
create function private.task_group_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := new.user_id;
    new.previous_owner_id := null;
  else
    new.created_by := coalesce(old.created_by, old.user_id);
    new.previous_owner_id := case when new.owner_id is distinct from old.owner_id
                                  then old.owner_id else old.previous_owner_id end;
    if old.group_id is not null then
      new.group_id := old.group_id;
      if v_uid is not null and not private.is_trusted()
         and v_uid is distinct from old.user_id and v_uid is distinct from old.owner_id then
        raise exception 'only the person who created this task or the person it is assigned to can change it'
          using errcode = '42501';
      end if;
    end if;
  end if;

  if new.group_id is null then
    new.owner_id := null;
    new.is_private := false;
  else
    -- Projects, categories and goals are personal, so a group task has none.
    new.project_id := null;
    new.category_id := null;
    new.goal_id := null;
    -- Assigned to someone who is not (or no longer) a member: back to its creator.
    if new.owner_id is not null and not private.is_active_member(new.group_id, new.owner_id) then
      new.owner_id := null;
    end if;
  end if;
  return new;
end;
$$;

-- Trigger names sort before sync_touch, so these run first and sync_touch
-- sees the final group_id.
create trigger group_rules before insert or update on public.tasks
  for each row execute function private.task_group_rules();

-- After a task changes: a task moved into a group brings its children; a
-- change of privacy or of who can see a private task re-sends the children,
-- so members' devices show or hide them along with the task.
create function private.task_group_cascade() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := private.is_trusted();
begin
  if new.group_id is null then
    return null;
  end if;
  if old.group_id is null
     or old.is_private is distinct from new.is_private
     or ((old.is_private or new.is_private) and old.owner_id is distinct from new.owner_id) then
    perform private.set_trusted(true);
    update public.subtasks set group_id = new.group_id where task_id = new.id;
    update public.reminders set group_id = new.group_id where task_id = new.id;
    update public.task_occurrences set group_id = new.group_id where task_id = new.id;
    perform private.set_trusted(v_was);
  end if;
  return null;
end;
$$;

create trigger group_cascade after update on public.tasks
  for each row execute function private.task_group_cascade();

-- Rules for a subtask, reminder or repeat record: it belongs to its task's
-- group, carries the task's user_id (so the existing foreign keys hold), and
-- in a group only the task's creator or owner may write it.
create function private.child_group_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_creator uuid;
  v_group   uuid;
  v_owner   uuid;
begin
  select t.user_id, t.group_id, t.owner_id into v_creator, v_group, v_owner
    from public.tasks t where t.id = new.task_id;
  if not found then
    return new;  -- the foreign key reports it
  end if;

  new.group_id := v_group;
  if v_group is not null then
    if tg_op = 'INSERT' then
      new.user_id := v_creator;
    end if;
    if v_uid is not null and not private.is_trusted()
       and v_uid is distinct from v_creator and v_uid is distinct from v_owner then
      raise exception 'only the person who created this task or the person it is assigned to can change it'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger group_rules before insert or update on public.subtasks
  for each row execute function private.child_group_rules();
create trigger group_rules before insert or update on public.reminders
  for each row execute function private.child_group_rules();
create trigger group_rules before insert or update on public.task_occurrences
  for each row execute function private.child_group_rules();

-- Revisions for these four tables: the group's counter for group rows, the
-- owner's counter otherwise.
create function private.sync_touch_grouped() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid := nullif(current_setting('app.device_id', true), '')::uuid;
  v_group  uuid := (to_jsonb(new) ->> 'group_id')::uuid;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.user_id := old.user_id;
  end if;

  if v_group is not null then
    new.rev := private.bump_group(v_group);
  else
    insert into public.sync_state as s (user_id, rev, origin_device, updated_at)
    values (new.user_id, 1, v_device, now())
    on conflict (user_id) do update
      set rev = s.rev + 1,
          origin_device = excluded.origin_device,
          updated_at = now()
    returning s.rev into new.rev;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['tasks', 'subtasks', 'reminders', 'task_occurrences'] loop
    execute format('drop trigger sync_touch on public.%I', t);
    execute format(
      'create trigger sync_touch before insert or update on public.%I for each row execute function private.sync_touch_grouped()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security for the four tables, replacing "own rows only":
--   personal rows   the owner, as before
--   group rows      members see them (private ones: creator and owner only);
--                   who may change them is checked by the triggers above
-- ---------------------------------------------------------------------------
drop policy tasks_select_own on public.tasks;
drop policy tasks_insert_own on public.tasks;
drop policy tasks_update_own on public.tasks;

create policy tasks_select on public.tasks for select to authenticated
  using ((group_id is null and user_id = (select auth.uid()))
         or (group_id is not null and private.task_visible(group_id, user_id, owner_id, is_private))
         or (group_id is not null and previous_owner_id = (select auth.uid()) and private.is_member(group_id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()) and (group_id is null or private.is_member(group_id)));
create policy tasks_update on public.tasks for update to authenticated
  using ((group_id is null and user_id = (select auth.uid()))
         or (group_id is not null and private.task_visible(group_id, user_id, owner_id, is_private)))
  with check ((group_id is null and user_id = (select auth.uid()))
              or (group_id is not null and private.is_member(group_id)));

do $$
declare
  t text;
  v_rule text := '(group_id is null and user_id = (select auth.uid())) '
                 'or (group_id is not null and private.can_see_task(task_id))';
begin
  foreach t in array array['subtasks', 'reminders', 'task_occurrences'] loop
    execute format('drop policy %I on public.%I', t || '_select_own', t);
    execute format('drop policy %I on public.%I', t || '_insert_own', t);
    execute format('drop policy %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, v_rule);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, v_rule);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   t || '_update', t, v_rule, v_rule);
  end loop;
end;
$$;

-- Members' names follow their profile.
create function private.profile_to_members() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.group_members m
     set username = coalesce(new.username, ''), display_name = new.name
   where m.member_id = new.id
     and m.deleted_at is null
     and (m.username is distinct from coalesce(new.username, '') or m.display_name is distinct from new.name);
  return null;
end;
$$;

create trigger profile_to_members after update of username, name on public.profiles
  for each row execute function private.profile_to_members();

-- ---------------------------------------------------------------------------
-- sync_pull: as before, but group rows are left out (sync_pull_groups has them).
-- ---------------------------------------------------------------------------
create or replace function public.sync_pull(p_since bigint default 0, p_limit integer default 1000) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  c_grouped constant text[] := array['tasks', 'subtasks', 'reminders', 'task_occurrences'];
  v_uid     uuid := (select auth.uid());
  v_rev     bigint;
  v_purge   bigint;
  v_upto    bigint;
  v_union   text;
  v_table   text;
  v_rows    jsonb;
  v_changes jsonb := '{}'::jsonb;
begin
  if v_uid is null then
    raise exception 'sync_pull: not signed in' using errcode = '42501';
  end if;
  p_since := greatest(coalesce(p_since, 0), 0);
  p_limit := least(greatest(coalesce(p_limit, 1000), 1), 5000);

  select s.rev, s.purge_rev into v_rev, v_purge
    from public.sync_state s where s.user_id = v_uid;
  v_rev := coalesce(v_rev, 0);
  v_purge := coalesce(v_purge, 0);

  if p_since > v_rev or (p_since > 0 and p_since < v_purge) then
    return jsonb_build_object('reset', true, 'rev', v_rev);
  end if;

  select string_agg(
           format('select x.rev from public.%I x where x.user_id = $1 and x.rev > $2%s', t,
                  case when t = any (c_grouped) then ' and x.group_id is null' else '' end),
           ' union all ')
    into v_union
    from unnest(public.sync_tables()) as t;

  execute format('select u.rev from (%s) u order by u.rev offset $3 limit 1', v_union)
    into v_upto using v_uid, p_since, p_limit - 1;
  v_upto := coalesce(v_upto, v_rev);

  foreach v_table in array public.sync_tables() loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) - ''user_id'' order by x.rev), ''[]''::jsonb) '
      'from public.%I x where x.user_id = $1 and x.rev > $2 and x.rev <= $3%s', v_table,
      case when v_table = any (c_grouped) then ' and x.group_id is null' else '' end)
      into v_rows using v_uid, p_since, v_upto;
    if jsonb_array_length(v_rows) > 0 then
      v_changes := v_changes || jsonb_build_object(v_table, v_rows);
    end if;
  end loop;

  return jsonb_build_object(
    'reset', false,
    'changes', v_changes,
    'next_since', v_upto,
    'rev', v_rev,
    'has_more', v_upto < v_rev);
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_pull_groups(cursors, limit): the caller's groups, each from its own
-- revision.
--
--   cursors  { "<group id>": <last revision pulled>, ... }  (missing = 0)
--
-- Returns
--   { pages: [ { id, reset: true, rev }
--            | { id, reset: false, changes: { table: [rows] }, next_since, rev, has_more } ],
--     member_of: [group ids],
--     invites: { groups: [rows], group_members: [rows] } }
--
-- A device drops a group it has locally that is in neither member_of nor
-- invites. Rows the caller may not see come back as { id, rev, hidden: true }.
-- Runs as the database owner (it has to read rows it then hides), so every
-- query below filters by the caller's memberships itself.
-- ---------------------------------------------------------------------------
create function public.sync_pull_groups(p_cursors jsonb default '{}'::jsonb, p_limit integer default 1000) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_group    record;
  v_since    bigint;
  v_upto     bigint;
  v_rows     jsonb;
  v_changes  jsonb;
  v_pages    jsonb := '[]'::jsonb;
  v_member   jsonb := '[]'::jsonb;
  v_visible  text := '(not t.is_private or t.user_id = $4 or t.owner_id = $4)';
  v_table    text;
begin
  if v_uid is null then
    raise exception 'sync_pull_groups: not signed in' using errcode = '42501';
  end if;
  if p_cursors is null or jsonb_typeof(p_cursors) <> 'object' then
    p_cursors := '{}'::jsonb;
  end if;
  p_limit := least(greatest(coalesce(p_limit, 1000), 1), 5000);

  for v_group in
    select m.group_id as id, coalesce(s.rev, 0) as rev, coalesce(s.purge_rev, 0) as purge_rev
      from public.group_members m
      left join public.group_sync_state s on s.group_id = m.group_id
     where m.member_id = v_uid and m.status = 'active' and m.deleted_at is null
     order by m.group_id
  loop
    v_member := v_member || to_jsonb(v_group.id::text);
    v_since := case when jsonb_typeof(p_cursors -> v_group.id::text) = 'number'
                    then greatest(floor((p_cursors ->> v_group.id::text)::numeric)::bigint, 0) else 0 end;

    if v_since > v_group.rev or (v_since > 0 and v_since < v_group.purge_rev) then
      v_pages := v_pages || jsonb_build_array(jsonb_build_object('id', v_group.id, 'reset', true, 'rev', v_group.rev));
      continue;
    end if;
    if v_since = v_group.rev then
      continue;  -- nothing new in this group
    end if;

    select u.rev into v_upto from (
      select x.rev from public.groups x where x.id = v_group.id and x.rev > v_since
      union all select x.rev from public.group_members x where x.group_id = v_group.id and x.rev > v_since
      union all select x.rev from public.tasks x where x.group_id = v_group.id and x.rev > v_since
      union all select x.rev from public.subtasks x where x.group_id = v_group.id and x.rev > v_since
      union all select x.rev from public.reminders x where x.group_id = v_group.id and x.rev > v_since
      union all select x.rev from public.task_occurrences x where x.group_id = v_group.id and x.rev > v_since
    ) u order by u.rev offset p_limit - 1 limit 1;
    v_upto := coalesce(v_upto, v_group.rev);

    v_changes := '{}'::jsonb;

    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
      from public.groups x where x.id = v_group.id and x.rev > v_since and x.rev <= v_upto;
    if jsonb_array_length(v_rows) > 0 then v_changes := v_changes || jsonb_build_object('groups', v_rows); end if;

    select coalesce(jsonb_agg(to_jsonb(x) order by x.rev), '[]'::jsonb) into v_rows
      from public.group_members x where x.group_id = v_group.id and x.rev > v_since and x.rev <= v_upto;
    if jsonb_array_length(v_rows) > 0 then v_changes := v_changes || jsonb_build_object('group_members', v_rows); end if;

    execute format(
      'select coalesce(jsonb_agg(case when %s then to_jsonb(t) - ''user_id'' '
      'else jsonb_build_object(''id'', t.id, ''rev'', t.rev, ''hidden'', true) end order by t.rev), ''[]''::jsonb) '
      'from public.tasks t where t.group_id = $1 and t.rev > $2 and t.rev <= $3', v_visible)
      into v_rows using v_group.id, v_since, v_upto, v_uid;
    if jsonb_array_length(v_rows) > 0 then v_changes := v_changes || jsonb_build_object('tasks', v_rows); end if;

    foreach v_table in array array['subtasks', 'reminders', 'task_occurrences'] loop
      execute format(
        'select coalesce(jsonb_agg(case when %s then to_jsonb(x) - ''user_id'' '
        'else jsonb_build_object(''id'', x.id, ''rev'', x.rev, ''hidden'', true) end order by x.rev), ''[]''::jsonb) '
        'from public.%I x join public.tasks t on t.id = x.task_id '
        'where x.group_id = $1 and x.rev > $2 and x.rev <= $3', v_visible, v_table)
        into v_rows using v_group.id, v_since, v_upto, v_uid;
      if jsonb_array_length(v_rows) > 0 then v_changes := v_changes || jsonb_build_object(v_table, v_rows); end if;
    end loop;

    v_pages := v_pages || jsonb_build_array(jsonb_build_object(
      'id', v_group.id, 'reset', false, 'changes', v_changes,
      'next_since', v_upto, 'rev', v_group.rev, 'has_more', v_upto < v_group.rev));
  end loop;

  return jsonb_build_object(
    'pages', v_pages,
    'member_of', v_member,
    'invites', jsonb_build_object(
      'groups', coalesce((
        select jsonb_agg(to_jsonb(g))
          from public.group_members m join public.groups g on g.id = m.group_id
         where m.member_id = v_uid and m.status = 'invited' and m.deleted_at is null), '[]'::jsonb),
      'group_members', coalesce((
        select jsonb_agg(to_jsonb(m) || jsonb_build_object(
                 'invited_by_name', coalesce(inv.display_name, ''),
                 'invited_by_username', coalesce(inv.username, '')))
          from public.group_members m
          left join public.group_members inv on inv.group_id = m.group_id and inv.member_id = m.invited_by
         where m.member_id = v_uid and m.status = 'invited' and m.deleted_at is null), '[]'::jsonb)));
end;
$$;

revoke all on function public.sync_pull_groups(jsonb, integer) from public, anon;
grant execute on function public.sync_pull_groups(jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- purge_expired: as before, except that tombstones in a group advance the
-- group's purge_rev (not the creator's), and ended memberships are purged.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired(p_keep_days integer default 90) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_grouped constant text[] := array['tasks', 'subtasks', 'reminders', 'task_occurrences'];
  v_cutoff timestamptz;
  v_table  text;
  v_rows   bigint;
  v_total  bigint := 0;
begin
  if p_keep_days is null or p_keep_days < 1 then
    raise exception 'purge_expired: keep at least 1 day' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_keep_days);

  -- Children before parents.
  for v_table in
    select t from unnest(public.sync_tables()) with ordinality as u (t, n)
     where t <> 'profiles' order by n desc
  loop
    if v_table = any (c_grouped) then
      execute format($q$
        with gone as (
          delete from public.%I where deleted_at is not null and deleted_at < $1
          returning user_id, group_id, rev
        ), per_user as (
          select user_id, max(rev) as rev from gone where group_id is null group by user_id
        ), per_group as (
          select group_id, max(rev) as rev from gone where group_id is not null group by group_id
        ), marked_users as (
          update public.sync_state s set purge_rev = greatest(s.purge_rev, p.rev)
            from per_user p where s.user_id = p.user_id
          returning 1
        ), marked_groups as (
          update public.group_sync_state s set purge_rev = greatest(s.purge_rev, p.rev)
            from per_group p where s.group_id = p.group_id
          returning 1
        )
        select count(*) from gone
      $q$, v_table) into v_rows using v_cutoff;
    else
      execute format($q$
        with gone as (
          delete from public.%I where deleted_at is not null and deleted_at < $1
          returning user_id, rev
        ), per_user as (
          select user_id, max(rev) as rev, count(*) as n from gone group by user_id
        ), marked as (
          update public.sync_state s
             set purge_rev = greatest(s.purge_rev, p.rev)
            from per_user p
           where s.user_id = p.user_id
          returning 1
        )
        select coalesce(sum(n), 0) from per_user
      $q$, v_table) into v_rows using v_cutoff;
    end if;
    v_total := v_total + v_rows;
  end loop;

  with gone as (
    delete from public.group_members where deleted_at is not null and deleted_at < v_cutoff
    returning group_id, rev
  ), per_group as (
    select group_id, max(rev) as rev from gone group by group_id
  ), marked as (
    update public.group_sync_state s set purge_rev = greatest(s.purge_rev, p.rev)
      from per_group p where s.group_id = p.group_id
    returning 1
  )
  select count(*) into v_rows from gone;
  v_total := v_total + v_rows;

  delete from public.change_history where changed_at < v_cutoff;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Live updates: members watch their groups' counters.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_sync_state')
  then
    alter publication supabase_realtime add table public.group_sync_state;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The functions the app calls. Each checks who is asking, then acts with the
-- database owner's rights. Errors are written for people.
-- ---------------------------------------------------------------------------

create function private.require_user() returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'You are not signed in' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- The caller's role in a group, or null when not an active member.
create function private.my_role(p_group uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.group_members m
   where m.group_id = p_group and m.member_id = (select auth.uid())
     and m.status = 'active' and m.deleted_at is null
$$;

-- A member leaves (or is removed): their membership ends, tasks assigned to
-- them go back to their creators, and private tasks only they could see are
-- deleted, since nobody left in the group could see them.
create function private.end_membership(p_group uuid, p_member uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ts text := private.server_ts();
begin
  perform private.set_trusted(true);
  update public.group_members
     set deleted_at = now()
   where group_id = p_group and member_id = p_member and deleted_at is null;

  update public.tasks
     set owner_id = null, field_ts = field_ts || jsonb_build_object('owner_id', v_ts)
   where group_id = p_group and owner_id = p_member;

  update public.tasks
     set deleted_at = now(), field_ts = field_ts || jsonb_build_object('deleted_at', v_ts)
   where group_id = p_group and user_id = p_member and is_private and owner_id is null and deleted_at is null;

  perform private.nudge_user(p_member);
  perform private.set_trusted(false);
end;
$$;

-- claim_username(name): set or change the caller's username. Returns it.
create function public.claim_username(p_username text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := lower(btrim(coalesce(p_username, '')));
begin
  if v_name !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'A username is 3 to 20 characters: letters, digits or _' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.username = v_name and p.id <> v_uid) then
    raise exception 'That username is taken' using errcode = '23505';
  end if;
  perform private.set_trusted(true);
  begin
    update public.profiles set username = v_name,
           field_ts = field_ts || jsonb_build_object('username', private.server_ts())
     where id = v_uid and username is distinct from v_name;
  exception when unique_violation then
    raise exception 'That username is taken' using errcode = '23505';
  end;
  perform private.set_trusted(false);
  return v_name;
end;
$$;

-- find_user(name): the person with exactly this username, as
-- { username, name }, or null. Never an email address or an id.
create function public.find_user(p_username text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null then null else (
    select jsonb_build_object('username', p.username, 'name', p.name)
      from public.profiles p
     where p.username = lower(btrim(coalesce(p_username, '')))) end
$$;

-- create_group(name): a new group with the caller as its owner. Returns its id.
create function public.create_group(p_name text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.require_user();
  v_name    text := btrim(coalesce(p_name, ''));
  v_profile record;
  v_id      uuid;
begin
  select p.username, p.name into v_profile from public.profiles p where p.id = v_uid;
  if v_profile.username is null then
    raise exception 'Choose a username first (More, then Account)' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'A group name is 1 to 100 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.group_members m
       where m.member_id = v_uid and m.status = 'active' and m.deleted_at is null) >= 50 then
    raise exception 'You can be in at most 50 groups' using errcode = '22023';
  end if;

  insert into public.groups (created_by, name) values (v_uid, v_name) returning id into v_id;
  insert into public.group_members (group_id, member_id, role, status, username, display_name, invited_by)
  values (v_id, v_uid, 'owner', 'active', v_profile.username, v_profile.name, v_uid);
  return v_id;
end;
$$;

-- invite_to_group(group, username): owners and admins invite by username.
create function public.invite_to_group(p_group uuid, p_username text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_role   text := private.my_role(p_group);
  v_target record;
  v_row    record;
begin
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Only the group''s owner or an admin can invite people' using errcode = '42501';
  end if;
  select p.id, p.username, p.name into v_target
    from public.profiles p where p.username = lower(btrim(coalesce(p_username, '')));
  if v_target.id is null then
    raise exception 'Nobody has the username %', lower(btrim(coalesce(p_username, ''))) using errcode = '22023';
  end if;
  if v_target.id = v_uid then
    raise exception 'You are already in this group' using errcode = '22023';
  end if;
  if (select count(*) from public.group_members m where m.group_id = p_group and m.deleted_at is null) >= 50 then
    raise exception 'A group can have at most 50 people, invitations included' using errcode = '22023';
  end if;

  select m.status, m.deleted_at into v_row
    from public.group_members m where m.group_id = p_group and m.member_id = v_target.id;
  if found and v_row.deleted_at is null then
    raise exception '% is already %', v_target.username,
      case when v_row.status = 'active' then 'a member' else 'invited' end using errcode = '22023';
  end if;

  insert into public.group_members as m (group_id, member_id, role, status, username, display_name, invited_by)
  values (p_group, v_target.id, 'member', 'invited', v_target.username, v_target.name, v_uid)
  on conflict (group_id, member_id) do update
    set role = 'member', status = 'invited', deleted_at = null, invited_by = v_uid,
        username = excluded.username, display_name = excluded.display_name, created_at = now();
  perform private.nudge_user(v_target.id);
end;
$$;

-- respond_to_invite(group, accept): join the group, or turn the invite down.
create function public.respond_to_invite(p_group uuid, p_accept boolean) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if not exists (select 1 from public.group_members m
                  where m.group_id = p_group and m.member_id = v_uid
                    and m.status = 'invited' and m.deleted_at is null) then
    raise exception 'This invitation is no longer open' using errcode = '22023';
  end if;
  if p_accept then
    if (select count(*) from public.group_members m
         where m.member_id = v_uid and m.status = 'active' and m.deleted_at is null) >= 50 then
      raise exception 'You can be in at most 50 groups' using errcode = '22023';
    end if;
    update public.group_members set status = 'active'
     where group_id = p_group and member_id = v_uid;
  else
    update public.group_members set deleted_at = now()
     where group_id = p_group and member_id = v_uid;
  end if;
end;
$$;

-- remove_member(group, member): the owner removes anyone else; an admin
-- removes ordinary members. Also withdraws an invitation.
create function public.remove_member(p_group uuid, p_member uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_role   text := private.my_role(p_group);
  v_target text;
begin
  select m.role into v_target from public.group_members m
   where m.group_id = p_group and m.member_id = p_member and m.deleted_at is null;
  if v_target is null then
    raise exception 'That person is not in this group' using errcode = '22023';
  end if;
  if p_member = v_uid then
    raise exception 'To leave a group, use Leave' using errcode = '22023';
  end if;
  if v_role = 'owner' or (v_role = 'admin' and v_target = 'member') then
    perform private.end_membership(p_group, p_member);
  else
    raise exception 'Only the group''s owner, or an admin for ordinary members, can remove people'
      using errcode = '42501';
  end if;
end;
$$;

-- leave_group(group): an admin or member leaves. The owner deletes the group instead.
create function public.leave_group(p_group uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_user();
  v_role text := private.my_role(p_group);
begin
  if v_role is null then
    raise exception 'You are not in this group' using errcode = '22023';
  end if;
  if v_role = 'owner' then
    raise exception 'The owner cannot leave; delete the group instead' using errcode = '22023';
  end if;
  perform private.end_membership(p_group, v_uid);
end;
$$;

-- set_member_role(group, member, role): the owner makes a member an admin or back.
create function public.set_member_role(p_group uuid, p_member uuid, p_role text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_user();
begin
  if private.my_role(p_group) is distinct from 'owner' then
    raise exception 'Only the group''s owner can change roles' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'A role is admin or member' using errcode = '22023';
  end if;
  if p_member = v_uid then
    raise exception 'The owner stays the owner' using errcode = '22023';
  end if;
  update public.group_members set role = p_role
   where group_id = p_group and member_id = p_member and status = 'active'
     and deleted_at is null and role is distinct from p_role;
  if not found and not exists (select 1 from public.group_members m
                                where m.group_id = p_group and m.member_id = p_member
                                  and m.status = 'active' and m.deleted_at is null) then
    raise exception 'That person is not a member of this group' using errcode = '22023';
  end if;
end;
$$;

-- rename_group(group, name): owner or admin.
create function public.rename_group(p_group uuid, p_name text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := private.require_user();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if coalesce(private.my_role(p_group), '') not in ('owner', 'admin') then
    raise exception 'Only the group''s owner or an admin can rename it' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'A group name is 1 to 100 characters' using errcode = '22023';
  end if;
  update public.groups set name = v_name where id = p_group and name is distinct from v_name;
end;
$$;

-- delete_group(group): the owner deletes the group and every task in it, at
-- once and for good. Everyone's devices drop it at their next sync.
create function public.delete_group(p_group uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.require_user();
  v_member uuid;
begin
  if private.my_role(p_group) is distinct from 'owner' then
    raise exception 'Only the group''s owner can delete it' using errcode = '42501';
  end if;
  for v_member in
    select m.member_id from public.group_members m where m.group_id = p_group and m.deleted_at is null
  loop
    perform private.nudge_user(v_member);
  end loop;
  perform private.set_trusted(true);
  delete from public.groups where id = p_group;
  perform private.set_trusted(false);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'claim_username(text)', 'find_user(text)', 'create_group(text)', 'invite_to_group(uuid, text)',
    'respond_to_invite(uuid, boolean)', 'remove_member(uuid, uuid)', 'leave_group(uuid)',
    'set_member_role(uuid, uuid, text)', 'rename_group(uuid, text)', 'delete_group(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- The row-level security policies above call three helpers as the signed-in
-- user. Nothing else in the private schema becomes callable: execute is
-- withdrawn from everyone, then given back for these three only. (Trigger
-- functions are not called with the caller's rights, so they need no grant.)
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid) to authenticated;
grant execute on function private.task_visible(uuid, uuid, uuid, boolean) to authenticated;
grant execute on function private.can_see_task(uuid) to authenticated;
