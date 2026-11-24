import {
  clock, endMs, finishedOnTime, finishedToday, type FocusRecord, focusMinutesByDay, focusTotals, isRunning, minutesWords,
  nextBreakMinutes, remainingMs, runningSession, spentMinutes,
} from './focus';

const toLocal = (iso: string) => iso.slice(0, 10);
const at = (iso: string) => Date.parse(iso);

const session = (over: Partial<FocusRecord> = {}): FocusRecord => ({
  id: 's1', taskId: null, kind: 'focus', startedAt: '2026-11-25T09:00:00Z', plannedMinutes: 25, endedAt: null, deviceId: 'd1', ...over,
});

describe('a session', () => {
  it('runs until its planned end with nothing more written, then counts as finished', () => {
    const s = session();
    expect(isRunning(s, at('2026-11-25T09:10:00Z'))).toBe(true);
    expect(remainingMs(s, at('2026-11-25T09:10:00Z'))).toBe(15 * 60_000);
    expect(spentMinutes(s, at('2026-11-25T09:10:30Z'))).toBe(10);
    expect(isRunning(s, at('2026-11-25T09:25:00Z'))).toBe(false);
    expect(spentMinutes(s, at('2026-11-25T12:00:00Z'))).toBe(25);
    expect(finishedOnTime(s)).toBe(true);
  });

  it('stopped early ends then and does not count as finished; stopped within 30 seconds of the end still does', () => {
    const early = session({ endedAt: '2026-11-25T09:12:00Z' });
    expect(isRunning(early, at('2026-11-25T09:13:00Z'))).toBe(false);
    expect(spentMinutes(early, at('2026-11-25T12:00:00Z'))).toBe(12);
    expect(finishedOnTime(early)).toBe(false);
    expect(finishedOnTime(session({ endedAt: '2026-11-25T09:24:40Z' }))).toBe(true);
  });

  it('a stop written after the end does not make it longer', () => {
    expect(endMs(session({ endedAt: '2026-11-25T10:00:00Z' }))).toBe(at('2026-11-25T09:25:00Z'));
  });

  it('the running one is the latest started', () => {
    const a = session({ id: 'a', startedAt: '2026-11-25T09:00:00Z' });
    const b = session({ id: 'b', startedAt: '2026-11-25T09:05:00Z' });
    const stopped = session({ id: 'c', startedAt: '2026-11-25T09:06:00Z', endedAt: '2026-11-25T09:07:00Z' });
    expect(runningSession([a, b, stopped], at('2026-11-25T09:10:00Z'))?.id).toBe('b');
    expect(runningSession([a], at('2026-11-25T10:00:00Z'))).toBeNull();
  });

  it('shows the time left as a clock', () => {
    expect(clock(25 * 60_000)).toBe('25:00');
    expect(clock(61_500)).toBe('01:02');
    expect(clock(0)).toBe('00:00');
    expect(clock(-5)).toBe('00:00');
    expect(clock(65 * 60_000)).toBe('1:05:00');
  });
});

describe('breaks and totals', () => {
  it('suggests a long break after every fourth session', () => {
    expect([0, 1, 3, 4, 5, 8].map(nextBreakMinutes)).toEqual([5, 5, 5, 15, 5, 15]);
  });

  it('counts finished focus sessions today, not breaks, not stopped ones, not the running one', () => {
    const now = at('2026-11-25T11:00:00Z');
    const list = [
      session({ id: 'a' }),
      session({ id: 'b', startedAt: '2026-11-25T09:30:00Z', endedAt: '2026-11-25T09:31:00Z' }),
      session({ id: 'c', kind: 'break', startedAt: '2026-11-25T09:40:00Z', plannedMinutes: 5 }),
      session({ id: 'd', startedAt: '2026-11-24T09:00:00Z' }),
      session({ id: 'e', startedAt: '2026-11-25T10:50:00Z' }),
    ];
    expect(finishedToday(list, '2026-11-25', now, toLocal)).toBe(1);
    expect(focusTotals(list, '2026-11-25', '2026-11-25', now, toLocal)).toEqual({ minutes: 25 + 1 + 10, sessions: 3, finished: 1 });
    expect(focusMinutesByDay(list, now, toLocal)).toEqual(new Map([['2026-11-25', 36], ['2026-11-24', 25]]));
  });

  it('writes minutes in words', () => {
    expect(minutesWords(0)).toBe('0 min');
    expect(minutesWords(25)).toBe('25 min');
    expect(minutesWords(60)).toBe('1 h');
    expect(minutesWords(100)).toBe('1 h 40 min');
  });
});
