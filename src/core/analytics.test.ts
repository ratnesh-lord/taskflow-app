import type { Snapshot } from './agenda';
import { busiestWeekday, completionRate, doneBetween, doneByPriority, doneByProject, doneCounts, donePerDay, total } from './analytics';
import { makeTask } from './fixtures';
import type { OccurrenceRecord } from './recurrence';

// Wednesday 25 November 2026.
const today = '2026-11-25';
const toLocal = (iso: string) => iso.slice(0, 10);
const snap = (tasks: Snapshot['tasks'], occurrences: Record<string, OccurrenceRecord[]> = {}): Snapshot => ({
  tasks, occurrences: new Map(Object.entries(occurrences)),
});
const done = (completedAt: string, over: Parameters<typeof makeTask>[0] = {}) => makeTask({ status: 'completed', completedAt, ...over });

describe('done counts', () => {
  it('today, this week from Monday, this calendar month', () => {
    const data = snap([
      done('2026-11-25T08:00:00Z'),
      done('2026-11-23T08:00:00Z'), // Monday
      done('2026-11-22T08:00:00Z'), // Sunday, last week
      done('2026-11-01T08:00:00Z'),
      done('2026-10-31T08:00:00Z'),
      makeTask({ dueDate: today }),
    ]);
    expect(doneCounts(data, today, toLocal)).toEqual({ today: 1, week: 2, month: 4 });
  });

  it('counts each completed occurrence of a repeating task on its own day', () => {
    const daily = makeTask({ dueDate: '2026-11-20', rrule: 'FREQ=DAILY' });
    const data = snap([daily], {
      [daily.id]: [
        { date: '2026-11-23', status: 'completed', completedAt: '2026-11-23T09:00:00Z' },
        { date: '2026-11-24', status: 'completed', completedAt: '2026-11-24T09:00:00Z' },
        { date: '2026-11-22', status: 'skipped' },
      ],
    });
    expect(donePerDay(data, '2026-11-21', today, toLocal).map((d) => d.count)).toEqual([0, 0, 1, 1, 0]);
    expect(doneBetween(data, '2026-11-24', today, toLocal)).toHaveLength(1);
  });
});

describe('completion rate', () => {
  it('done ÷ due, leaving out today what is still open and what was skipped', () => {
    const data = snap([
      done('2026-11-24T10:00:00Z', { dueDate: '2026-11-24' }),
      makeTask({ dueDate: '2026-11-23' }), // missed
      makeTask({ dueDate: today }), // today, still open: not counted yet
      done('2026-11-25T08:00:00Z', { dueDate: today }), // today, done: counted
      makeTask({ dueDate: '2026-11-10' }), // before the period
      makeTask({ dueDate: '2026-11-24', status: 'archived' }),
    ]);
    expect(completionRate(data, '2026-11-19', today)).toEqual({ due: 3, done: 2, percent: 67 });
  });

  it('a repeating task counts per occurrence; skipped ones do not count; moved ones count where they went', () => {
    const daily = makeTask({ dueDate: '2026-11-21', rrule: 'FREQ=DAILY' });
    const data = snap([daily], {
      [daily.id]: [
        { date: '2026-11-21', status: 'completed', completedAt: '2026-11-21T09:00:00Z' },
        { date: '2026-11-22', status: 'skipped' },
        { date: '2026-11-23', status: 'skipped', movedToDate: '2026-11-24' },
      ],
    });
    // 21 done, 22 skipped, 23 moved to 24 (open), 24 open, 25 today open.
    expect(completionRate(data, '2026-11-19', today)).toEqual({ due: 3, done: 1, percent: 33 });
  });

  it('is null with nothing due', () => {
    expect(completionRate(snap([]), '2026-11-19', today).percent).toBeNull();
  });
});

describe('groups', () => {
  it('by project and priority', () => {
    const items = doneBetween(snap([
      done('2026-11-24T10:00:00Z', { projectId: 'p1', priority: 'high' }),
      done('2026-11-24T11:00:00Z', { projectId: 'p1' }),
      done('2026-11-24T12:00:00Z', { priority: 'critical' }),
    ]), '2026-11-19', today, toLocal);
    expect(doneByProject(items)).toEqual([{ key: 'p1', count: 2 }, { key: null, count: 1 }]);
    expect(doneByPriority(items)).toEqual([
      { key: 'critical', count: 1 }, { key: 'high', count: 1 }, { key: 'medium', count: 1 }, { key: 'low', count: 0 },
    ]);
  });

  it('finds the busiest weekday and the total', () => {
    const days = [{ date: '2026-11-23', count: 1 }, { date: '2026-11-24', count: 4 }, { date: '2026-11-25', count: 2 }];
    expect(busiestWeekday(days)).toBe(2); // Tuesday
    expect(busiestWeekday([{ date: today, count: 0 }])).toBeNull();
    expect(total(days)).toBe(7);
  });
});
