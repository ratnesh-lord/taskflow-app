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
  profiles: { email: t(), name: t("''"), timezone: t("'UTC'"), settings: j("'{}'") },
  projects: {
    name: t(), description: t("''"), color: t(), deadline: t(), status: t("'active'"), sort_order: r('0'),
  },
  categories: { name: t(), color: t(), sort_order: r('0') },
  tags: { name: t() },
  tasks: {
    title: t(), description: t("''"), notes: t("''"), status: t("'inbox'"), priority: t("'medium'"),
    project_id: t(), category_id: t(), due_date: t(), due_time: t(), due_tz: t(), estimated_minutes: i(),
    completed_at: t(), rrule: t(), recur_until: t(), sort_order: r('0'),
  },
  task_occurrences: {
    task_id: t(), occurrence_date: t(), status: t("'completed'"), completed_at: t(), moved_to_date: t(), moved_to_time: t(),
  },
  subtasks: { task_id: t(), title: t(), is_completed: b('0'), sort_order: r('0') },
  reminders: {
    task_id: t(), kind: t("'absolute'"), remind_at: t(), offset_minutes: i(), notification_type: t("'reminder'"),
    snoozed_until: t(), is_active: b('1'),
  },
  task_tags: { task_id: t(), tag_id: t() },
  attachments: {
    task_id: t(), kind: t("'link'"), file_url: t(), storage_path: t(), file_name: t(), mime_type: t(), size_bytes: i(),
  },
  saved_filters: { name: t(), query: j("'{}'"), sort_order: r('0') },
  calendar_links: {
    task_id: t(), provider: t("'google'"), calendar_id: t(), event_id: t(), etag: t(), last_synced_at: t(),
  },
} satisfies Record<string, Columns>;

export type TableName = keyof typeof TABLES;
export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export function columnsOf(table: TableName): Columns {
  return TABLES[table];
}

function createTable(table: TableName): string {
  const cols = Object.entries(columnsOf(table)).map(([name, c]) => {
    const sqlType = c.type === 'int' || c.type === 'bool' ? 'INTEGER' : c.type === 'real' ? 'REAL' : 'TEXT';
    return `${name} ${sqlType}${c.default !== undefined ? ` NOT NULL DEFAULT ${c.default}` : ''}`;
  });
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
