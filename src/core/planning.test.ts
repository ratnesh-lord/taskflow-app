import type { Snapshot } from './agenda';
import { makeTask } from './fixtures';
import { goalItems, goalProgress, daysLeftWords, sortGoals } from './goals';
import { dayPlan, plannedWords, weekReview } from './planning';

const now = { date: '2026-11-25', minutes: 600 };
const toLocal = (iso: string) => iso.slice(0, 10);
const snap = (tasks: Snapshot['tasks']): Snapshot => ({ tasks, occurrences: new Map() });

describe('plan my day', () => {
  it('splits open tasks into overdue, today, undated and the next seven days, and adds up estimates', () => {
    const late = makeTask({ dueDate: '2026-11-20' });
    const t1 = makeTask({ dueDate: '2026-11-25', estimatedMinutes: 30 });
    const t2 = makeTask({ dueDate: '2026-11-25', estimatedMinutes: 90 });
    const t3 = makeTask({ dueDate: '2026-11-25' });
    const undatedLow = makeTask({ priority: 'low' });
    const undatedHigh = makeTask({ priority: 'high' });
    const soon = makeTask({ dueDate: '2026-12-02' });
    const far = makeTask({ dueDate: '2026-12-03' });
    const done = makeTask({ status: 'completed', completedAt: '2026-11-24T10:00:00Z' });
    const plan = dayPlan(snap([late, t1, t2, t3, undatedLow, undatedHigh, soon, far, done]), now, toLocal);
    expect(plan.overdue.map((i) => i.task.id)).toEqual([late.id]);
    expect(plan.today).toHaveLength(3);
    expect(plan.undated.map((i) => i.task.id)).toEqual([undatedHigh.id, undatedLow.id]);
    expect(plan.soon.map((i) => i.task.id)).toEqual([soon.id]);
    expect([plan.minutes, plan.unestimated]).toEqual([120, 1]);
    expect(plannedWords(120)).toBe('2 h');
    expect(plannedWords(80)).toBe('1 h 20 min');
    expect(plannedWords(0)).toBeNull();
  });
});

describe('weekly review', () => {
  it('the last seven days done, what slipped, and the next seven days', () => {
    const doneThisWeek = makeTask({ status: 'completed', completedAt: '2026-11-19T10:00:00Z' });
    const doneBefore = makeTask({ status: 'completed', completedAt: '2026-11-18T10:00:00Z' });
    const slipped = makeTask({ dueDate: '2026-11-22' });
    const next = makeTask({ dueDate: '2026-11-27' });
    const daily = makeTask({ dueDate: '2026-11-26', rrule: 'FREQ=DAILY' });
    const r = weekReview(snap([doneThisWeek, doneBefore, slipped, next, daily]), now, toLocal);
    expect([r.from, r.to]).toEqual(['2026-11-19', '2026-11-25']);
    expect(r.done.map((i) => i.task.id)).toEqual([doneThisWeek.id]);
    expect(r.slipped.map((i) => i.task.id)).toEqual([slipped.id]);
    expect(r.next.map((d) => [d.date, d.items.length])).toEqual([
      ['2026-11-26', 1], ['2026-11-27', 2], ['2026-11-28', 1], ['2026-11-29', 1], ['2026-11-30', 1], ['2026-12-01', 1], ['2026-12-02', 1],
    ]);
  });
});

describe('goals', () => {
  it('progress comes from linked tasks; late when past the date with tasks open', () => {
    const a = makeTask({ goalId: 'g1', status: 'completed', completedAt: '2026-11-20T10:00:00Z' });
    const b = makeTask({ goalId: 'g1' });
    const other = makeTask({ goalId: 'g2' });
    const archived = makeTask({ goalId: 'g1', status: 'archived' });
    const items = goalItems(snap([a, b, other, archived]), 'g1', now);
    expect(items).toHaveLength(2);
    expect(goalProgress({ targetDate: '2026-12-05', status: 'active' }, items, now.date)).toMatchObject({ total: 2, done: 1, percent: 50, daysLeft: 10, late: false });
    expect(goalProgress({ targetDate: '2026-11-20', status: 'active' }, items, now.date).late).toBe(true);
    expect(goalProgress({ targetDate: '2026-11-20', status: 'achieved' }, items, now.date).late).toBe(false);
    expect(goalProgress({ targetDate: null, status: 'active' }, [], now.date)).toMatchObject({ total: 0, percent: 0, daysLeft: null });
  });

  it('describes the time left and sorts active goals by date', () => {
    expect([10, 1, 0, -1, -4, null].map((d) => daysLeftWords(d))).toEqual(['Due in 10 days', 'Due tomorrow', 'Due today', '1 day past', '4 days past', null]);
    const g = (title: string, status: 'active' | 'achieved' | 'dropped', targetDate: string | null) => ({ title, status, targetDate, sortOrder: 0 });
    expect(sortGoals([g('c', 'achieved', '2026-01-01'), g('b', 'active', null), g('a', 'active', '2027-01-01'), g('d', 'active', '2026-12-01')]).map((x) => x.title))
      .toEqual(['d', 'a', 'b', 'c']);
  });
});
