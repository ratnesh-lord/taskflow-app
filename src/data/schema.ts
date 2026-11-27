/**
 * The phone's copy of the database. Tables and columns mirror the server
 * (supabase/migrations), so a row can travel either way unchanged, plus:
 *
 *   outbox  edits not yet sent to the server, in the shape sync_push takes
 *   meta    small settings: the edit clock, the last pulled revision
 *
 * Differences from Postgres: booleans are 0/1, JSON is text, timestamps are
 * ISO text. There are no foreign keys; the server enforces those.
 */
export type ColumnType = 'text' | 'int' | 'real' | 'bool' | 'json';

type Columns = Record<string, { type: ColumnType; default?: string }>;

const t = (def?: string) => ({ type: 'text' as const, default: def });
const i = (def?: string) => ({ type: 'int' as const, default: def });
const r = (def?: string) => ({ type: 'real' as const, default: def });
const b = (def: string) => ({ type: 'bool' as const, default: def });
const j = (def: string) => ({ type: 'json' as const, default: def });

/** Columns every synced table has, managed by the store. */
export const SYNC_COLUMNS = ['id', 'user_id', 'created_at', 'updated_at', 'deleted_at', 'rev', 'field_ts'] as const;

export const TABLES = {
  profiles: { email: t(), name: t("''"), timezone: t("'UTC'"), settings: j("'{}'"), username: t() },
  projects: {
    name: t(), description: t("''"), color: t(), deadline: t(), status: t("'active'"), sort_order: r('0'),
  },
  categories: { name: t(), color: t(), sort_order: r('0') },
  tags: { name: t() },
  tasks: {
    title: t(), description: t("''"), notes: t("''"), status: t("'inbox'"), priority: t("'medium'"),
    project_id: t(), category_id: t(), due_date: t(), due_time: t(), due_tz: t(), estimated_minutes: i(),
    completed_at: t(), rrule: t(), recur_until: t(), sort_order: r('0'), icon: t(), goal_id: t(),
    group_id: t(), owner_id: t(), is_private: b('0'), created_by: t(), previous_owner_id: t(),
  },
  task_occurrences: {
    task_id: t(), occurrence_date: t(), status: t("'completed'"), completed_at: t(), moved_to_date: t(), moved_to_time: t(),
    group_id: t(),
  },
  subtasks: { task_id: t(), title: t(), is_completed: b('0'), sort_order: r('0'), group_id: t() },
  reminders: {
    task_id: t(), kind: t("'absolute'"), remind_at: t(), offset_minutes: i(), notification_type: t("'reminder'"),
    snoozed_until: t(), is_active: b('1'), group_id: t(),
  },
  task_tags: { task_id: t(), tag_id: t() },
  attachments: {
    task_id: t(), kind: t("'link'"), file_url: t(), storage_path: t(), file_name: t(), mime_type: t(), size_bytes: i(),
  },
  saved_filters: { name: t(), query: j("'{}'"), sort_order: r('0') },
  calendar_links: {
    task_id: t(), provider: t("'google'"), calendar_id: t(), event_id: t(), etag: t(), last_synced_at: t(),
  },
  goals: {
    title: t(), description: t("''"), target_date: t(), status: t("'active'"), color: t(), icon: t(), sort_order: r('0'),
  },
  habits: {
    title: t(), icon: t(), color: t(), schedule: t("'daily'"), target: i('1'), unit: t("''"), reminder_time: t(),
    status: t("'active'"), sort_order: r('0'),
  },
  habit_logs: { habit_id: t(), log_date: t(), amount: i('1'), logged_at: t() },
  daily_notes: { note_date: t(), kind: t("'day'"), body: t("''"), planned_at: t() },
  focus_sessions: { task_id: t(), kind: t("'focus'"), started_at: t(), planned_minutes: i(), ended_at: t(), device_id: t() },
  // Groups arrive through sync_pull_groups and are changed only through the
  // group functions (src/data/groups.ts), never by an edit on the device.
  groups: { name: t("''"), created_by: t() },
  group_members: {
    group_id: t(), member_id: t(), role: t("'member'"), status: t("'invited'"), username: t("''"), display_name: t("''"),
    invited_by: t(), invited_by_name: t(),
  },
} satisfies Record<string, Columns>;

/**
 * Text columns the server stores as time or timestamp. Postgres sends them
 * back as "19:00:00" and "2026-11-18T13:30:00.123+00:00"; the app keeps
 * "19:00" and ISO strings ending in Z, so pulled rows are converted.
 * (A test compares these lists with the real database.)
 */
export const TIME_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  tasks: ['due_time'],
  task_occurrences: ['moved_to_time'],
  habits: ['reminder_time'],
};
export const TIMESTAMP_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  tasks: ['completed_at'],
  task_occurrences: ['completed_at'],
  reminders: ['remind_at', 'snoozed_until'],
  calendar_links: ['last_synced_at'],
  habit_logs: ['logged_at'],
  daily_notes: ['planned_at'],
  focus_sessions: ['started_at', 'ended_at'],
};

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

/** Tables that only the server writes (not in the server's sync_tables(), not in backups). */
export const SERVER_ONLY_TABLES: readonly TableName[] = ['groups', 'group_members'];

/** Tables whose rows can belong to a group (they carry group_id). */
export const GROUP_TABLES: readonly TableName[] = ['tasks', 'subtasks', 'reminders', 'task_occurrences'];

/** Columns kept on the device only (filled from extra fields the server sends). */
export const LOCAL_ONLY_COLUMNS: Readonly<Partial<Record<TableName, readonly string[]>>> = {
  group_members: ['invited_by_name'],
};

export function columnsOf(table: TableName): Columns {
  return TABLES[table];
}

/**
 * Columns added after the first version, by the local migration that adds
 * them. The first migration leaves them out, so a new install and an
 * upgraded one end up the same.
 */
const ADDED_LATER: Partial<Record<TableName, readonly string[]>> = {
  profiles: ['username'],
  tasks: ['icon', 'goal_id', 'group_id', 'owner_id', 'is_private', 'created_by', 'previous_owner_id'],
  task_occurrences: ['group_id'],
  subtasks: ['group_id'],
  reminders: ['group_id'],
};

function columnSql(name: string, c: { type: ColumnType; default?: string }): string {
  const sqlType = c.type === 'int' || c.type === 'bool' ? 'INTEGER' : c.type === 'real' ? 'REAL' : 'TEXT';
  return `${name} ${sqlType}${c.default !== undefined ? ` NOT NULL DEFAULT ${c.default}` : ''}`;
}

function addColumn(table: TableName, name: string): string {
  return `ALTER TABLE ${table} ADD COLUMN ${columnSql(name, columnsOf(table)[name])};`;
}

function createTable(table: TableName): string {
  const later = ADDED_LATER[table] ?? [];
  const cols = Object.entries(columnsOf(table))
    .filter(([name]) => !later.includes(name))
    .map(([name, c]) => columnSql(name, c));
  return `CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    rev INTEGER NOT NULL DEFAULT 0,
    field_ts TEXT NOT NULL DEFAULT '{}',
    ${cols.join(',\n    ')}
  );`;
}

/** Each entry upgrades the local database by one version. Append only. */
export const LOCAL_MIGRATIONS: string[] = [
  [
    ...TABLE_NAMES.map(createTable),
    'CREATE INDEX IF NOT EXISTS tasks_live_idx ON tasks (deleted_at, status);',
    'CREATE INDEX IF NOT EXISTS occurrences_task_idx ON task_occurrences (task_id);',
    'CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks (task_id);',
    'CREATE INDEX IF NOT EXISTS reminders_task_idx ON reminders (task_id);',
    'CREATE INDEX IF NOT EXISTS task_tags_task_idx ON task_tags (task_id);',
    'CREATE INDEX IF NOT EXISTS attachments_task_idx ON attachments (task_id);',
    `CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op_id TEXT NOT NULL,
      tbl TEXT NOT NULL,
      row_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      patch TEXT NOT NULL,
      ts TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`,
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  ].join('\n'),
  // 2: a task's picture (emoji, clipart or photo), as on the server since migration 20261123000100.
  addColumn('tasks', 'icon'),
  // 3: Phase 8 (server migration 20261125000100): goals, habits and their logs, daily notes, focus sessions.
  [
    addColumn('tasks', 'goal_id'),
    ...(['goals', 'habits', 'habit_logs', 'daily_notes', 'focus_sessions'] as const).map(createTable),
    'CREATE INDEX IF NOT EXISTS habit_logs_habit_idx ON habit_logs (habit_id, log_date);',
    'CREATE INDEX IF NOT EXISTS tasks_goal_idx ON tasks (goal_id);',
  ].join('\n'),
  // 4: usernames, groups and shared tasks (server migration 20261128000100).
  [
    addColumn('profiles', 'username'),
    ...(['group_id', 'owner_id', 'is_private', 'created_by', 'previous_owner_id'] as const).map((c) => addColumn('tasks', c)),
    ...(['task_occurrences', 'subtasks', 'reminders'] as const).map((t) => addColumn(t, 'group_id')),
    ...(['groups', 'group_members'] as const).map(createTable),
    'CREATE INDEX IF NOT EXISTS tasks_group_idx ON tasks (group_id);',
    'CREATE INDEX IF NOT EXISTS group_members_group_idx ON group_members (group_id);',
  ].join('\n'),
];

/** JavaScript value → stored value. */
export function encode(type: ColumnType, value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  switch (type) {
    case 'bool':
      return value ? 1 : 0;
    case 'json':
      return JSON.stringify(value);
    case 'int':
    case 'real':
      return typeof value === 'number' ? value : Number(value);
    default:
      return String(value);
  }
}

/** Stored value → JavaScript value (as the server would send it). */
export function decode(type: ColumnType, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (type) {
    case 'bool':
      return value === 1 || value === true || value === '1';
    case 'json':
      try {
        return typeof value === 'string' ? JSON.parse(value) : value;
      } catch {
        return {};
      }
    default:
      return value;
  }
}
