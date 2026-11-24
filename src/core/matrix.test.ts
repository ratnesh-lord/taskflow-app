import { itemOf, type Snapshot } from './agenda';
import { makeTask } from './fixtures';
import { matrixOf, moveTo, quadrantOf } from './matrix';

const now = { date: '2026-11-25', minutes: 600 };
const today = now.date;
const item = (over: Parameters<typeof makeTask>[0]) => itemOf(makeTask(over), [], now);

describe('the Eisenhower matrix', () => {
  it('urgent means overdue or due within two days; important means critical or high', () => {
    expect(quadrantOf(item({ priority: 'high', dueDate: '2026-11-27' }), today)).toBe('do');
    expect(quadrantOf(item({ priority: 'critical', dueDate: '2026-11-20' }), today)).toBe('do');
    expect(quadrantOf(item({ priority: 'high', dueDate: '2026-11-28' }), today)).toBe('schedule');
    expect(quadrantOf(item({ priority: 'high' }), today)).toBe('schedule');
    expect(quadrantOf(item({ priority: 'medium', dueDate: today }), today)).toBe('delegate');
    expect(quadrantOf(item({ priority: 'low' }), today)).toBe('drop');
  });

  it('holds every open task once, in the usual order, and no closed ones', () => {
    const a = makeTask({ priority: 'high', dueDate: '2026-11-25', dueTime: '09:00' });
    const b = makeTask({ priority: 'critical', dueDate: '2026-11-24' });
    const c = makeTask({ priority: 'low' });
    const done = makeTask({ priority: 'high', dueDate: today, status: 'completed', completedAt: '2026-11-25T08:00:00Z' });
    const archived = makeTask({ status: 'archived' });
    const data: Snapshot = { tasks: [a, b, c, done, archived], occurrences: new Map() };
    const m = matrixOf(data, now);
    expect(m.do.map((i) => i.task.id)).toEqual([b.id, a.id]);
    expect(m.drop.map((i) => i.task.id)).toEqual([c.id]);
    expect(m.schedule).toEqual([]);
    expect(m.delegate).toEqual([]);
  });

  it('a repeating task sits where its current occurrence is', () => {
    const daily = makeTask({ priority: 'medium', dueDate: '2026-11-01', rrule: 'FREQ=DAILY' });
    const data: Snapshot = { tasks: [daily], occurrences: new Map([[daily.id, [{ date: '2026-11-24', status: 'completed' as const }]]]) };
    expect(matrixOf(data, now).delegate).toHaveLength(1);
  });

  it('moving changes only the axis that differs', () => {
    expect(moveTo(item({ priority: 'low' }), 'do', today)).toEqual({ priority: 'high', date: today });
    expect(moveTo(item({ priority: 'critical', dueDate: today }), 'schedule', today)).toEqual({ date: '2026-12-02' });
    expect(moveTo(item({ priority: 'high', dueDate: today }), 'delegate', today)).toEqual({ priority: 'medium' });
    expect(moveTo(item({ priority: 'high', dueDate: today }), 'drop', today)).toEqual({ priority: 'medium', date: '2026-12-02' });
    expect(moveTo(item({ priority: 'critical', dueDate: today }), 'do', today)).toEqual({});
  });
});
