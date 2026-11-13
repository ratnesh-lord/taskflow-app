-- TaskFlow migration 2: tables
--
-- Rules followed by every synced table below:
--   * the seven sync columns come first (see migration 1)
--   * child rows carry their own user_id, and each foreign key includes it,
--     so a row can only point at a parent owned by the same user
--   * no rule spans two columns: edits are merged field by field, so a check
--     that compares columns could reject a perfectly valid merge. The app's
--     TypeScript core owns those rules instead.

create type public.task_status as enum
  ('inbox', 'not_started', 'in_progress', 'waiting', 'completed', 'archived');
create type public.task_priority as enum ('critical', 'high', 'medium', 'low');
create type public.project_status as enum ('active', 'archived');
create type public.reminder_kind as enum ('absolute', 'before_due');
create type public.occurrence_status as enum ('completed', 'skipped');
create type public.attachment_kind as enum ('file', 'link', 'drive');

-- ---------------------------------------------------------------------------
-- profiles: one row per account (Supabase keeps credentials in auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  email      text,
  name       text not null default '',
  timezone   text not null default 'UTC',
  settings   jsonb not null default '{}'::jsonb,

  constraint profiles_id_is_user check (id = user_id)
);
comment on column public.profiles.settings is
  'Theme, week start, daily planning time, evening summary time and other preferences.';

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  rev         bigint not null default 0,
  field_ts    jsonb not null default '{}'::jsonb,

  name        text not null check (char_length(name) between 1 and 200),
  description text not null default '',
  color       text,
  deadline    date,
  status      public.project_status not null default 'active',
  sort_order  double precision not null default 0,

  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  name       text not null check (char_length(name) between 1 and 100),
  color      text,
  sort_order double precision not null default 0,

  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- tags
-- The app derives a tag's id from its lower-cased name, so the same tag
-- created offline on two devices becomes one row.
-- ---------------------------------------------------------------------------
create table public.tags (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  name       text not null check (char_length(name) between 1 and 60),

  unique (id, user_id)
);
create unique index tags_user_name_idx on public.tags (user_id, lower(name)) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- tasks
-- A recurring task is one row: rrule holds the rule (RFC 5545 text) and each
-- completed or skipped occurrence is a row in task_occurrences. Completing an
-- occurrence never edits the task, so future occurrences cannot be lost.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  rev               bigint not null default 0,
  field_ts          jsonb not null default '{}'::jsonb,

  title             text not null check (char_length(title) between 1 and 500),
  description       text not null default '',
  notes             text not null default '',
  status            public.task_status not null default 'inbox',
  priority          public.task_priority not null default 'medium',
  project_id        uuid,
  category_id       uuid,
  due_date          date,
  due_time          time,
  due_tz            text,
  estimated_minutes integer check (estimated_minutes >= 0),
  completed_at      timestamptz,
  rrule             text,
  recur_until       date,
  sort_order        double precision not null default 0,

  unique (id, user_id),
  constraint tasks_project_fk foreign key (project_id, user_id)
    references public.projects (id, user_id) on delete set null (project_id),
  constraint tasks_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete set null (category_id)
);
comment on column public.tasks.due_tz is
  'IANA timezone when the due time is fixed to a place; null means local time wherever the phone is.';
comment on column public.tasks.rrule is
  'Recurrence rule in RFC 5545 form, for example FREQ=WEEKLY;BYDAY=SA. Null for a one-off task.';

create index tasks_open_due_idx on public.tasks (user_id, due_date)
  where deleted_at is null and status not in ('completed', 'archived');
create index tasks_project_idx on public.tasks (user_id, project_id) where deleted_at is null;
create index tasks_status_idx on public.tasks (user_id, status) where deleted_at is null;
create index tasks_category_idx on public.tasks (category_id) where category_id is not null;

-- ---------------------------------------------------------------------------
-- task_occurrences: one row per completed or skipped occurrence of a
-- recurring task. The id is derived from task id and date on the device, so
-- two devices completing the same occurrence write the same row.
-- ---------------------------------------------------------------------------
create table public.task_occurrences (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  rev             bigint not null default 0,
  field_ts        jsonb not null default '{}'::jsonb,

  task_id         uuid not null,
  occurrence_date date not null,
  status          public.occurrence_status not null default 'completed',
  completed_at    timestamptz,
  moved_to_date   date,
  moved_to_time   time,

  unique (task_id, occurrence_date),
  constraint task_occurrences_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- subtasks
-- ---------------------------------------------------------------------------
create table public.subtasks (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  rev          bigint not null default 0,
  field_ts     jsonb not null default '{}'::jsonb,

  task_id      uuid not null,
  title        text not null check (char_length(title) between 1 and 500),
  is_completed boolean not null default false,
  sort_order   double precision not null default 0,

  constraint subtasks_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);
create index subtasks_task_idx on public.subtasks (task_id);

-- ---------------------------------------------------------------------------
-- reminders
-- absolute:   fire at remind_at
-- before_due: fire offset_minutes before the task (or occurrence) is due, so
--             the reminder follows the task when it is rescheduled
-- ---------------------------------------------------------------------------
create table public.reminders (
  id                uuid primary key,
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  rev               bigint not null default 0,
  field_ts          jsonb not null default '{}'::jsonb,

  task_id           uuid not null,
  kind              public.reminder_kind not null default 'absolute',
  remind_at         timestamptz,
  offset_minutes    integer check (offset_minutes >= 0),
  notification_type text not null default 'reminder' check (notification_type in ('reminder', 'deadline')),
  snoozed_until     timestamptz,
  is_active         boolean not null default true,

  constraint reminders_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);
create index reminders_task_idx on public.reminders (task_id);
create index reminders_due_idx on public.reminders (user_id, remind_at)
  where is_active and deleted_at is null;

-- ---------------------------------------------------------------------------
-- task_tags (id derived from task id and tag id on the device)
-- ---------------------------------------------------------------------------
create table public.task_tags (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  task_id    uuid not null,
  tag_id     uuid not null,

  unique (task_id, tag_id),
  constraint task_tags_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade,
  constraint task_tags_tag_fk foreign key (tag_id, user_id)
    references public.tags (id, user_id) on delete cascade
);
create index task_tags_tag_idx on public.task_tags (tag_id);

-- ---------------------------------------------------------------------------
-- attachments: an uploaded file, a plain link or a Google Drive link
-- ---------------------------------------------------------------------------
create table public.attachments (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  rev          bigint not null default 0,
  field_ts     jsonb not null default '{}'::jsonb,

  task_id      uuid not null,
  kind         public.attachment_kind not null default 'link',
  file_url     text,
  storage_path text,
  file_name    text,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),

  constraint attachments_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);
create index attachments_task_idx on public.attachments (task_id);

-- ---------------------------------------------------------------------------
-- saved_filters
-- ---------------------------------------------------------------------------
create table public.saved_filters (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  name       text not null check (char_length(name) between 1 and 100),
  query      jsonb not null default '{}'::jsonb,
  sort_order double precision not null default 0
);

-- ---------------------------------------------------------------------------
-- calendar_links: which Google Calendar event mirrors which task.
-- The app derives event_id from the task id, so a retried request cannot
-- create a second event.
-- ---------------------------------------------------------------------------
create table public.calendar_links (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  rev            bigint not null default 0,
  field_ts       jsonb not null default '{}'::jsonb,

  task_id        uuid not null,
  provider       text not null default 'google',
  calendar_id    text not null,
  event_id       text not null,
  etag           text,
  last_synced_at timestamptz,

  unique (task_id, calendar_id),
  constraint calendar_links_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Turn every table above into a synced table: policies, triggers, index.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array public.sync_tables() loop
    perform private.sync_enable(t);
  end loop;
end;
$$;
