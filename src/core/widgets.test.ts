import { makeTask } from './fixtures';
import type { OccurrenceRecord } from './recurrence';
import { widgetData } from './widgets';

// Sunday 22 November 2026, 10:00 on the phone's clock.
const now = { date: '2026-11-22', minutes: 10 * 60 };
const toLocal = (iso: string) => iso.slice(0, 10);

function build(tasks: ReturnType<typeof makeTask>[], occurrences: Record<string, OccurrenceRecord[]> = {}, hour12 = false) {
  return widgetData({ tasks, occurrences: new Map(Object.entries(occurrences)) }, { now, nowMs: 1, toLocal, hour12 });
}

describe('widget data', () => {
  it("today's counts match the Today screen: pending today, overdue from earlier days, done today", () => {
    const late = makeTask({ title: 'Late', dueDate: '2026-11-20', priority: 'high' });
    const bill = makeTask({ title: 'Pay electricity bill', dueDate: '2026-11-22', dueTime: '13:00', priority: 'critical' });
    const call = makeTask({ title: 'Call the bank', dueDate: '2026-11-22' });
    const morning = makeTask({ title: 'Earlier today', dueDate: '2026-11-22', dueTime: '08:00' });
    const done = makeTask({ title: 'Done', dueDate: '2026-11-22', status: 'completed', completedAt: '2026-11-22T07:00:00Z' });
    const later = makeTask({ title: 'Next week', dueDate: '2026-11-29' });
    const undated = makeTask({ title: 'Someday', status: 'inbox' });
    const [today] = build([late, bill, call, morning, done, later, undated]).days;

    expect(today).toMatchObject({ date: '2026-11-22', heading: 'Sun 22 Nov', pending: 3, overdue: 1, done: 1, important: 2 });
    // Overdue first, then timed in order, then untimed. A time passed today stays in today's list.
    expect(today.rows.map((r) => [r.label, r.title, r.earlier])).toEqual([
      ['Fri 20 Nov', 'Late', true],
      ['08:00', 'Earlier today', false],
      ['13:00', 'Pay electricity bill', false],
      ['Any', 'Call the bank', false],
    ]);
    expect(today.rows[2]).toMatchObject({ due: '2026-11-22T13:00', priority: 'critical', occurrenceDate: null, taskId: bill.id });
    expect(today.rows[3].due).toBe('2026-11-22');
  });

  it('tomorrow is today as it will look after midnight: what is left today becomes overdue', () => {
    const bill = makeTask({ title: 'Bill', dueDate: '2026-11-22', dueTime: '13:00' });
    const gym = makeTask({ title: 'Gym', dueDate: '2026-11-23', dueTime: '07:00' });
    const [, tomorrow] = build([bill, gym]).days;
    expect(tomorrow).toMatchObject({ date: '2026-11-23', heading: 'Mon 23 Nov', pending: 1, overdue: 1, done: 0 });
    expect(tomorrow.rows.map((r) => [r.label, r.title])).toEqual([['Sun 22 Nov', 'Bill'], ['07:00', 'Gym']]);
  });

  it('a repeating task shows its current time with that day attached', () => {
    const t = makeTask({ title: 'Water plants', dueDate: '2026-11-21', dueTime: '18:00', rrule: 'FREQ=DAILY' });
    const [today] = build([t], { [t.id]: [{ date: '2026-11-21', status: 'completed', completedAt: '2026-11-21T18:05:00Z' }] }).days;
    expect(today.rows).toEqual([
      expect.objectContaining({ taskId: t.id, occurrenceDate: '2026-11-22', label: '18:00', due: '2026-11-22T18:00', earlier: false }),
    ]);
  });

  it('the week runs Monday to Sunday with completions per day; days after today are zero', () => {
    const tasks = [
      makeTask({ status: 'completed', completedAt: '2026-11-16T09:00:00Z' }),
      makeTask({ status: 'completed', completedAt: '2026-11-16T10:00:00Z' }),
      makeTask({ status: 'completed', completedAt: '2026-11-19T10:00:00Z' }),
      makeTask({ status: 'completed', completedAt: '2026-11-22T08:00:00Z' }),
      makeTask({ status: 'completed', completedAt: '2026-11-15T10:00:00Z' }), // the Sunday before
    ];
    const [today, tomorrow] = build(tasks).days;
    expect(today.week).toEqual([2, 0, 0, 1, 0, 0, 1]);
    // Monday 23 November starts a new week.
    expect(tomorrow.week).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('times follow the 12-hour setting and the list stops at 20 rows; counts do not', () => {
    const tasks = Array.from({ length: 25 }, (_, i) => makeTask({ dueDate: '2026-11-22', dueTime: '19:30', title: `T${i}` }));
    const [today] = build(tasks, {}, true).days;
    expect(today.rows).toHaveLength(20);
    expect(today.rows[0].label).toBe('7:30 pm');
    expect(today.pending).toBe(25);
  });

  it('nothing to do gives empty rows and zero counts', () => {
    const [today] = build([]).days;
    expect(today).toMatchObject({ rows: [], pending: 0, overdue: 0, done: 0, important: 0, week: [0, 0, 0, 0, 0, 0, 0] });
  });
});
