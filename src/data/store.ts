/**
 * The phone's database, with every edit recorded twice:
 *
 *   1. in the table itself, with the edit's timestamp per field (field_ts),
 *      exactly as the server keeps it;
 *   2. in the outbox, as an op in the shape sync_push accepts:
 *      { op_id, table, id, kind, patch, ts }.
 *
 * Phase 4 sends the outbox. Until then it simply grows.
 *
 * All access goes through one queue, so a transaction never interleaves with
 * another read or write. Every transaction returns an undo log.
 */
import { type ClockState, HybridClock } from '@/core/hlc';

import { type Db, SerialQueue, type SqlValue } from './db';
import { columnsOf, decode, encode, LOCAL_MIGRATIONS, type TableName } from './schema';

export type Row = Record<string, unknown> & { id: string };

type ChangeKind = 'insert' | 'update' | 'remove' | 'restore';
type Change = { table: TableName; id: string; kind: ChangeKind; before: Record<string, unknown> };

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
  private readonly listeners = new Set<() => void>();
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
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
          return { result, undo: { changes }, changed: changes.length > 0 };
        } catch (e) {
          await this.db.exec('ROLLBACK').catch(() => {});
          this.clock = new HybridClock(this.opts.deviceId, () => this.now().getTime(), clockBefore);
          throw e;
        }
      })
      .then(({ result, undo, changed }) => {
        if (changed) this.emit();
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
