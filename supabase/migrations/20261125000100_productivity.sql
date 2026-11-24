-- TaskFlow migration 7: goals, habits, daily notes and focus sessions (Phase 8)
--
-- Five new synced tables, plus tasks.goal_id. Each follows the rules in
-- migration 2: the seven sync columns first, child rows carry their own
-- user_id inside every foreign key, and no check compares two columns
-- (edits are merged field by field; src/core owns rules across fields).
--
--   goals           something to achieve; tasks link to it with goal_id
--   habits          something to do regularly, with a daily target
--   habit_logs      one row per time a habit was done. Rows are only ever
--                   added or removed, never edited, so two devices logging
--                   the same habit offline both count after sync.
--   daily_notes     a note per day ("day") or per week ("week", the weekly
--                   review). The id is derived on the device from the
--                   account, kind and date, so two devices write one row.
--   focus_sessions  one timed focus or break period; device_id says which
--                   phone rings when it ends

create type public.goal_status as enum ('active', 'achieved', 'dropped');

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
create table public.goals (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  rev         bigint not null default 0,
  field_ts    jsonb not null default '{}'::jsonb,

  title       text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  target_date date,
  status      public.goal_status not null default 'active',
  color       text check (color is null or char_length(color) <= 20),
  icon        text check (icon is null or char_length(icon) <= 300),
  sort_order  double precision not null default 0,

  unique (id, user_id)
);

alter table public.tasks
  add column if not exists goal_id uuid,
  add constraint tasks_goal_fk foreign key (goal_id, user_id)
    references public.goals (id, user_id) on delete set null (goal_id);
create index tasks_goal_idx on public.tasks (goal_id) where goal_id is not null;

-- ---------------------------------------------------------------------------
-- habits
-- schedule: "daily", "days:1,3,5" (0 = Sunday … 6 = Saturday) or "week:3"
-- (any three days a week). target: how many times a day counts as done.
-- ---------------------------------------------------------------------------
create table public.habits (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  rev           bigint not null default 0,
  field_ts      jsonb not null default '{}'::jsonb,

  title         text not null check (char_length(title) between 1 and 200),
  icon          text check (icon is null or char_length(icon) <= 300),
  color         text check (color is null or char_length(color) <= 20),
  schedule      text not null default 'daily'
                  check (schedule ~ '^(daily|days:[0-6](,[0-6]){0,6}|week:[1-7])$'),
  target        integer not null default 1 check (target between 1 and 1000),
  unit          text not null default '' check (char_length(unit) <= 30),
  reminder_time time,
  status        public.project_status not null default 'active',
  sort_order    double precision not null default 0,

  unique (id, user_id)
);

-- ---------------------------------------------------------------------------
-- habit_logs
-- ---------------------------------------------------------------------------
create table public.habit_logs (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  habit_id   uuid not null,
  log_date   date not null,
  amount     integer not null default 1 check (amount between 1 and 1000),
  logged_at  timestamptz not null default now(),

  constraint habit_logs_habit_fk foreign key (habit_id, user_id)
    references public.habits (id, user_id) on delete cascade
);
create index habit_logs_habit_idx on public.habit_logs (habit_id, log_date);

-- ---------------------------------------------------------------------------
-- daily_notes
-- planned_at: when the day was planned (kind "day") or the week reviewed
-- (kind "week"); null until then.
-- ---------------------------------------------------------------------------
create table public.daily_notes (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 0,
  field_ts   jsonb not null default '{}'::jsonb,

  note_date  date not null,
  kind       text not null default 'day' check (kind in ('day', 'week')),
  body       text not null default '' check (char_length(body) <= 20000),
  planned_at timestamptz,

  unique (id, user_id)
);
create unique index daily_notes_user_day_idx on public.daily_notes (user_id, kind, note_date) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- focus_sessions
-- A session that has no ended_at counts as running until started_at plus
-- planned_minutes, then as finished on time.
-- ---------------------------------------------------------------------------
create table public.focus_sessions (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  rev             bigint not null default 0,
  field_ts        jsonb not null default '{}'::jsonb,

  task_id         uuid,
  kind            text not null default 'focus' check (kind in ('focus', 'break')),
  started_at      timestamptz not null,
  planned_minutes integer not null check (planned_minutes between 1 and 240),
  ended_at        timestamptz,
  device_id       uuid,

  constraint focus_sessions_task_fk foreign key (task_id, user_id)
    references public.tasks (id, user_id) on delete set null (task_id)
);
create index focus_sessions_started_idx on public.focus_sessions (user_id, started_at);

-- ---------------------------------------------------------------------------
-- The synced tables, parents before children (goals before tasks, which
-- point at them). sync_pull and the purge job walk this list.
-- ---------------------------------------------------------------------------
create or replace function public.sync_tables() returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'profiles', 'projects', 'categories', 'tags', 'goals', 'tasks',
    'subtasks', 'reminders', 'task_occurrences', 'task_tags',
    'attachments', 'saved_filters', 'calendar_links',
    'habits', 'habit_logs', 'daily_notes', 'focus_sessions'
  ]::text[];
$$;

select private.sync_enable(t)
  from unnest(array['goals', 'habits', 'habit_logs', 'daily_notes', 'focus_sessions']) as t;
