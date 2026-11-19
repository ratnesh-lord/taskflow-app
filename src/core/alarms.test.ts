import type { ReminderRecord } from './agenda';
import { planAlarms, readSummarySettings, wallClockMinus } from './alarms';
import { makeTask } from './fixtures';
import type { OccurrenceRecord } from './recurrence';

// Friday 20 November 2026, 10:00 on the phone's clock.
const now = { date: '2026-11-20', minutes: 10 * 60 };
const nowMs = new Date(2026, 10, 20, 10, 0).getTime();
const off = { morning: null, evening: null };

function plan(
  tasks: ReturnType<typeof makeTask>[],
  reminders: ReminderRecord[],
  opts: { occurrences?: Record<string, OccurrenceRecord[]>; summaries?: { morning: string | null; evening: string | null } } = {},
) {
  return planAlarms(
    { tasks, occurrences: new Map(Object.entries(opts.occurrences ?? {})), reminders },
    { now, nowMs, summaries: opts.summaries ?? off, hour12: false, projectName: (id) => (id === 'p1' ? 'Cloud exam' : undefined) },
  );
}

const before = (taskId: string, offsetMinutes: number, id = `rem-${taskId}-${offsetMinutes}`): ReminderRecord => ({
  id, taskId, kind: 'before_due', offsetMinutes, remindAt: null, isActive: true,
});

describe('planning notifications', () => {
  it("the brief's example: tomorrow at 19:00, 30 minutes before, with the project and buttons", () => {
    const t = makeTask({ title: 'Complete AWS certification revision', dueDate: '2026-11-21', dueTime: '19:00', projectId: 'p1' });
    const [a] = plan([t], [before(t.id, 30)]);
    expect(a).toMatchObject({
      kind: 'reminder', local: '2026-11-21T18:30', title: 'Complete AWS certification revision', body: 'Due at 19:00 · Cloud exam',
      taskId: t.id, actions: true, link: `taskflow://task/${t.id}`, channel: 'reminders', occurrenceDate: null,
    });
  });

  it('a reminder at the due time says Due now; one the day before says tomorrow', () => {
    const t = makeTask({ title: 'Call', dueDate: '2026-11-21', dueTime: '09:30' });
    const list = plan([t], [before(t.id, 0), before(t.id, 24 * 60)]);
    // The day-before reminder (20 Nov 09:30) has already passed at 10:00 and is left out.
    expect(list.map((a) => [a.local, a.body])).toEqual([['2026-11-21T09:30', 'Due now']]);
    const later = plan([{ ...t, dueDate: '2026-11-22' }], [before(t.id, 24 * 60)]);
    expect(later.map((a) => [a.local, a.body])).toEqual([['2026-11-21T09:30', 'Due tomorrow at 09:30']]);
  });

  it('a task with no time is reminded relative to 09:00', () => {
    const t = makeTask({ dueDate: '2026-11-22' });
    expect(plan([t], [before(t.id, 60)])[0]).toMatchObject({ local: '2026-11-22T08:00', body: 'Due today' });
  });

  it('crossing midnight backwards and month ends works on the calendar', () => {
    expect(wallClockMinus('2026-12-01', '00:15', 30)).toBe('2026-11-30T23:45');
    expect(wallClockMinus('2027-01-01', '09:00', 24 * 60)).toBe('2026-12-31T09:00');
  });

  it('a daily repeat gets one reminder per day for 30 days, each tied to its own day', () => {
    const t = makeTask({ title: 'Water the plants', dueDate: '2026-11-20', dueTime: '18:00', rrule: 'FREQ=DAILY' });
    const list = plan([t], [before(t.id, 0)]);
    expect(list).toHaveLength(30);
    expect(list[0]).toMatchObject({ local: '2026-11-20T18:00', occurrenceDate: '2026-11-20', key: `r:rem-${t.id}-0:2026-11-20` });
    expect(list[29]).toMatchObject({ local: '2026-12-19T18:00', occurrenceDate: '2026-12-19' });
  });

  it('a repeat already done today is reminded from tomorrow', () => {
    const t = makeTask({ dueDate: '2026-11-20', dueTime: '18:00', rrule: 'FREQ=DAILY' });
    const done = { [t.id]: [{ date: '2026-11-20', status: 'completed' as const, completedAt: '2026-11-20T04:00:00Z' }] };
    expect(plan([t], [before(t.id, 0)], { occurrences: done })[0].local).toBe('2026-11-21T18:00');
  });

  it('completed tasks, switched-off reminders and passed times plan nothing', () => {
    const doneTask = makeTask({ dueDate: '2026-11-21', dueTime: '10:00', status: 'completed', completedAt: '2026-11-20T03:00:00Z' });
    const late = makeTask({ dueDate: '2026-11-20', dueTime: '09:00' });
    const off1 = makeTask({ dueDate: '2026-11-21', dueTime: '10:00' });
    expect(plan([doneTask, late, off1], [before(doneTask.id, 0), before(late.id, 0), { ...before(off1.id, 0), isActive: false }])).toEqual([]);
  });

  it('a reminder for an exact moment is an instant, not a wall-clock time', () => {
    const t = makeTask({ title: 'Ring the plumber', dueDate: '2026-11-20' });
    const at = '2026-11-20T09:30:00.000Z'; // 15:00 in India
    const [a] = plan([t], [{ id: 'abs', taskId: t.id, kind: 'absolute', remindAt: at, offsetMinutes: null, isActive: true }]);
    expect(a).toMatchObject({ at: Date.parse(at), key: `a:abs:${at}` });
    expect(a.local).toBeUndefined();
  });

  it('the morning plan lists what is overdue and then the day; the evening check lists what is still open', () => {
    const late = makeTask({ title: 'Renew passport', dueDate: '2026-11-17' });
    const today = makeTask({ title: 'Call the bank', dueDate: '2026-11-20', dueTime: '16:00' });
    const tomorrow = makeTask({ title: 'Pay rent', dueDate: '2026-11-21' });
    const list = plan([late, today, tomorrow], [], { summaries: { morning: '08:00', evening: '21:00' } });
    // Today's morning (08:00) has passed; the evening check has not.
    expect(list[0]).toMatchObject({ key: 'e:2026-11-20', local: '2026-11-20T21:00', title: '{n} still open from today', titleOne: '1 still open from today' });
    expect(list[0].items?.map((i) => i.title)).toEqual(['Call the bank']);
    const sat = list.find((a) => a.key === 'm:2026-11-21')!;
    expect(sat.items?.map((i) => i.title)).toEqual(['Renew passport', 'Call the bank', 'Pay rent']);
    expect(list.find((a) => a.key === 'e:2026-11-22')).toBeUndefined(); // nothing due that day
  });

  it('summaries can be switched off or moved, from the profile settings', () => {
    expect(readSummarySettings({})).toEqual({ morning: '08:00', evening: '21:00' });
    expect(readSummarySettings({ notifications: { morning: '07:15', evening: null } })).toEqual({ morning: '07:15', evening: null });
    expect(readSummarySettings({ notifications: { morning: '7am' } })).toEqual({ morning: '08:00', evening: '21:00' });
  });

  it('everything comes soonest first, capped at 500', () => {
    const tasks = Array.from({ length: 30 }, (_, i) => makeTask({ dueDate: '2026-11-20', dueTime: '12:00', rrule: 'FREQ=DAILY', title: `R${i}` }));
    const list = plan(tasks, tasks.map((t) => before(t.id, 0)), { summaries: { morning: '08:00', evening: '21:00' } });
    expect(list).toHaveLength(500);
    const keys = list.map((a) => a.local ?? '');
    expect([...keys].sort()).toEqual(keys);
  });
});
