import { calendarDays, canDrag, dropChanges, dropFor, type ExternalEvent, inMonth, layoutTimed, minutesAt, rangeOf, step } from './calendar';
import { makeTask } from './fixtures';
import type { OccurrenceRecord } from './recurrence';

// Monday 23 November 2026, 10:00.
const now = { date: '2026-11-23', minutes: 600 };

function data(tasks: ReturnType<typeof makeTask>[], occurrences: Record<string, OccurrenceRecord[]> = {}) {
  return { tasks, occurrences: new Map(Object.entries(occurrences)) };
}

const titles = (entries: { kind: string; item?: { task: { title: string } }; event?: { title: string } }[]) =>
  entries.map((e) => (e.kind === 'task' ? e.item!.task.title : `event:${e.event!.title}`));

describe('calendar days', () => {
  it('timed tasks go on the grid with their estimate as length; others in the all-day row', () => {
    const call = makeTask({ title: 'Call', dueDate: '2026-11-24', dueTime: '09:30', estimatedMinutes: 45 });
    const bill = makeTask({ title: 'Bill', dueDate: '2026-11-24', dueTime: '13:00' });
    const shop = makeTask({ title: 'Shop', dueDate: '2026-11-24' });
    const [day] = calendarDays(data([call, bill, shop]), now, '2026-11-24', '2026-11-24');
    expect(titles(day.timed)).toEqual(['Call', 'Bill']);
    expect(day.timed.map((e) => [e.start, e.end])).toEqual([[570, 615], [780, 810]]);
    expect(titles(day.allDay)).toEqual(['Shop']);
  });

  it('every day of the range is there, empty or not', () => {
    const days = calendarDays(data([]), now, '2026-11-23', '2026-11-29');
    expect(days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
  });

  it('a repeating task shows on each of its days, moved days where they were moved to, skipped days not at all', () => {
    const t = makeTask({ title: 'Gym', dueDate: '2026-11-23', dueTime: '07:00', rrule: 'FREQ=DAILY' });
    const records: OccurrenceRecord[] = [
      { date: '2026-11-23', status: 'completed', completedAt: '2026-11-23T02:00:00Z' },
      { date: '2026-11-24', status: 'skipped' },
      { date: '2026-11-25', status: 'skipped', movedToDate: '2026-11-26', movedToTime: '18:00' },
    ];
    const days = calendarDays(data([t], { [t.id]: records }), now, '2026-11-23', '2026-11-27');
    const at = (d: string) => days.find((x) => x.date === d)!.timed.map((e) => (e.kind === 'task' ? `${e.item.occurrence?.date} ${e.item.time} ${e.done ? 'done' : 'open'}` : ''));
    expect(at('2026-11-23')).toEqual(['2026-11-23 07:00 done']);
    expect(at('2026-11-24')).toEqual([]);
    expect(at('2026-11-25')).toEqual([]);
    expect(at('2026-11-26')).toEqual(['2026-11-26 07:00 open', '2026-11-25 18:00 open']);
    expect(at('2026-11-27')).toEqual(['2026-11-27 07:00 open']);
  });

  it('completed one-off tasks stay on their day, marked done, after the open ones', () => {
    const done = makeTask({ title: 'Done', dueDate: '2026-11-23', status: 'completed', completedAt: '2026-11-23T05:00:00Z' });
    const open = makeTask({ title: 'Open', dueDate: '2026-11-23' });
    const archived = makeTask({ title: 'Archived', dueDate: '2026-11-23', status: 'archived' });
    const [day] = calendarDays(data([done, open, archived]), now, '2026-11-23', '2026-11-23');
    expect(titles(day.allDay)).toEqual(['Open', 'Done']);
    expect(day.allDay.map((e) => e.kind === 'task' && e.done)).toEqual([false, true]);
  });

  it('a task due earlier today is marked overdue; one later today is not', () => {
    const early = makeTask({ title: 'Early', dueDate: '2026-11-23', dueTime: '08:00' });
    const late = makeTask({ title: 'Late', dueDate: '2026-11-23', dueTime: '18:00' });
    const [day] = calendarDays(data([early, late]), now, '2026-11-23', '2026-11-23');
    expect(day.timed.map((e) => e.kind === 'task' && e.item.overdue)).toEqual([true, false]);
  });

  it('Google events sit beside tasks, all-day events first in the all-day row', () => {
    const t = makeTask({ title: 'Task', dueDate: '2026-11-24' });
    const events: ExternalEvent[] = [
      { key: 'e1|2026-11-24', eventId: 'e1', calendarName: 'Work', title: 'Stand-up', date: '2026-11-24', start: 600, end: 615, link: null },
      { key: 'e2|2026-11-24', eventId: 'e2', calendarName: 'Home', title: 'Holiday', date: '2026-11-24', start: null, end: null, link: null },
      { key: 'e3|2026-12-24', eventId: 'e3', calendarName: 'Home', title: 'Outside', date: '2026-12-24', start: null, end: null, link: null },
    ];
    const [day] = calendarDays(data([t]), now, '2026-11-24', '2026-11-24', events);
    expect(titles(day.allDay)).toEqual(['event:Holiday', 'Task']);
    expect(titles(day.timed)).toEqual(['event:Stand-up']);
  });
});

describe('the hour grid', () => {
  it('blocks that do not overlap each take the full width', () => {
    expect(layoutTimed([{ key: 'a', start: 540, end: 600 }, { key: 'b', start: 600, end: 660 }]).map((p) => [p.key, p.column, p.columns]))
      .toEqual([['a', 0, 1], ['b', 0, 1]]);
  });

  it('overlapping blocks share the width, reusing a column once it frees up', () => {
    const placed = layoutTimed([
      { key: 'a', start: 540, end: 660 },
      { key: 'b', start: 570, end: 600 },
      { key: 'c', start: 600, end: 630 },
      { key: 'd', start: 615, end: 700 },
    ]);
    expect(placed.map((p) => [p.key, p.column, p.columns])).toEqual([['a', 0, 3], ['b', 1, 3], ['c', 1, 3], ['d', 2, 3]]);
  });

  it('very short blocks are laid out as 30 minutes so they stay tappable', () => {
    const placed = layoutTimed([{ key: 'a', start: 540, end: 545 }, { key: 'b', start: 560, end: 590 }]);
    expect(placed.map((p) => [p.key, p.column, p.columns, p.end])).toEqual([['a', 0, 2, 570], ['b', 1, 2, 590]]);
  });

  it('a point on the grid snaps to quarter hours and stays inside the day', () => {
    const hour = 48;
    expect(minutesAt(0, hour)).toBe(0);
    expect(minutesAt(hour * 9 + 5, hour)).toBe(540);
    expect(minutesAt(hour * 9 + 9, hour)).toBe(555);
    expect(minutesAt(-30, hour)).toBe(0);
    expect(minutesAt(hour * 30, hour)).toBe(1425);
  });

  it('a drop gives a day and a time, or no time in the all-day row', () => {
    expect(dropFor('2026-11-25', 555)).toEqual({ date: '2026-11-25', time: '09:15' });
    expect(dropFor('2026-11-25', null)).toEqual({ date: '2026-11-25', time: null });
  });

  it('dropping where a task already is changes nothing', () => {
    const t = makeTask({ dueDate: '2026-11-24', dueTime: '09:00' });
    const [day] = calendarDays(data([t]), now, '2026-11-24', '2026-11-24');
    const entry = day.timed[0];
    if (entry.kind !== 'task') throw new Error('expected a task');
    expect(dropChanges(entry.item, { date: '2026-11-24', time: '09:00' })).toBe(false);
    expect(dropChanges(entry.item, { date: '2026-11-24', time: '09:15' })).toBe(true);
    expect(dropChanges(entry.item, { date: '2026-11-24', time: null })).toBe(true);
  });

  it('only open tasks can be dragged', () => {
    const open = makeTask({ dueDate: '2026-11-24' });
    const done = makeTask({ dueDate: '2026-11-24', status: 'completed', completedAt: '2026-11-24T05:00:00Z' });
    const [day] = calendarDays(data([open, done]), now, '2026-11-24', '2026-11-24', [
      { key: 'e', eventId: 'e', calendarName: 'Work', title: 'Meeting', date: '2026-11-24', start: null, end: null, link: null },
    ]);
    expect(day.allDay.map(canDrag)).toEqual([false, true, false]);
  });
});

describe('ranges', () => {
  it('day, week (Monday to Sunday), month (six whole weeks) and agenda (30 days)', () => {
    expect(rangeOf('day', '2026-11-25')).toEqual({ from: '2026-11-25', to: '2026-11-25' });
    expect(rangeOf('week', '2026-11-25')).toEqual({ from: '2026-11-23', to: '2026-11-29' });
    expect(rangeOf('month', '2026-11-25')).toEqual({ from: '2026-10-26', to: '2026-12-06' });
    expect(rangeOf('agenda', '2026-11-25')).toEqual({ from: '2026-11-25', to: '2026-12-24' });
  });

  it('stepping moves by a day, a week, a month or 30 days', () => {
    expect(step('day', '2026-11-30', 1)).toBe('2026-12-01');
    expect(step('week', '2026-11-25', -1)).toBe('2026-11-18');
    expect(step('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(step('agenda', '2026-11-25', 1)).toBe('2026-12-25');
  });

  it('month view knows which days belong to the month', () => {
    expect(inMonth('2026-11-30', '2026-11-01')).toBe(true);
    expect(inMonth('2026-12-01', '2026-11-01')).toBe(false);
  });
});
