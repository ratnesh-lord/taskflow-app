/**
 * The Db interface on expo-sqlite: native SQLite on Android, WebAssembly
 * SQLite in a worker on the web, stored in the browser's private file system.
 * Only the async functions are used; they do not need a cross-origin isolated
 * page (expo-sqlite's sync functions would), so any static host works.
 */
import * as SQLite from 'expo-sqlite';

import type { Db } from './db';

/**
 * Profiling builds only (EXPO_PUBLIC_SQL_TIMING=1, scripts/e2e/profile.py):
 * each statement's time is added to globalThis.__taskflowSql when that array
 * exists. In every other build this is compiled away.
 */
const TIMING = process.env.EXPO_PUBLIC_SQL_TIMING === '1';

function timed<T>(sql: string, work: () => Promise<T>): Promise<T> {
  const log = (globalThis as { __taskflowSql?: { sql: string; ms: number; at: number }[] }).__taskflowSql;
  if (!log) return work();
  const start = performance.now();
  return work().finally(() => log.push({ sql: sql.slice(0, 80), ms: performance.now() - start, at: start }));
}

export async function openExpoDb(name: string): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(name);
  if (TIMING) {
    return {
      exec: (sql) => timed(sql, () => db.execAsync(sql)),
      run: (sql, params = []) => timed(sql, async () => {
        await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
      }),
      all: <T,>(sql: string, params: readonly (string | number | null)[] = []) =>
        timed(sql, () => db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[])),
      close: () => db.closeAsync(),
    };
  }
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    },
    all: <T,>(sql: string, params: readonly (string | number | null)[] = []) => db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
    close: () => db.closeAsync(),
  };
}
