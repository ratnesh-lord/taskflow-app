/**
 * The phone's database, with every edit recorded twice:
 *
 *   1. in the table itself, with the edit's timestamp per field (field_ts),
 *      exactly as the server keeps it;
 *   2. in the outbox, as an op in the shape sync_push accepts:
 *      { op_id, table, id, kind, patch, ts }.
 *
 * The sync engine (sync.ts) sends the outbox, then brings in other devices'
 * changes with applyRemote, which never touches a field that still has an
 * edit waiting to be sent from here.
 *
 * All access goes through one queue, so a transaction never interleaves with
 * another read or write. Every transaction returns an undo log.
 */
import { type ClockState, HybridClock } from '@/core/hlc';

import { type Db, SerialQueue, type SqlValue } from './db';
import { columnsOf, decode, encode, GROUP_TABLES, LOCAL_MIGRATIONS, TABLE_NAMES, type TableName, TIME_COLUMNS, TIMESTAMP_COLUMNS } from './schema';

export type Row = Record<string, unknown> & { id: string };

/** 'local': an edit made on this device. 'sync': the sync engine changed rows or the outbox. */
export type ChangeOrigin = 'local' | 'sync';

type ChangeKind = 'insert' | 'update' | 'remove' | 'restore';
type Change = { table: TableName; id: string; kind: ChangeKind; before: Record<string, unknown> };

/** A change touching more rows than this makes readers reload the whole table. */
const CHANGE_LOG_ROWS = 300;
/** Changes remembered per table. */
const CHANGE_LOG_ENTRIES = 64;
/** Rows per multi-row INSERT is chosen so one statement has at most this many values. */
const MAX_VALUES_PER_STATEMENT = 900;

/** What a transaction changed, so it can be reversed. */
export type UndoLog = { changes: Change[] };

export interface Tx {
  /** A row, including a deleted one (deleted_at set), or null. Values are decoded. */
  get(table: TableName, id: string): Promise<Row | null>;
  /** Insert or update. Only fields whose value changes are written and sent. */
  write(table: TableName, id: string, patch: Record<string, unknown>): Promise<void>;
  /** Mark deleted. The row stays, so the deletion can sync and be undone. */
  remove(table: TableName, id: string): Promise<void>;
  restore(table: TableName, id: string): Promise<void>;
  /** Live (not deleted) rows matching a column value. */
  find(table: TableName, column: string, value: SqlValue): Promise<Row[]>;
}

export type StoreOptions = {
  userId: string;
  /** This device's id, a lower-case uuid. */
  deviceId: string;
  now?: () => Date;
};

export type OutboxOp = {
  seq: number;
  op_id: string;
  table: TableName;
  id: string;
  kind: 'upsert' | 'delete' | 'restore';
  patch: Record<string, unknown>;
  ts: string;
};

const CLOCK_KEY = 'clock';

/**
 * A row as sync_pull sends it: every column, with JSON types. A group row
 * the account may no longer see arrives as { id, rev, hidden: true }.
 */
export type RemoteRow = Record<string, unknown> & { id: string };

/** Changes from sync_pull, by table. */
export type RemoteChanges = Partial<Record<string, RemoteRow[]>>;

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/** A server value in the form the app keeps it (times as HH:MM, timestamps as ISO with Z). */
function fromServer(table: string, column: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (TIME_COLUMNS[table]?.includes(column)) return String(value).slice(0, 5);
  if (TIMESTAMP_COLUMNS[table]?.includes(column)) return toIso(value);
  return value;
}

function decodeRow(table: TableName, raw: Record<string, unknown>): Row {
  const out: Record<string, unknown> = {
    id: raw.id,
    user_id: raw.user_id,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    deleted_at: raw.deleted_at ?? null,
    rev: raw.rev,
    field_ts: decode('json', raw.field_ts) ?? {},
  };
  for (const [name, col] of Object.entries(columnsOf(table))) out[name] = decode(col.type, raw[name]);
  return out as Row;
}

/** The value as the server stores it, so the outbox patch matches sync_push. */
function serverValue(type: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (type === 'bool') return value == null ? null : !!value;
  return value;
}

export class Store {
  private readonly queue = new SerialQueue();
  private readonly listeners = new Set<(origin: ChangeOrigin) => void>();
  private readonly now: () => Date;

  private constructor(
    private readonly db: Db,
    private readonly opts: StoreOptions,
    private clock: HybridClock,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  get userId(): string {
    return this.opts.userId;
  }

  static async open(db: Db, opts: StoreOptions): Promise<Store> {
    const [{ user_version: version } = { user_version: 0 }] = await db.all<{ user_version: number }>('PRAGMA user_version');
    for (let v = version; v < LOCAL_MIGRATIONS.length; v += 1) {
      await db.exec('BEGIN');
      try {
        await db.exec(LOCAL_MIGRATIONS[v]);
        await db.exec(`PRAGMA user_version = ${v + 1}`);
        await db.exec('COMMIT');
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    }
    const [saved] = await db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [CLOCK_KEY]);
    let state: ClockState | undefined;
    try {
      state = saved ? (JSON.parse(saved.value) as ClockState) : undefined;
    } catch {
      state = undefined;
    }
    const clock = new HybridClock(opts.deviceId, () => (opts.now ?? (() => new Date()))().getTime(), state);
    return new Store(db, opts, clock);
  }

  /** Called after every change: 'local' for edits made here, 'sync' for changes made by syncing. */
  subscribe(listener: (origin: ChangeOrigin) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(origin: ChangeOrigin): void {
    for (const l of this.listeners) l(origin);
  }

  /** How many times each table has changed since this store was opened. */
  private versions = new Map<TableName, number>();
  /** Per table, the rows each recent change touched (null: too many to list). */
  private changeLog = new Map<TableName, { version: number; ids: Set<string> | null }[]>();

  private bump(ids: Map<TableName, Set<string> | null>): void {
    for (const [table, rows] of ids) {
      const version = (this.versions.get(table) ?? 0) + 1;
      this.versions.set(table, version);
      const log = this.changeLog.get(table) ?? [];
      log.push({ version, ids: rows && rows.size <= CHANGE_LOG_ROWS ? rows : null });
      if (log.length > CHANGE_LOG_ENTRIES) log.shift();
      this.changeLog.set(table, log);
    }
  }

  /**
   * The rows of a table that changed after `version` (a value version()
   * returned), or null when that is not known exactly (too many, or too long
   * ago): then read the whole table again.
   */
  changedSince(table: TableName, version: number): Set<string> | null {
    const now = this.version(table);
    if (version === now) return new Set();
    const log = this.changeLog.get(table) ?? [];
    if (!log.length || log[0].version > version + 1) return null;
    const out = new Set<string>();
    for (const entry of log) {
      if (entry.version <= version) continue;
      if (!entry.ids) return null;
      for (const id of entry.ids) out.add(id);
      if (out.size > CHANGE_LOG_ROWS) return null;
    }
    return out;
  }

  /** Some rows of a table, as view() reads them, deleted ones included (deleted_at set). */
  viewRows(table: TableName, ids: readonly string[]): Promise<Row[]> {
    const cols = Object.entries(columnsOf(table));
    const names = ['id', 'created_at', 'updated_at', 'deleted_at', ...cols.map(([name]) => name)];
    return this.queue.run(async () => {
      const out: Row[] = [];
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400);
        const raw = await this.db.all<Record<string, unknown>>(
          `SELECT ${names.join(', ')} FROM ${table} WHERE id IN (${part.map(() => '?').join(', ')})`,
          part,
        );
        for (const r of raw) {
          const row: Record<string, unknown> = { id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
          for (const [name, col] of cols) row[name] = decode(col.type, r[name]);
          out.push(row as Row);
        }
      }
      return out;
    });
  }

  /**
   * A number that changes whenever the table does (an edit here, rows from
   * the server, a clear). Read it before reading the rows, and the rows are
   * at least as new as the number.
   */
  version(table: TableName): number {
    return this.versions.get(table) ?? 0;
  }

  /**
   * Every live row of a table for showing on screen: the table's own columns
   * plus id, created_at and updated_at, without the sync bookkeeping
   * (field_ts, rev), which is the slow part of reading a large table.
   */
  view(table: TableName): Promise<Row[]> {
    const cols = Object.entries(columnsOf(table));
    const names = ['id', 'created_at', 'updated_at', ...cols.map(([name]) => name)];
    return this.queue.run(async () => {
      const raw = await this.db.all<Record<string, unknown>>(`SELECT ${names.join(', ')} FROM ${table} WHERE deleted_at IS NULL`);
      return raw.map((r) => {
        const out: Record<string, unknown> = { id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: null };
        for (const [name, col] of cols) out[name] = decode(col.type, r[name]);
        return out as Row;
      });
    });
  }

  /** Every live row of a table, decoded. */
  rows(table: TableName): Promise<Row[]> {
    return this.queue.run(async () => {
      const raw = await this.db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE deleted_at IS NULL`);
      return raw.map((r) => decodeRow(table, r));
    });
  }

  /** Every row of a table, deleted ones included. */
  allRows(table: TableName): Promise<Row[]> {
    return this.queue.run(async () => {
      const raw = await this.db.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
      return raw.map((r) => decodeRow(table, r));
    });
  }

  outbox(): Promise<OutboxOp[]> {
    return this.queue.run(async () => {
      const raw = await this.db.all<{ seq: number; op_id: string; tbl: TableName; row_id: string; kind: OutboxOp['kind']; patch: string; ts: string }>(
        'SELECT * FROM outbox ORDER BY seq',
      );
      return raw.map((r) => ({ seq: r.seq, op_id: r.op_id, table: r.tbl, id: r.row_id, kind: r.kind, patch: JSON.parse(r.patch), ts: r.ts }));
    });
  }

  /** The oldest edits waiting to be sent, at most `limit`. */
  pendingOps(limit: number): Promise<OutboxOp[]> {
    return this.queue.run(async () => {
      const raw = await this.db.all<{ seq: number; op_id: string; tbl: TableName; row_id: string; kind: OutboxOp['kind']; patch: string; ts: string }>(
        'SELECT * FROM outbox ORDER BY seq LIMIT ?',
        [limit],
      );
      return raw.map((r) => ({ seq: r.seq, op_id: r.op_id, table: r.tbl, id: r.row_id, kind: r.kind, patch: JSON.parse(r.patch), ts: r.ts }));
    });
  }

  /** Forget edits the server has answered for. */
  acknowledge(seqs: readonly number[]): Promise<void> {
    if (seqs.length === 0) return Promise.resolve();
    return this.queue.run(async () => {
      for (let i = 0; i < seqs.length; i += 500) {
        const part = seqs.slice(i, i + 500);
        await this.db.run(`DELETE FROM outbox WHERE seq IN (${part.map(() => '?').join(', ')})`, part);
      }
    }).then(() => this.emit('sync'));
  }

  getMeta(key: string): Promise<string | null> {
    return this.queue.run(async () => {
      const [row] = await this.db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
      return row?.value ?? null;
    });
  }

  setMeta(key: string, value: string | null): Promise<void> {
    return this.queue.run(async () => {
      if (value === null) await this.db.run('DELETE FROM meta WHERE key = ?', [key]);
      else await this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
    });
  }

  /**
   * Bring in rows from the server. A row with no edits waiting here becomes
   * exactly the server's row. In a row that does have waiting edits, those
   * fields keep this device's value (it is newer, and goes up next push);
   * every other field takes the server's. Nothing is queued and there is no
   * undo: these are other devices' edits, already saved.
   */
  applyRemote(changes: RemoteChanges): Promise<number> {
    return this.queue
      .run(async () => {
        let applied = 0;
        await this.db.exec('BEGIN');
        try {
          const pending = new Map<string, Set<string>>();
          const ops = await this.db.all<{ tbl: string; row_id: string; kind: string; patch: string }>('SELECT tbl, row_id, kind, patch FROM outbox');
          for (const op of ops) {
            const key = `${op.tbl}:${op.row_id}`;
            const set = pending.get(key) ?? new Set<string>();
            if (op.kind === 'upsert') for (const k of Object.keys(JSON.parse(op.patch) as object)) set.add(k);
            else set.add('deleted_at');
            pending.set(key, set);
          }

          const nowIso = this.now().toISOString();
          const touched = new Map<TableName, Set<string> | null>();
          for (const table of TABLE_NAMES) {
            const all = (changes[table] ?? []).filter((r) => typeof r.id === 'string');
            if (!all.length) continue;
            touched.set(table, new Set(all.map((r) => r.id as string)));
            // Rows this account may no longer see (a group task made private) are removed outright.
            const hidden = all.filter((r) => r.hidden === true).map((r) => r.id as string);
            for (let i = 0; i < hidden.length; i += 400) {
              const part = hidden.slice(i, i + 400);
              await this.db.run(`DELETE FROM ${table} WHERE id IN (${part.map(() => '?').join(', ')})`, part);
              applied += part.length;
            }
            const rows = hidden.length ? all.filter((r) => r.hidden !== true) : all;
            if (!rows.length) continue;
            const cols = columnsOf(table);

            // The rows already here, read in batches rather than one at a time.
            const existing = new Map<string, Record<string, unknown>>();
            const ids = [...new Set(rows.map((r) => r.id as string))];
            for (let i = 0; i < ids.length; i += 400) {
              const part = ids.slice(i, i + 400);
              const found = await this.db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id IN (${part.map(() => '?').join(', ')})`, part);
              for (const r of found) existing.set(r.id as string, r);
            }

            // New rows wait here and go in as multi-row INSERTs, grouped by their columns.
            const inserts = new Map<string, Record<string, SqlValue>[]>();
            const flush = async () => {
              for (const [keyList, group] of inserts) {
                const keys = keyList.split(',');
                const per = Math.max(1, Math.floor(MAX_VALUES_PER_STATEMENT / (keys.length + 1)));
                for (let i = 0; i < group.length; i += per) {
                  const part = group.slice(i, i + per);
                  const one = `(?${keys.map(() => ', ?').join('')})`;
                  await this.db.run(
                    `INSERT INTO ${table} (id, ${keys.join(', ')}) VALUES ${part.map(() => one).join(', ')}`,
                    part.flatMap((v) => [v.id, ...keys.map((k) => v[k])]),
                  );
                }
              }
              inserts.clear();
            };
            const queued = new Set<string>();

            for (const remote of rows) {
              const id = remote.id as string;
              if (queued.has(id)) {
                // The same row twice in one batch: write the first, then treat the second as an update.
                await flush();
                queued.clear();
                const [again] = await this.db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
                if (again) existing.set(id, again);
              }
              const remoteTs = (remote.field_ts && typeof remote.field_ts === 'object' ? remote.field_ts : {}) as Record<string, string>;
              for (const stamp of Object.values(remoteTs)) if (typeof stamp === 'string') this.clock.receive(stamp);

              const values: Record<string, SqlValue> = {
                user_id: this.opts.userId,
                created_at: toIso(remote.created_at) ?? nowIso,
                updated_at: toIso(remote.updated_at) ?? nowIso,
                deleted_at: toIso(remote.deleted_at),
                rev: Number(remote.rev ?? 0),
              };
              for (const [name, col] of Object.entries(cols)) {
                if (!(name in remote)) continue;
                const value = fromServer(table, name, remote[name]);
                // A NOT NULL column keeps its default rather than failing on a null from the server.
                if (value === null && col.default !== undefined) continue;
                values[name] = encode(col.type, value);
              }

              const raw = existing.get(id);
              const fieldTs: Record<string, string> = { ...remoteTs };
              const mine = pending.get(`${table}:${id}`);
              if (raw && mine?.size) {
                const localTs = (decode('json', raw.field_ts) ?? {}) as Record<string, string>;
                for (const k of mine) {
                  if (k in values || k in cols || k === 'deleted_at') values[k] = (raw[k] ?? null) as SqlValue;
                  if (localTs[k]) fieldTs[k] = localTs[k];
                }
              }
              values.field_ts = JSON.stringify(fieldTs);

              const keys = Object.keys(values);
              if (raw) {
                await this.db.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
                  ...keys.map((k) => values[k]),
                  id,
                ]);
              } else {
                const keyList = keys.join(',');
                const group = inserts.get(keyList) ?? [];
                group.push({ ...values, id });
                inserts.set(keyList, group);
                queued.add(id);
              }
              applied += 1;
            }
            await flush();
            if (all.length > CHANGE_LOG_ROWS) touched.set(table, null);
          }
          await this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [CLOCK_KEY, JSON.stringify(this.clock.snapshot())]);
          await this.db.exec('COMMIT');
          this.bump(touched);
        } catch (e) {
          await this.db.exec('ROLLBACK').catch(() => {});
          throw e;
        }
        return applied;
      })
      .then((applied) => {
        if (applied) this.emit('sync');
        return applied;
      });
  }

  /**
   * Forget a group on this device: the group, its members and every row in
   * it, with any edits to them still waiting to be sent (the server would
   * refuse them). Used when the account leaves or loses the group, and before
   * pulling a group again from the start.
   */
  dropGroup(groupId: string): Promise<void> {
    return this.queue
      .run(async () => {
        await this.db.exec('BEGIN');
        try {
          for (const table of GROUP_TABLES) {
            await this.db.run(`DELETE FROM outbox WHERE tbl = ? AND row_id IN (SELECT id FROM ${table} WHERE group_id = ?)`, [table, groupId]);
            await this.db.run(`DELETE FROM ${table} WHERE group_id = ?`, [groupId]);
          }
          await this.db.run('DELETE FROM group_members WHERE group_id = ?', [groupId]);
          await this.db.run('DELETE FROM groups WHERE id = ?', [groupId]);
          await this.db.exec('COMMIT');
          this.bump(new Map([...GROUP_TABLES, 'group_members', 'groups'].map((t) => [t as TableName, null])));
        } catch (e) {
          await this.db.exec('ROLLBACK').catch(() => {});
          throw e;
        }
      })
      .then(() => this.emit('sync'));
  }

  /** The group a row belongs to on this device, or null. */
  groupIdOf(table: TableName, id: string): Promise<string | null> {
    if (!GROUP_TABLES.includes(table)) return Promise.resolve(null);
    return this.queue.run(async () => {
      const [row] = await this.db.all<{ group_id: string | null }>(`SELECT group_id FROM ${table} WHERE id = ?`, [id]);
      return row?.group_id ?? null;
    });
  }

  /**
   * Set fields of a row on this device only (no outbox, no undo), to match
   * what the server is known to hold, e.g. after it refused a change.
   */
  correct(table: TableName, id: string, patch: Record<string, unknown>): Promise<void> {
    const cols = columnsOf(table);
    const keys = Object.keys(patch).filter((k) => k in cols);
    if (!keys.length) return Promise.resolve();
    return this.queue
      .run(async () => {
        await this.db.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
          ...keys.map((k) => encode(cols[k].type, patch[k])),
          id,
        ]);
        this.bump(new Map([[table, new Set([id])]]));
      })
      .then(() => this.emit('sync'));
  }

  /** Ids of the groups this device holds rows for. */
  localGroupIds(): Promise<string[]> {
    return this.queue.run(async () => {
      const raw = await this.db.all<{ id: string }>('SELECT id FROM groups UNION SELECT DISTINCT group_id AS id FROM tasks WHERE group_id IS NOT NULL');
      return raw.map((r) => r.id);
    });
  }

  /** Drop every synced row (not the outbox), before pulling everything again. */
  clearSynced(): Promise<void> {
    return this.queue
      .run(async () => {
        await this.db.exec('BEGIN');
        try {
          for (const table of TABLE_NAMES) await this.db.run(`DELETE FROM ${table}`);
          await this.db.exec('COMMIT');
          this.bump(new Map(TABLE_NAMES.map((t) => [t, null])));
        } catch (e) {
          await this.db.exec('ROLLBACK').catch(() => {});
          throw e;
        }
      })
      .then(() => this.emit('sync'));
  }

  outboxCount(): Promise<number> {
    return this.queue.run(async () => {
      const [row] = await this.db.all<{ n: number }>('SELECT count(*) AS n FROM outbox');
      return row?.n ?? 0;
    });
  }

  /**
   * Runs `work` as one transaction. Either everything it wrote is saved and
   * queued for sync, or nothing is.
   */
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<{ result: T; undo: UndoLog }> {
    return this.queue
      .run(async () => {
        const clockBefore = this.clock.snapshot();
        const changes: Change[] = [];
        await this.db.exec('BEGIN');
        try {
          const result = await work(this.makeTx(changes));
          await this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [CLOCK_KEY, JSON.stringify(this.clock.snapshot())]);
          await this.db.exec('COMMIT');
          const touched = new Map<TableName, Set<string> | null>();
          for (const c of changes) {
            const ids = touched.get(c.table) ?? new Set<string>();
            ids.add(c.id);
            touched.set(c.table, ids);
          }
          this.bump(touched);
          return { result, undo: { changes }, changed: changes.length > 0 };
        } catch (e) {
          await this.db.exec('ROLLBACK').catch(() => {});
          this.clock = new HybridClock(this.opts.deviceId, () => this.now().getTime(), clockBefore);
          throw e;
        }
      })
      .then(({ result, undo, changed }) => {
        if (changed) this.emit('local');
        return { result, undo };
      });
  }

  /** Reverses a transaction, as new edits (so the reversal syncs too). */
  async undo(log: UndoLog): Promise<void> {
    await this.transaction(async (tx) => {
      for (const change of [...log.changes].reverse()) {
        switch (change.kind) {
          case 'insert':
          case 'restore':
            await tx.remove(change.table, change.id);
            break;
          case 'remove':
            await tx.restore(change.table, change.id);
            break;
          case 'update':
            await tx.write(change.table, change.id, change.before);
            break;
        }
      }
    });
  }

  private makeTx(changes: Change[]): Tx {
    const db = this.db;
    const userId = this.opts.userId;

    const getRaw = async (table: TableName, id: string) => {
      const [raw] = await db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
      return raw ?? null;
    };

    const queue = async (table: TableName, id: string, kind: OutboxOp['kind'], patch: Record<string, unknown>, ts: string) => {
      await db.run('INSERT INTO outbox (op_id, tbl, row_id, kind, patch, ts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        ts, table, id, kind, JSON.stringify(patch), ts, this.now().toISOString(),
      ]);
    };

    const setDeleted = async (table: TableName, id: string, deleted: boolean) => {
      const raw = await getRaw(table, id);
      if (!raw) return;
      const isDeleted = raw.deleted_at != null;
      if (isDeleted === deleted) return;
      const ts = this.clock.now();
      const nowIso = this.now().toISOString();
      const fieldTs = { ...(decode('json', raw.field_ts) as Record<string, string>), deleted_at: ts };
      await db.run(`UPDATE ${table} SET deleted_at = ?, field_ts = ?, updated_at = ? WHERE id = ?`, [
        deleted ? nowIso : null, JSON.stringify(fieldTs), nowIso, id,
      ]);
      await queue(table, id, deleted ? 'delete' : 'restore', {}, ts);
      changes.push({ table, id, kind: deleted ? 'remove' : 'restore', before: {} });
    };

    return {
      get: async (table, id) => {
        const raw = await getRaw(table, id);
        return raw ? decodeRow(table, raw) : null;
      },

      find: async (table, column, value) => {
        if (!(column in columnsOf(table)) && column !== 'id') throw new Error(`${table}.${column} is not a column`);
        const raw = await db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${column} IS ? AND deleted_at IS NULL`, [value]);
        return raw.map((r) => decodeRow(table, r));
      },

      write: async (table, id, patch) => {
        const cols = columnsOf(table);
        for (const key of Object.keys(patch)) {
          if (!(key in cols)) throw new Error(`${table}.${key} is not a column that can be written`);
        }
        const raw = await getRaw(table, id);
        const nowIso = this.now().toISOString();

        if (raw) {
          const changed = Object.keys(patch).filter((k) => encode(cols[k].type, patch[k]) !== (raw[k] ?? null));
          if (changed.length === 0) return;
          const ts = this.clock.now();
          const fieldTs = decode('json', raw.field_ts) as Record<string, string>;
          const before: Record<string, unknown> = {};
          const serverPatch: Record<string, unknown> = {};
          for (const k of changed) {
            before[k] = decode(cols[k].type, raw[k]);
            serverPatch[k] = serverValue(cols[k].type, patch[k]);
            fieldTs[k] = ts;
          }
          await db.run(
            `UPDATE ${table} SET ${changed.map((k) => `${k} = ?`).join(', ')}, field_ts = ?, updated_at = ? WHERE id = ?`,
            [...changed.map((k) => encode(cols[k].type, patch[k])), JSON.stringify(fieldTs), nowIso, id],
          );
          await queue(table, id, 'upsert', serverPatch, ts);
          changes.push({ table, id, kind: 'update', before });
          return;
        }

        // A new subtask, reminder or repeat record belongs to its task's group, as on the server.
        if (patch.group_id === undefined && typeof patch.task_id === 'string' && GROUP_TABLES.includes(table) && table !== 'tasks') {
          const parent = await getRaw('tasks', patch.task_id);
          if (parent?.group_id) patch = { ...patch, group_id: parent.group_id };
        }
        const ts = this.clock.now();
        const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
        const fieldTs = Object.fromEntries(keys.map((k) => [k, ts]));
        const serverPatch = Object.fromEntries(keys.map((k) => [k, serverValue(cols[k].type, patch[k])]));
        await db.run(
          `INSERT INTO ${table} (id, user_id, created_at, updated_at, field_ts${keys.map((k) => `, ${k}`).join('')})
           VALUES (?, ?, ?, ?, ?${keys.map(() => ', ?').join('')})`,
          [id, userId, nowIso, nowIso, JSON.stringify(fieldTs), ...keys.map((k) => encode(cols[k].type, patch[k]))],
        );
        await queue(table, id, 'upsert', serverPatch, ts);
        changes.push({ table, id, kind: 'insert', before: {} });
      },

      remove: (table, id) => setDeleted(table, id, true),
      restore: (table, id) => setDeleted(table, id, false),
    };
  }

  close(): Promise<void> {
    return this.queue.run(() => this.db.close());
  }
}
