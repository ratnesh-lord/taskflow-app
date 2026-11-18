/**
 * The Db interface on expo-sqlite: native SQLite on Android, WebAssembly
 * SQLite stored in the browser's private file system (OPFS) on the web.
 * The web version needs the page to be cross-origin isolated (see metro.config.js).
 */
import * as SQLite from 'expo-sqlite';

import type { Db } from './db';

export async function openExpoDb(name: string): Promise<Db> {
  const db = await SQLite.openDatabaseAsync(name);
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
    },
    all: <T,>(sql: string, params: readonly (string | number | null)[] = []) => db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]),
    close: () => db.closeAsync(),
  };
}
