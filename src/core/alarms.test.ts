import type { ReminderRecord } from './agenda';
import { closedSnoozes, planAlarms, readSummarySettings, wallClockMinus } from './alarms';
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
    const at = new Date(nowMs + 5 * 3_600_000).toISOString(); // five hours from now, in any time zone
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

describe('snoozed notifications after the task changes', () => {
  const snooze = (taskId: string | null, extra: { occurrenceDate?: string; reminderId?: string } = {}) => ({
    key: `snooze:${taskId}:${extra.occurrenceDate ?? ''}`, taskId, ...extra,
  });
  const data = (tasks: ReturnType<typeof makeTask>[], reminders: ReminderRecord[] = [], occurrences: Record<string, OccurrenceRecord[]> = {}) => ({
    tasks, reminders, occurrences: new Map(Object.entries(occurrences)),
  });

  it('a snooze for an open task stays; for a completed, archived or deleted task it is cancelled', () => {
    const open = makeTask({ title: 'Open' });
    const done = makeTask({ title: 'Done', status: 'completed' });
    const archived = makeTask({ title: 'Archived', status: 'archived' });
    const list = [snooze(open.id), snooze(done.id), snooze(archived.id), snooze('deleted-task')];
    expect(closedSnoozes(data([open, done, archived]), list)).toEqual([list[1].key, list[2].key, list[3].key]);
  });

  it('the test reminder (no task) always stays', () => {
    expect(closedSnoozes(data([]), [{ key: 'test:1' }, snooze(null)])).toEqual([]);
  });

  it('a removed or switched-off reminder cancels its snooze', () => {
    const t = makeTask({ dueDate: '2026-11-20', dueTime: '18:00' });
    const on = before(t.id, 30, 'on');
    const offRem = { ...before(t.id, 10, 'off'), isActive: false };
    const list = [snooze(t.id, { reminderId: 'on' }), { ...snooze(t.id, { reminderId: 'off' }), key: 'k-off' }, { ...snooze(t.id, { reminderId: 'gone' }), key: 'k-gone' }];
    expect(closedSnoozes(data([t], [on, offRem]), list)).toEqual(['k-off', 'k-gone']);
  });

  it('for a repeating task, only the completed or skipped day is cancelled; a moved day stays', () => {
    const t = makeTask({ dueDate: '2026-11-18', dueTime: '18:00', rrule: 'FREQ=DAILY' });
    const occ: OccurrenceRecord[] = [
      { date: '2026-11-18', status: 'completed' },
      { date: '2026-11-19', status: 'skipped' },
      { date: '2026-11-20', status: 'skipped', movedToDate: '2026-11-21' },
    ];
    const list = ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'].map((d) => snooze(t.id, { occurrenceDate: d }));
    expect(closedSnoozes(data([t], [], { [t.id]: occ }), list)).toEqual([list[0].key, list[1].key]);
  });
});

describe('emoji in notifications', () => {
  it("a reminder's title starts with the task's emoji, or its clipart's emoji; a photo adds nothing", () => {
    const cake = makeTask({ title: "Mum's birthday", dueDate: '2026-11-21', dueTime: '09:00', icon: 'e:🎂' });
    const gym = makeTask({ title: 'Gym', dueDate: '2026-11-21', dueTime: '07:00', icon: 'c:dumbbell' });
    const plain = makeTask({ title: 'Passport', dueDate: '2026-11-21', dueTime: '08:00', icon: 'i:4f1c2b8e-1d2e-4a3b-9c4d-5e6f7a8b9c0d/task-pictures/x.jpg' });
    const titles = plan([cake, gym, plain], [before(cake.id, 0), before(gym.id, 0), before(plain.id, 0)]).map((a) => a.title).sort();
    expect(titles).toEqual(['Passport', "🎂 Mum's birthday", '🏋️ Gym']);
  });

  it('the morning plan lists tasks with their emoji', () => {
    const cake = makeTask({ title: "Mum's birthday", dueDate: '2026-11-21', icon: 'e:🎂' });
    const morning = plan([cake], [], { summaries: { morning: '08:00', evening: null } }).find((a) => a.kind === 'morning' && a.local?.startsWith('2026-11-21'));
    expect(morning?.items?.map((i) => i.title)).toEqual(["🎂 Mum's birthday"]);
  });
});
