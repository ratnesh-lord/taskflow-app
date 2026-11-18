/**
 * Test-only: the Db interface on Node's built-in SQLite, so the store's SQL
 * runs for real in Jest. Never imported by the app.
 */
import type { Db, SqlValue } from '../db';

type Statement = { run(...p: SqlValue[]): unknown; all(...p: SqlValue[]): unknown[] };
type NodeDatabase = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };

export function openNodeDb(path = ':memory:'): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => NodeDatabase };
  const db = new DatabaseSync(path);
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    all: async <T,>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    close: async () => {
      db.close();
    },
  };
}
