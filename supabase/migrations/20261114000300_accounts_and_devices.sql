-- TaskFlow migration 3: accounts and devices

-- ---------------------------------------------------------------------------
-- A profile row is created the moment an account is created, and its email
-- follows the account's email.
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, user_id, email, name)
  values (
    new.id,
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.handle_user_email_change() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- devices: one row per installed app, holding its push token.
-- Not a synced table: a device only ever reads and writes its own row.
-- ---------------------------------------------------------------------------
create table public.devices (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform     text not null check (platform in ('android', 'web', 'ios')),
  name         text not null default '',
  app_version  text not null default '',
  push_token   text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id);
create unique index devices_push_token_idx on public.devices (push_token) where push_token is not null;

alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;
grant select, insert, update, delete on public.devices to authenticated;

create policy devices_select_own on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy devices_insert_own on public.devices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_update_own on public.devices
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete_own on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));

-- register_device: called at sign-in and whenever the push token changes.
-- If this phone's token was registered under another account (someone signed
-- out and a different person signed in), the old row is replaced.
create function public.register_device(
  p_device_id   uuid,
  p_platform    text,
  p_name        text default '',
  p_app_version text default '',
  p_push_token  text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'register_device: not signed in' using errcode = '42501';
  end if;

  if p_push_token is not null then
    delete from public.devices d
     where d.push_token = p_push_token and d.id <> p_device_id;
  end if;

  delete from public.devices d where d.id = p_device_id and d.user_id <> v_uid;

  insert into public.devices as d (id, user_id, platform, name, app_version, push_token, last_seen_at)
  values (p_device_id, v_uid, p_platform, coalesce(p_name, ''), coalesce(p_app_version, ''), p_push_token, now())
  on conflict (id) do update
    set platform = excluded.platform,
        name = excluded.name,
        app_version = excluded.app_version,
        push_token = excluded.push_token,
        last_seen_at = now();
end;
$$;

revoke all on function public.register_device(uuid, text, text, text, text) from public, anon;
grant execute on function public.register_device(uuid, text, text, text, text) to authenticated;
