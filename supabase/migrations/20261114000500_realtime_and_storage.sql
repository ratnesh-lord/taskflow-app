-- TaskFlow migration 5: Realtime and file storage
--
-- Both blocks touch objects that exist on Supabase but not on a plain
-- Postgres server, so each checks first. That lets the same migrations run
-- in the automated tests.

-- Realtime: the app listens to its own sync_state row and pulls when the
-- revision moves. One small row per change instead of a feed of every table.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_state')
  then
    alter publication supabase_realtime add table public.sync_state;
  end if;
end;
$$;

-- Storage: a private bucket for task attachments. A file lives under a
-- folder named after its owner's user id, and only that user can touch it.
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

  if not exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'attachments_select_own') then
    create policy attachments_select_own on storage.objects
      for select to authenticated
      using (bucket_id = 'attachments'
             and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'attachments_insert_own') then
    create policy attachments_insert_own on storage.objects
      for insert to authenticated
      with check (bucket_id = 'attachments'
                  and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'attachments_update_own') then
    create policy attachments_update_own on storage.objects
      for update to authenticated
      using (bucket_id = 'attachments'
             and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'attachments'
                  and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;

  if not exists (select 1 from pg_catalog.pg_policies
                  where schemaname = 'storage' and tablename = 'objects'
                    and policyname = 'attachments_delete_own') then
    create policy attachments_delete_own on storage.objects
      for delete to authenticated
      using (bucket_id = 'attachments'
             and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end;
$$;
