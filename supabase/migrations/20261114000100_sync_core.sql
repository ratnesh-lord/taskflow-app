-- TaskFlow migration 1: sync core
--
-- Every synced table carries the same seven columns:
--   id          uuid, created on the device
--   user_id     owner; every policy checks it
--   created_at  when the row was created
--   updated_at  when the server last wrote the row
--   deleted_at  set instead of deleting the row (a tombstone)
--   rev         the owner's revision number at the row's last write
--   field_ts    last edit time per column, used to merge edits field by field
--
-- This file builds the machinery those columns rely on.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- sync_state: one row per user holding that user's current revision.
-- Updating this row takes a row lock that is held until commit, so a user's
-- writers queue up and revisions are committed in order. A pull that asks for
-- "everything after revision N" can therefore never skip a row.
-- ---------------------------------------------------------------------------
create table public.sync_state (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  rev           bigint not null default 0,
  purge_rev     bigint not null default 0,
  origin_device uuid,
  updated_at    timestamptz not null default now()
);

comment on table public.sync_state is
  'Current revision per user. Clients watch their row over Realtime and pull when it changes.';
comment on column public.sync_state.purge_rev is
  'Tombstones at or below this revision have been purged; a device behind it must resync from scratch.';

alter table public.sync_state enable row level security;
revoke all on public.sync_state from anon, authenticated;
grant select on public.sync_state to authenticated;

create policy sync_state_select_own on public.sync_state
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- change_history: the previous values of every changed field, kept 90 days.
-- This is what makes an overwritten edit recoverable.
-- ---------------------------------------------------------------------------
create table public.change_history (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  table_name text not null,
  row_id     uuid not null,
  old_values jsonb not null,
  device_id  uuid,
  changed_at timestamptz not null default now()
);

create index change_history_user_changed_idx on public.change_history (user_id, changed_at desc);
create index change_history_row_idx on public.change_history (row_id);

alter table public.change_history enable row level security;
revoke all on public.change_history from anon, authenticated;
grant select on public.change_history to authenticated;

create policy change_history_select_own on public.change_history
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Trigger: stamp every write with the owner's next revision.
-- ---------------------------------------------------------------------------
create function private.sync_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid := nullif(current_setting('app.device_id', true), '')::uuid;
begin
  if tg_op = 'UPDATE' then
    -- Identity never changes after insert.
    new.id := old.id;
    new.user_id := old.user_id;
  end if;

  insert into public.sync_state as s (user_id, rev, origin_device, updated_at)
  values (new.user_id, 1, v_device, now())
  on conflict (user_id) do update
    set rev = s.rev + 1,
        origin_device = excluded.origin_device,
        updated_at = now()
  returning s.rev into new.rev;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: record the previous value of every field an update changed.
-- ---------------------------------------------------------------------------
create function private.sync_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old  jsonb := to_jsonb(old);
  v_new  jsonb := to_jsonb(new);
  v_diff jsonb;
begin
  select jsonb_object_agg(o.key, o.value)
    into v_diff
    from jsonb_each(v_old) as o
   where o.key not in ('rev', 'updated_at', 'field_ts')
     and (v_new -> o.key) is distinct from o.value;

  if v_diff is not null then
    insert into public.change_history (user_id, table_name, row_id, old_values, device_id)
    values (new.user_id, tg_table_name, new.id, v_diff,
            nullif(current_setting('app.device_id', true), '')::uuid);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- private.sync_enable(table): turn a table into a synced table.
--   * row-level security, with one owner check per operation
--   * no delete permission for the app (rows are tombstoned, never removed)
--   * revision and history triggers
--   * the (user_id, rev) index that pulls use
-- ---------------------------------------------------------------------------
create function private.sync_enable(p_table text) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('revoke all on public.%I from anon, authenticated', p_table);
  execute format('grant select, insert, update on public.%I to authenticated', p_table);

  execute format(
    'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
    p_table || '_select_own', p_table);
  execute format(
    'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
    p_table || '_insert_own', p_table);
  execute format(
    'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
    p_table || '_update_own', p_table);

  execute format(
    'create trigger sync_touch before insert or update on public.%I for each row execute function private.sync_touch()',
    p_table);
  execute format(
    'create trigger sync_history after update on public.%I for each row execute function private.sync_history()',
    p_table);

  execute format('create index %I on public.%I (user_id, rev)', p_table || '_user_rev_idx', p_table);
end;
$$;

-- The synced tables, parents before children. sync_pull and the purge job walk this list.
create function public.sync_tables() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'profiles', 'projects', 'categories', 'tags', 'tasks',
    'subtasks', 'reminders', 'task_occurrences', 'task_tags',
    'attachments', 'saved_filters', 'calendar_links'
  ]::text[];
$$;

revoke all on function public.sync_tables() from public, anon;
grant execute on function public.sync_tables() to authenticated, service_role;
