import { completedOn, isOverdue, itemOf, nextReminder, todayView, upcomingView, type Snapshot } from './agenda';
import { makeTask } from './fixtures';
import type { OccurrenceRecord } from './recurrence';

// Saturday 14 November 2026, 13:30.
const now = { date: '2026-11-14', minutes: 13 * 60 + 30 };
const toLocal = (iso: string) => iso.slice(0, 10);
const snap = (tasks: Snapshot['tasks'], occurrences: Record<string, OccurrenceRecord[]> = {}): Snapshot => ({
  tasks,
  occurrences: new Map(Object.entries(occurrences)),
});

describe('overdue (scenario 11)', () => {
  it('a task due on an earlier day is overdue', () => {
    expect(isOverdue('2026-11-13', null, now)).toBe(true);
    expect(isOverdue('2026-11-13', '23:59', now)).toBe(true);
  });

  it('a task due today is overdue only once its time has passed', () => {
    expect(isOverdue('2026-11-14', '13:00', now)).toBe(true);
    expect(isOverdue('2026-11-14', '13:30', now)).toBe(false);
    expect(isOverdue('2026-11-14', '13:31', now)).toBe(false);
    expect(isOverdue('2026-11-14', null, now)).toBe(false);
  });

  it('a future task, or one with no date, is never overdue', () => {
    expect(isOverdue('2026-11-15', '00:00', now)).toBe(false);
    expect(isOverdue(null, null, now)).toBe(false);
  });

  it('completed and archived tasks are never overdue', () => {
    expect(itemOf(makeTask({ dueDate: '2026-11-01', status: 'completed' }), [], now).overdue).toBe(false);
    expect(itemOf(makeTask({ dueDate: '2026-11-01', status: 'archived' }), [], now).overdue).toBe(false);
    expect(itemOf(makeTask({ dueDate: '2026-11-01', status: 'waiting' }), [], now).overdue).toBe(true);
  });

  it('a repeating task is judged by its current occurrence', () => {
    const daily = makeTask({ dueDate: '2026-11-10', rrule: 'FREQ=DAILY' });
    expect(itemOf(daily, [], now)).toMatchObject({ date: '2026-11-10', overdue: true });
    const caughtUp: OccurrenceRecord[] = [{ date: '2026-11-13', status: 'completed', completedAt: '2026-11-13T09:00:00Z' }];
    expect(itemOf(daily, caughtUp, now)).toMatchObject({ date: '2026-11-14', overdue: false });
  });

  it('a moved occurrence is judged by the day it was moved to', () => {
    const weekly = makeTask({ dueDate: '2026-11-07', rrule: 'FREQ=WEEKLY' });
    const moved: OccurrenceRecord[] = [
      { date: '2026-11-07', status: 'completed' },
      { date: '2026-11-14', status: 'skipped', movedToDate: '2026-11-16', movedToTime: null },
    ];
    expect(itemOf(weekly, moved, now)).toMatchObject({ date: '2026-11-16', overdue: false });
  });
});

describe('the Today view', () => {
  it('splits earlier days from today, orders by time, and counts', () => {
    const late = makeTask({ title: 'Earlier today', dueDate: '2026-11-14', dueTime: '09:00' });
    const later = makeTask({ title: 'Later today', dueDate: '2026-11-14', dueTime: '19:00' });
    const anyTime = makeTask({ title: 'Any time today', dueDate: '2026-11-14', priority: 'high' });
    const anyTimeLow = makeTask({ title: 'Any time, low', dueDate: '2026-11-14', priority: 'low' });
    const yesterday = makeTask({ title: 'Yesterday', dueDate: '2026-11-13' });
    const lastWeek = makeTask({ title: 'Last week', dueDate: '2026-11-07' });
    const doneToday = makeTask({ title: 'Done', dueDate: '2026-11-14', status: 'completed', completedAt: '2026-11-14T05:00:00Z' });
    const doneYesterday = makeTask({ dueDate: '2026-11-13', status: 'completed', completedAt: '2026-11-13T05:00:00Z' });
    const tomorrow = makeTask({ dueDate: '2026-11-15' });
    const undated = makeTask({});
    const view = todayView(snap([later, anyTimeLow, late, yesterday, doneToday, anyTime, lastWeek, doneYesterday, tomorrow, undated]), now, toLocal);

    expect(view.overdue.map((i) => i.task.title)).toEqual(['Last week', 'Yesterday']);
    expect(view.today.map((i) => i.task.title)).toEqual(['Earlier today', 'Later today', 'Any time today', 'Any time, low']);
    expect(view.today[0].overdue).toBe(true);
    expect(view.doneToday.map((i) => i.task.title)).toEqual(['Done']);
    expect(view.stats).toEqual({ scheduled: 5, done: 1, pending: 4, overdue: 2, percent: 20 });
  });

  it('counts a repeating task done today, and shows its next occurrence elsewhere', () => {
    const daily = makeTask({ title: 'Stretch', dueDate: '2026-11-14', rrule: 'FREQ=DAILY' });
    const records = { [daily.id]: [{ date: '2026-11-14', status: 'completed' as const, completedAt: '2026-11-14T03:00:00Z' }] };
    const view = todayView(snap([daily], records), now, toLocal);
    expect(view.today).toEqual([]);
    expect(view.doneToday.map((i) => i.key)).toEqual([`${daily.id}@2026-11-14`]);
    expect(view.stats.percent).toBe(100);
    expect(completedOn(snap([daily], records), '2026-11-13', toLocal)).toEqual([]);
  });

  it('shows zero per cent on a day with nothing scheduled', () => {
    expect(todayView(snap([]), now, toLocal).stats).toEqual({ scheduled: 0, done: 0, pending: 0, overdue: 0, percent: 0 });
  });
});

describe('the Upcoming view', () => {
  it('lists dated tasks and every occurrence of repeating ones, by day', () => {
    const report = makeTask({ title: 'Report', dueDate: '2026-11-16', dueTime: '10:00' });
    const gym = makeTask({ title: 'Gym', dueDate: '2026-11-14', dueTime: '07:00', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' });
    const done = makeTask({ title: 'Done', dueDate: '2026-11-16', status: 'completed' });
    const days = upcomingView(snap([report, gym, done]), now, '2026-11-15', '2026-11-21');
    expect(days.map((d) => [d.date, d.items.map((i) => `${i.task.title}${i.projected ? '*' : ''}`)])).toEqual([
      ['2026-11-16', ['Gym', 'Report']],
      ['2026-11-18', ['Gym*']],
      ['2026-11-20', ['Gym*']],
    ]);
  });
});

describe('the next reminder', () => {
  it('finds the soonest reminder still to come on an open task', () => {
    const t1 = makeTask({ dueDate: '2026-11-14', dueTime: '19:00' });
    const t2 = makeTask({ dueDate: '2026-11-15', dueTime: '08:00' });
    const t3 = makeTask({ dueDate: '2026-11-14', dueTime: '18:00', status: 'completed' });
    const moment = new Date(2026, 10, 14, 13, 30);
    const next = nextReminder(snap([t1, t2, t3]), [
      { id: 'r1', taskId: t1.id, kind: 'before_due', remindAt: null, offsetMinutes: 30, isActive: true },
      { id: 'r2', taskId: t2.id, kind: 'before_due', remindAt: null, offsetMinutes: 0, isActive: true },
      { id: 'r3', taskId: t3.id, kind: 'before_due', remindAt: null, offsetMinutes: 0, isActive: true },
      { id: 'r4', taskId: t1.id, kind: 'before_due', remindAt: null, offsetMinutes: 600, isActive: true },
      { id: 'r5', taskId: t2.id, kind: 'absolute', remindAt: new Date(2026, 10, 14, 15, 0).toISOString(), offsetMinutes: null, isActive: false },
    ], now, moment);
    expect(next?.item.task.id).toBe(t1.id);
    expect(next?.at.getHours()).toBe(18);
    expect(next?.at.getMinutes()).toBe(30);
  });
});
