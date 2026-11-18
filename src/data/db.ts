/**
 * The few database calls the app needs, so the same code runs on
 * expo-sqlite (Android, web) and on Node's built-in SQLite (tests).
 */
export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}

/** Runs async jobs one at a time, in the order they were queued. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
