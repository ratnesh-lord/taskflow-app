-- TaskFlow migration 4: sync_push, sync_pull and the purge job
--
-- Timestamps on edits ("ts") are hybrid logical clock strings made on the
-- device:   <15-digit milliseconds since 1970>:<5-digit counter>:<device uuid>
-- They sort as plain text, and no two devices can produce the same one.

-- ---------------------------------------------------------------------------
-- sync_push(device, ops): apply a batch of edits from one device.
--
-- Each op is an object:
--   op_id     any id the device uses to match the result (optional)
--   table     one of public.sync_tables()
--   id        the row's uuid
--   kind      'upsert' (default), 'delete' or 'restore'
--   patch     { column: value, ... }   only the columns that changed
--   ts        the edit's timestamp, used for every column in the patch
--   field_ts  { column: ts }           optional per-column override of ts
--
-- Merge rule, per column: the edit wins if the row has no timestamp for that
-- column or the edit's timestamp is later. Otherwise the column is left alone.
-- Deleting is just an edit to deleted_at, so the same rule covers it.
--
-- Returns { results: [{ op_id, status, error? }], rev }, where status is
--   applied   at least one column was written
--   stale     every column already had a later edit
--   missing   delete or restore of a row that does not exist
--   rejected  the op was invalid; error says why. Other ops still run.
--
-- Runs with the caller's own permissions, so row-level security applies to
-- every statement in it.
-- ---------------------------------------------------------------------------
create function public.sync_push(p_device_id uuid, p_ops jsonb) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_protected constant text[] := array['id', 'user_id', 'rev', 'field_ts', 'updated_at'];
  c_ts_format constant text :=
    '^[0-9]{15}:[0-9]{5}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  v_uid      uuid := (select auth.uid());
  v_now_ms   bigint;
  v_max_ts   text;
  v_now_ts   text;
  v_op       jsonb;
  v_results  jsonb := '[]'::jsonb;
  v_table    text;
  v_id       uuid;
  v_kind     text;
  v_patch    jsonb;
  v_ts       text;
  v_fts      jsonb;
  v_allowed  text[];
  v_cache    jsonb := '{}'::jsonb;
  v_row_fts  jsonb;
  v_found    boolean;
  v_apply    jsonb;
  v_new_fts  jsonb;
  v_cols     text;
  v_key      text;
  v_t        text;
  v_count    integer;
  v_status   text;
  v_error    text;
begin
  if v_uid is null then
    raise exception 'sync_push: not signed in' using errcode = '42501';
  end if;
  if p_device_id is null then
    raise exception 'sync_push: device id is required' using errcode = '22023';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'sync_push: ops must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'sync_push: at most 500 ops per call' using errcode = '22023';
  end if;

  -- One push at a time per user, so two devices cannot deadlock on each other.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('taskflow.sync:' || v_uid::text, 0));
  perform pg_catalog.set_config('app.device_id', p_device_id::text, true);

  -- An edit stamped more than 10 minutes ahead of the server's clock is
  -- treated as made now. Without this, a phone with a wrong clock would win
  -- every merge until real time caught up with it.
  v_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_now_ts := lpad(v_now_ms::text, 15, '0');
  v_max_ts := lpad((v_now_ms + 600000)::text, 15, '0')
              || ':99999:ffffffff-ffff-ffff-ffff-ffffffffffff';

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_status := null;
    v_error := null;

    begin
      if jsonb_typeof(v_op) <> 'object' then
        raise exception 'op must be an object';
      end if;

      v_table := v_op ->> 'table';
      v_kind  := coalesce(v_op ->> 'kind', 'upsert');
      v_ts    := v_op ->> 'ts';
      v_fts   := coalesce(v_op -> 'field_ts', '{}'::jsonb);
      v_patch := coalesce(v_op -> 'patch', '{}'::jsonb);

      if v_table is null or not (v_table = any (public.sync_tables())) then
        raise exception 'unknown table %', coalesce(v_table, '(none)');
      end if;
      if (v_op ->> 'id') is null then
        raise exception 'id is required';
      end if;
      v_id := (v_op ->> 'id')::uuid;
      if v_kind not in ('upsert', 'delete', 'restore') then
        raise exception 'unknown kind %', v_kind;
      end if;
      if jsonb_typeof(v_patch) <> 'object' or jsonb_typeof(v_fts) <> 'object' then
        raise exception 'patch and field_ts must be objects';
      end if;
      if v_ts is null or v_ts !~ c_ts_format then
        raise exception 'ts is missing or malformed';
      end if;
      if (v_ts collate "C") > (v_max_ts collate "C") then
        v_ts := v_now_ts || substr(v_ts, 16);
      end if;

      if v_kind = 'delete' then
        v_patch := jsonb_build_object('deleted_at', to_jsonb(now()));
        v_fts := '{}'::jsonb;
      elsif v_kind = 'restore' then
        v_patch := jsonb_build_object('deleted_at', null);
        v_fts := '{}'::jsonb;
      end if;

      -- Which columns may a device write on this table? (looked up once per table)
      if v_cache ? v_table then
        v_allowed := array(select jsonb_array_elements_text(v_cache -> v_table));
      else
        select array_agg(a.attname::text)
          into v_allowed
          from pg_catalog.pg_attribute a
         where a.attrelid = format('public.%I', v_table)::regclass
           and a.attnum > 0
           and not a.attisdropped
           and a.attname::text <> all (c_protected);
        v_cache := v_cache || jsonb_build_object(v_table, to_jsonb(v_allowed));
      end if;

      for v_key in select jsonb_object_keys(v_patch) loop
        if not (v_key = any (v_allowed)) then
          raise exception 'column % cannot be written', v_key;
        end if;
      end loop;

      for v_key in select jsonb_object_keys(v_fts) loop
        v_t := v_fts ->> v_key;
        if v_t is null or v_t !~ c_ts_format then
          raise exception 'field_ts for % is malformed', v_key;
        end if;
        if (v_t collate "C") > (v_max_ts collate "C") then
          v_fts := v_fts || jsonb_build_object(v_key, v_now_ts || substr(v_t, 16));
        end if;
      end loop;

      -- Lock the row if it exists (row-level security hides other users' rows).
      execute format('select t.field_ts from public.%I t where t.id = $1 for update', v_table)
        into v_row_fts using v_id;
      get diagnostics v_count = row_count;
      v_found := v_count > 0;

      if not v_found then
        if v_kind <> 'upsert' then
          v_status := 'missing';
        else
          v_new_fts := '{}'::jsonb;
          for v_key in select jsonb_object_keys(v_patch) loop
            v_new_fts := v_new_fts || jsonb_build_object(v_key, coalesce(v_fts ->> v_key, v_ts));
          end loop;

          select string_agg(format('%I', k), ', ')
            into v_cols
            from jsonb_object_keys(
              v_patch || jsonb_build_object('id', 1, 'user_id', 1, 'field_ts', 1)) as k;

          execute format(
            'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do nothing',
            v_table, v_cols, v_cols, v_table)
            using v_patch || jsonb_build_object('id', v_id, 'user_id', v_uid, 'field_ts', v_new_fts);
          get diagnostics v_count = row_count;

          if v_count = 1 then
            v_status := 'applied';
          else
            -- The id already exists. Either another push inserted it first,
            -- or it belongs to someone else and stays invisible to us.
            execute format('select t.field_ts from public.%I t where t.id = $1 for update', v_table)
              into v_row_fts using v_id;
            get diagnostics v_count = row_count;
            if v_count = 0 then
              raise exception 'id is already in use';
            end if;
            v_found := true;
          end if;
        end if;
      end if;

      if v_found then
        v_apply := '{}'::jsonb;
        v_new_fts := coalesce(v_row_fts, '{}'::jsonb);

        for v_key in select jsonb_object_keys(v_patch) loop
          v_t := coalesce(v_fts ->> v_key, v_ts);
          if (v_row_fts ->> v_key) is null
             or (v_t collate "C") > ((v_row_fts ->> v_key) collate "C") then
            v_apply := v_apply || jsonb_build_object(v_key, v_patch -> v_key);
            v_new_fts := v_new_fts || jsonb_build_object(v_key, v_t);
          end if;
        end loop;

        if v_apply = '{}'::jsonb then
          v_status := 'stale';
        else
          select string_agg(format('%I', k), ', ') into v_cols from jsonb_object_keys(v_apply) as k;
          execute format(
            'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)), field_ts = $2 where id = $3',
            v_table, v_cols, v_cols, v_table)
            using v_apply, v_new_fts, v_id;
          v_status := 'applied';
        end if;
      end if;

    exception
      when others then
        v_status := 'rejected';
        v_error := sqlerrm;
    end;

    v_results := v_results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'op_id', v_op -> 'op_id', 'status', v_status, 'error', v_error)));
  end loop;

  return jsonb_build_object(
    'results', v_results,
    'rev', coalesce((select s.rev from public.sync_state s where s.user_id = v_uid), 0));
end;
$$;

revoke all on function public.sync_push(uuid, jsonb) from public, anon;
grant execute on function public.sync_push(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- sync_pull(since, limit): every row of the caller changed after revision
-- "since", across all synced tables, oldest change first.
--
-- Returns
--   { reset: false, changes: { table: [rows] }, next_since, rev, has_more }
-- or { reset: true, rev } when the device is too far behind (tombstones it
-- never saw have been purged) or ahead of the server (the database was
-- restored from a backup). The device then pushes its outbox, drops its local
-- copy and pulls again from 0.
--
-- Marked stable so that all of its reads share one snapshot.
-- ---------------------------------------------------------------------------
create function public.sync_pull(p_since bigint default 0, p_limit integer default 1000) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
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

  -- The revision of the p_limit-th change after "since" closes this page.
  select string_agg(
           format('select x.rev from public.%I x where x.user_id = $1 and x.rev > $2', t),
           ' union all ')
    into v_union
    from unnest(public.sync_tables()) as t;

  execute format('select u.rev from (%s) u order by u.rev offset $3 limit 1', v_union)
    into v_upto using v_uid, p_since, p_limit - 1;
  v_upto := coalesce(v_upto, v_rev);

  foreach v_table in array public.sync_tables() loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(x) - ''user_id'' order by x.rev), ''[]''::jsonb) '
      'from public.%I x where x.user_id = $1 and x.rev > $2 and x.rev <= $3', v_table)
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

revoke all on function public.sync_pull(bigint, integer) from public, anon;
grant execute on function public.sync_pull(bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- purge_expired(days): remove tombstones and history older than "days".
-- Called by the daily maintenance job with the service role; the app cannot
-- call it. Each user's purge_rev records how far the purge reached, so a
-- device that was offline longer than that knows to resync from scratch.
-- ---------------------------------------------------------------------------
create function public.purge_expired(p_keep_days integer default 90) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
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
    v_total := v_total + v_rows;
  end loop;

  delete from public.change_history where changed_at < v_cutoff;
  return v_total;
end;
$$;

revoke all on function public.purge_expired(integer) from public, anon, authenticated;
grant execute on function public.purge_expired(integer) to service_role;
