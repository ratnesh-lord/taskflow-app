/**
 * Decides when to sync. Anything may ask (a local edit, a change announced by
 * the server, the app coming to the front, a timer, the user); asks are
 * merged so only one sync runs at a time, and one more runs afterwards if
 * anything asked meanwhile.
 *
 *   local edit       waits a moment, so a burst of typing is one sync
 *   anything else    as soon as possible
 *   failure          tries again after 5 s, 15 s, 30 s, 1 min, 2 min, then every 5 min
 */
import type { SyncReport } from './sync';

export type SyncReason = 'start' | 'local' | 'remote' | 'foreground' | 'interval' | 'manual';

export type SyncPhase = 'idle' | 'syncing' | 'offline';

export type SyncStatus = {
  phase: SyncPhase;
  /** When the last sync finished without an error (ISO), or null. */
  lastSyncedAt: string | null;
  /** Why the last attempt failed, while it is failing. */
  error: string | null;
  /** When the next retry is due after a failure (ISO), or null. */
  retryAt: string | null;
  lastReport: SyncReport | null;
};

type Timer = ReturnType<typeof setTimeout>;

export type SchedulerOptions = {
  debounceMs?: number;
  backoffMs?: readonly number[];
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
};

const BACKOFF = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

export class SyncScheduler {
  private status: SyncStatus = { phase: 'idle', lastSyncedAt: null, error: null, retryAt: null, lastReport: null };
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private timer: Timer | null = null;
  private dueAt = Infinity;
  private timerIsDebounce = false;
  private running = false;
  private again = false;
  private failures = 0;
  private stopped = false;
  private readonly opts: Required<SchedulerOptions>;

  constructor(
    private readonly runSync: () => Promise<SyncReport>,
    options: SchedulerOptions = {},
  ) {
    this.opts = {
      debounceMs: options.debounceMs ?? 1500,
      backoffMs: options.backoffMs ?? BACKOFF,
      now: options.now ?? (() => new Date()),
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((t) => clearTimeout(t)),
    };
  }

  get current(): SyncStatus {
    return this.status;
  }

  subscribe(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Ask for a sync. A manual ask also cuts a retry wait short. */
  request(reason: SyncReason): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    // While failing, only a person or a sign of life from the server skips the wait.
    if (this.failures > 0 && reason !== 'manual' && reason !== 'remote' && reason !== 'foreground') return;
    if (reason === 'local') this.schedule(this.opts.debounceMs, true);
    else this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) this.opts.clearTimer(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  /** Plan a sync in `ms`. A debounced plan moves back with each new ask; any other keeps the sooner of two plans. */
  private schedule(ms: number, debounce = false): void {
    const at = this.opts.now().getTime() + ms;
    if (this.timer) {
      if (this.dueAt <= at && (!debounce || !this.timerIsDebounce)) return;
      this.opts.clearTimer(this.timer);
    }
    this.dueAt = at;
    this.timerIsDebounce = debounce;
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      this.dueAt = Infinity;
      void this.execute();
    }, ms);
  }

  private async execute(): Promise<void> {
    if (this.stopped || this.running) return;
    this.running = true;
    this.again = false;
    this.set({ phase: 'syncing' });
    try {
      const report = await this.runSync();
      if (this.stopped) return;
      this.failures = 0;
      this.set({ phase: 'idle', lastSyncedAt: this.opts.now().toISOString(), error: null, retryAt: null, lastReport: report });
    } catch (e) {
      if (this.stopped) return;
      const wait = this.opts.backoffMs[Math.min(this.failures, this.opts.backoffMs.length - 1)];
      this.failures += 1;
      this.set({
        phase: 'offline',
        error: e instanceof Error ? e.message : String(e),
        retryAt: new Date(this.opts.now().getTime() + wait).toISOString(),
      });
      this.running = false;
      this.again = false;
      this.schedule(wait);
      return;
    }
    this.running = false;
    if (this.again) this.schedule(0);
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }
}
