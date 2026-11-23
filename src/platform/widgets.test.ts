import { makeTask } from '@/core/fixtures';
import { widgetData } from '@/core/widgets';
import type { DataSnapshot } from '@/data/snapshot';

import { withColors } from './widgets';

describe('widget colours', () => {
  const base = (settings: unknown) => {
    const bill = makeTask({ title: 'Bill', dueDate: '2026-11-22', priority: 'high', projectId: 'p1' });
    const call = makeTask({ title: 'Call', dueDate: '2026-11-22', priority: 'low' });
    const data = {
      tasks: [bill, call], occurrences: new Map(), projects: [{ id: 'p1', name: 'Home', color: 'teal' }], profile: { timezone: 'UTC', settings },
    } as unknown as DataSnapshot;
    const payload = widgetData(data, { now: { date: '2026-11-22', minutes: 600 }, nowMs: 1, toLocal: (s) => s.slice(0, 10), hour12: false });
    return withColors(payload, data).days[0].rows;
  };

  it("each row carries its colour bar and its priority's colour, for light and dark", () => {
    const [bill, call] = base(null);
    expect(bill).toMatchObject({ color: { light: '#C2410C', dark: '#FB923C' }, priorityColor: { light: '#C2410C', dark: '#FB923C' } });
    expect(call).toMatchObject({ color: { light: '#4B5563', dark: '#9CA3AF' } });
  });

  it('coloured by project, a task without a project has no bar but keeps its priority colour', () => {
    const [bill, call] = base({ colors: { by: 'project' } });
    expect(bill.color).toEqual({ light: '#0F766E', dark: '#2DD4BF' });
    expect(call.color).toBeNull();
    expect(call.priorityColor).toEqual({ light: '#4B5563', dark: '#9CA3AF' });
  });
});
