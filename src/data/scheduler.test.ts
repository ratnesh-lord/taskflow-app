import { SyncScheduler } from './scheduler';
import type { SyncReport } from './sync';

const REPORT: SyncReport = { pushed: 0, rejected: 0, pulled: 0, rev: 1, reset: false };

function setup(outcomes: ('ok' | 'fail')[] = []) {
  jest.useFakeTimers({ now: new Date('2026-11-18T10:00:00Z') });
  let calls = 0;
  let release: (() => void) | null = null;
  let hold = false;
  const run = jest.fn(async () => {
    calls += 1;
    if (hold) await new Promise<void>((r) => (release = r));
    const outcome = outcomes.shift() ?? 'ok';
    if (outcome === 'fail') throw new Error('Network request failed');
    return REPORT;
  });
  const scheduler = new SyncScheduler(run, { debounceMs: 1500 });
  return {
    scheduler,
    run,
    calls: () => calls,
    holdNext: () => {
      hold = true;
    },
    finish: async () => {
      hold = false;
      release?.();
      await jest.advanceTimersByTimeAsync(0);
    },
  };
}

afterEach(() => jest.useRealTimers());

describe('when to sync', () => {
  it('waits for a pause in local edits, then syncs once', async () => {
    const { scheduler, run } = setup();
    scheduler.request('local');
    await jest.advanceTimersByTimeAsync(1000);
    scheduler.request('local');
    await jest.advanceTimersByTimeAsync(1000);
    expect(run).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(600);
    expect(run).toHaveBeenCalledTimes(1);
    expect(scheduler.current.phase).toBe('idle');
    expect(scheduler.current.lastSyncedAt).toBe('2026-11-18T10:00:02.500Z'); // 1.5 s after the last edit
  });

  it('a change from the server syncs at once, and a local edit does not delay it', async () => {
    const { scheduler, run } = setup();
    scheduler.request('remote');
    scheduler.request('local');
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('asks during a sync lead to exactly one more sync afterwards', async () => {
    const t = setup();
    t.holdNext();
    t.scheduler.request('manual');
    await jest.advanceTimersByTimeAsync(0);
    expect(t.scheduler.current.phase).toBe('syncing');
    t.scheduler.request('local');
    t.scheduler.request('remote');
    t.scheduler.request('remote');
    await t.finish();
    await jest.advanceTimersByTimeAsync(0);
    expect(t.run).toHaveBeenCalledTimes(2);
  });

  it('after a failure it retries later and later, and a success resets that', async () => {
    const { scheduler, run } = setup(['fail', 'fail', 'ok', 'fail']);
    scheduler.request('start');
    await jest.advanceTimersByTimeAsync(0);
    expect(scheduler.current).toMatchObject({ phase: 'offline', error: 'Network request failed', retryAt: '2026-11-18T10:00:05.000Z' });
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(scheduler.current.retryAt).toBe('2026-11-18T10:00:20.000Z');
    // Local edits do not hammer a failing connection...
    scheduler.request('local');
    await jest.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    // ...but the person can try now.
    scheduler.request('manual');
    await jest.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(3);
    expect(scheduler.current).toMatchObject({ phase: 'idle', error: null, retryAt: null });
    scheduler.request('start');
    await jest.advanceTimersByTimeAsync(0);
    expect(scheduler.current.retryAt).toBe('2026-11-18T10:00:12.000Z'); // back to the first wait, 5 s
  });

  it('does nothing once stopped (signed out)', async () => {
    const { scheduler, run } = setup();
    scheduler.request('local');
    scheduler.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
