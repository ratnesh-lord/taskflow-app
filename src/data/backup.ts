/**
 * Export and restore: every task, project, category, tag, subtask, reminder,
 * repeat record, link and saved filter of the account, as one JSON file.
 *
 * Tasks in a group belong to the group, not to the account, so they (and
 * their subtasks, reminders and repeat records) are not part of a backup.
 *
 * Restoring merges: each item in the file is brought back to how it was in
 * the file (and undeleted if it was deleted since); items made after the
 * backup are left alone. It is one transaction, so it can be undone, and its
 * changes sync to the account like any other edit.
 */
import { columnsOf, SERVER_ONLY_TABLES, TABLE_NAMES, type TableName } from './schema';
import type { Row, Store, UndoLog } from './store';

export const BACKUP_FORMAT = 'taskflow-backup';
export const BACKUP_VERSION = 1;

/** The profile belongs to the account, groups to their members: neither is in a backup. */
const TABLES = TABLE_NAMES.filter((t) => t !== 'profiles' && !SERVER_ONLY_TABLES.includes(t));

const inGroup = (r: Record<string, unknown>) => typeof r.group_id === 'string' && r.group_id !== '';

export type BackupRow = Record<string, unknown> & { id: string };

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exported_at: string;
  app_version?: string;
  tables: Partial<Record<TableName, BackupRow[]>>;
};

export class BackupError extends Error {}

function clean(table: TableName, row: Row): BackupRow {
  const out: BackupRow = { id: row.id, created_at: row.created_at };
  for (const name of Object.keys(columnsOf(table))) out[name] = row[name] ?? null;
  return out;
}

export async function makeBackup(store: Store, opts: { now?: Date; appVersion?: string } = {}): Promise<Backup> {
  const tables: Backup['tables'] = {};
  for (const table of TABLES) {
    const rows = (await store.rows(table)).filter((r) => !inGroup(r));
    if (rows.length) tables[table] = rows.map((r) => clean(table, r)).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: (opts.now ?? new Date()).toISOString(),
    ...(opts.appVersion ? { app_version: opts.appVersion } : {}),
    tables,
  };
}

/** "taskflow-backup-2026-11-18.json" */
export function backupFileName(exportedAt: string): string {
  return `taskflow-backup-${exportedAt.slice(0, 10)}.json`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read a backup file, or explain in plain words why it cannot be used. */
export function readBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a TaskFlow backup: it is not readable as JSON.');
  }
  const b = data as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.format !== BACKUP_FORMAT) {
    throw new BackupError('This file is not a TaskFlow backup.');
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupError('This backup was made by a newer version of TaskFlow. Update the app, then try again.');
  }
  if (!b.tables || typeof b.tables !== 'object') throw new BackupError('This backup has no data in it.');
  const tables: Backup['tables'] = {};
  for (const [name, rows] of Object.entries(b.tables)) {
    if (!(TABLES as string[]).includes(name)) continue; // a table this version does not know: skipped
    if (!Array.isArray(rows)) throw new BackupError(`This backup is damaged (${name} is not a list).`);
    for (const r of rows) {
      if (!r || typeof r !== 'object' || typeof (r as BackupRow).id !== 'string' || !UUID.test((r as BackupRow).id)) {
        throw new BackupError(`This backup is damaged (an item in ${name} has no valid id).`);
      }
    }
    tables[name as TableName] = rows as BackupRow[];
  }
  return { format: BACKUP_FORMAT, version: b.version, exported_at: String(b.exported_at ?? ''), app_version: b.app_version, tables };
}

/** How many of each kind of item a backup holds, for the confirmation. */
export function backupCounts(b: Backup): Partial<Record<TableName, number>> {
  const out: Partial<Record<TableName, number>> = {};
  for (const [t, rows] of Object.entries(b.tables)) if (rows?.length) out[t as TableName] = rows.length;
  return out;
}

/**
 * Bring every item in the backup back to its state in the file.
 * Returns how many items were changed and an undo log.
 */
export async function restoreBackup(store: Store, b: Backup): Promise<{ changed: number; undo: UndoLog }> {
  const { result, undo } = await store.transaction(async (tx) => {
    let changed = 0;
    for (const table of TABLES) {
      const cols = columnsOf(table);
      for (const row of b.tables[table] ?? []) {
        if (inGroup(row)) continue;
        const patch: Record<string, unknown> = {};
        for (const [name, col] of Object.entries(cols)) {
          if (!(name in row)) continue;
          if (row[name] === null && col.default !== undefined) continue; // a required field keeps its value
          patch[name] = row[name];
        }
        const existing = await tx.get(table, row.id);
        if (existing && inGroup(existing)) continue; // shared with a group since: left as the group has it
        if (existing?.deleted_at) await tx.restore(table, row.id);
        await tx.write(table, row.id, patch);
        changed += 1;
      }
    }
    return changed;
  });
  return { changed: result, undo };
}
