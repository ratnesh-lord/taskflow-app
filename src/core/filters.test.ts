import { allItems } from './agenda';
import { activeConditions, describeFilter, filterItems, matchesText, NONE_ID, readFilter, sameFilter } from './filters';
import { makeTask } from './fixtures';

const now = { date: '2026-11-14', minutes: 600 };
const a = makeTask({ title: 'AWS revision', priority: 'critical', dueDate: '2026-11-13', projectId: 'p1', notes: 'VPC chapter' });
const b = makeTask({ title: 'Buy milk', priority: 'low', dueDate: '2026-11-14', categoryId: 'c1' });
const c = makeTask({ title: 'Plan trip', priority: 'high', dueDate: '2026-11-20', status: 'waiting' });
const d = makeTask({ title: 'Read book', priority: 'medium' });
const e = makeTask({ title: 'Old thing', status: 'completed', completedAt: '2026-11-10T00:00:00Z' });
const items = allItems({ tasks: [a, b, c, d, e], occurrences: new Map() }, now);
const tags: Record<string, string[]> = { [a.id]: ['t-exam'], [c.id]: ['t-travel', 't-exam'] };
const ctx = { now, tagIdsOf: (id: string) => tags[id] ?? [] };
const titles = (f: Parameters<typeof filterItems>[1]) => filterItems(items, f, ctx).map((i) => i.task.title);

describe('filters', () => {
  it('shows open tasks by due date by default, undated last', () => {
    expect(titles({})).toEqual(['AWS revision', 'Buy milk', 'Plan trip', 'Read book']);
  });

  it('filters by each condition', () => {
    expect(titles({ due: 'overdue' })).toEqual(['AWS revision']);
    expect(titles({ due: 'today' })).toEqual(['Buy milk']);
    expect(titles({ due: 'next7' })).toEqual(['Plan trip']);
    expect(titles({ due: 'none' })).toEqual(['Read book']);
    expect(titles({ priorities: ['critical', 'high'] })).toEqual(['AWS revision', 'Plan trip']);
    expect(titles({ statuses: ['waiting'] })).toEqual(['Plan trip']);
    expect(titles({ projectIds: ['p1'] })).toEqual(['AWS revision']);
    expect(titles({ projectIds: [NONE_ID] })).toEqual(['Buy milk', 'Plan trip', 'Read book']);
    expect(titles({ categoryIds: ['c1'] })).toEqual(['Buy milk']);
    expect(titles({ tagIds: ['t-exam'] })).toEqual(['AWS revision', 'Plan trip']);
    expect(titles({ show: 'completed' })).toEqual(['Old thing']);
    expect(titles({ show: 'all' })).toHaveLength(5);
  });

  it('combines conditions', () => {
    expect(titles({ tagIds: ['t-exam'], priorities: ['high'] })).toEqual(['Plan trip']);
  });

  it('searches title, description and notes, every word', () => {
    expect(titles({ text: 'vpc' })).toEqual(['AWS revision']);
    expect(titles({ text: 'aws vpc' })).toEqual(['AWS revision']);
    expect(titles({ text: 'aws milk' })).toEqual([]);
    expect(matchesText(items[0], '   ')).toBe(true);
  });

  it('sorts', () => {
    expect(titles({ sort: 'priority' })).toEqual(['AWS revision', 'Plan trip', 'Read book', 'Buy milk']);
    expect(titles({ sort: 'title' })).toEqual(['AWS revision', 'Buy milk', 'Plan trip', 'Read book']);
  });

  it('describes and counts a filter', () => {
    const names = { project: () => 'Study', category: () => 'Home', tag: (id: string) => id.slice(2) };
    expect(describeFilter({}, names)).toBe('All open tasks');
    expect(describeFilter({ due: 'overdue', priorities: ['high'], tagIds: ['t-exam'], projectIds: ['p1'] }, names)).toBe('Overdue · High · Study · #exam');
    expect(activeConditions({ due: 'overdue', priorities: ['high'], sort: 'title' })).toBe(2);
  });

  it('reads a saved filter safely', () => {
    expect(readFilter({ due: 'overdue', priorities: ['high', 'bogus'], sort: 'nope', extra: 1 })).toEqual({ due: 'overdue', priorities: ['high'] });
    expect(readFilter(null)).toEqual({});
    expect(readFilter('text')).toEqual({});
  });
});

describe('sameFilter', () => {
  it('ignores the order of chosen values, spelled-out defaults and search text', () => {
    expect(sameFilter({ priorities: ['high', 'critical'] }, { priorities: ['critical', 'high'], show: 'open', due: 'any', sort: 'due', text: 'x' })).toBe(true);
  });
  it('tells different filters apart', () => {
    expect(sameFilter({ priorities: ['high'] }, { priorities: ['critical'] })).toBe(false);
    expect(sameFilter({ due: 'overdue' }, {})).toBe(false);
    expect(sameFilter({ sort: 'priority' }, {})).toBe(false);
  });
});
