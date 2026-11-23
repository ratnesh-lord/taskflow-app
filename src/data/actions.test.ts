import { randomUUID } from 'node:crypto';

import { inboxItems, itemOf, nextReminder, todayView, upcomingView } from '@/core/agenda';
import { nowFrom } from '@/core/dates';
import { occurrenceId } from '@/core/ids';
import { parseQuickAdd } from '@/core/quick-add';

import { Actions, InvalidInput } from './actions';
import { type DataSnapshot, loadSnapshot } from './snapshot';
import { Store } from './store';
import { openNodeDb } from './testing/node-db';

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Saturday 14 November 2026, 10:00 on this machine's clock.
let moment = new Date(2026, 10, 14, 10, 0);
const now = () => moment;
const toLocal = (iso: string) => nowFrom(new Date(iso)).date;

async function setup() {
  moment = new Date(2026, 10, 14, 10, 0);
  const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now });
  const actions = new Actions(store, { newId: randomUUID, now });
  const snap = () => loadSnapshot(store);
  return { store, actions, snap };
}

const taskIn = (s: DataSnapshot, id: string) => {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) throw new Error('task missing');
  return t;
};

describe('creating tasks', () => {
  it('stores a task with tags, subtasks, reminders and links, parents queued first', async () => {
    const { store, actions, snap } = await setup();
    const { id } = await actions.createTask({
      title: '  Write report ', priority: 'high', dueDate: '2026-11-20', dueTime: '17:00',
      tags: ['Work', 'work', '#urgent'], subtasks: ['Outline', ' ', 'Draft'],
      reminders: [{ kind: 'before_due', offsetMinutes: 30 }, { kind: 'absolute', date: '2026-11-20', time: '09:00' }],
      links: [{ url: 'docs.google.com/document/d/abc', name: 'Brief' }],
    });
    const s = await snap();
    expect(taskIn(s, id)).toMatchObject({ title: 'Write report', priority: 'high', status: 'not_started', dueDate: '2026-11-20', dueTime: '17:00' });
    expect(s.tags.map((t) => t.name)).toEqual(['urgent', 'work']);
    expect(s.taskTags.get(id)).toHaveLength(2);
    expect(s.subtasks.get(id)?.map((x) => x.title)).toEqual(['Outline', 'Draft']);
    expect(s.reminders.map((r) => [r.kind, r.offsetMinutes ?? new Date(r.remindAt!).getHours()])).toEqual([['before_due', 30], ['absolute', 9]]);
    expect(s.links.get(id)).toMatchObject([{ url: 'https://docs.google.com/document/d/abc', name: 'Brief' }]);
    const tables = (await store.outbox()).map((o) => o.table);
    expect(tables[0]).toBe('tasks');
    expect(tables.indexOf('tags')).toBeLessThan(tables.indexOf('task_tags'));
  });

  it('puts an unorganised task in the Inbox, and takes it out once it gets a date', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Idea' });
    let s = await snap();
    expect(taskIn(s, id).status).toBe('inbox');
    expect(inboxItems(s, nowFrom(moment)).map((i) => i.task.id)).toEqual([id]);
    await actions.updateTask(id, { dueDate: '2026-11-16' });
    s = await snap();
    expect(taskIn(s, id).status).toBe('not_started');
    expect(inboxItems(s, nowFrom(moment))).toEqual([]);
  });

  it('refuses a task without a title and saves nothing', async () => {
    const { store, actions } = await setup();
    await expect(actions.createTask({ title: '   ' })).rejects.toThrow(InvalidInput);
    expect(await store.outbox()).toEqual([]);
  });

  it('creates the brief example from quick add', async () => {
    const { actions, snap } = await setup();
    const parsed = parseQuickAdd('Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before', { today: '2026-11-14', nowMinutes: 600 });
    const { id } = await actions.createFromQuickAdd(parsed);
    const s = await snap();
    expect(taskIn(s, id)).toMatchObject({ title: 'Complete AWS certification revision', dueDate: '2026-11-15', dueTime: '19:00' });
    const next = nextReminder(s, s.reminders, nowFrom(moment), moment);
    expect(next?.item.task.id).toBe(id);
    expect([next?.at.getDate(), next?.at.getHours(), next?.at.getMinutes()]).toEqual([15, 18, 30]);
  });

  it('files a quick-add task under a project by name, creating it only once', async () => {
    const { actions, snap } = await setup();
    const ctx = { today: '2026-11-14', nowMinutes: 600 };
    await actions.createFromQuickAdd(parseQuickAdd('Draft slides @deep-work', ctx));
    await actions.createFromQuickAdd(parseQuickAdd('Review slides @DeepWork', ctx));
    const s = await snap();
    expect(s.projects.map((p) => p.name)).toEqual(['Deep work']);
    expect(s.tasks.every((t) => t.projectId === s.projects[0].id)).toBe(true);
  });
});

describe('completing', () => {
  it('completes a one-off task, counts it as done today, and undoes', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Pay bill', dueDate: '2026-11-14' });
    const undo = await actions.complete([id]);
    let s = await snap();
    expect(taskIn(s, id).status).toBe('completed');
    expect(todayView(s, nowFrom(moment), toLocal).stats).toMatchObject({ scheduled: 1, done: 1, pending: 0, percent: 100 });
    await actions.undo(undo);
    s = await snap();
    expect(taskIn(s, id)).toMatchObject({ status: 'not_started', completedAt: null });
  });

  it('completes a repeating task one occurrence at a time, keeping the rest', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Stretch', dueDate: '2026-11-10', dueTime: '07:00', rrule: 'FREQ=DAILY' });
    await actions.complete([id]);
    let s = await snap();
    let item = itemOf(taskIn(s, id), s.occurrences.get(id) ?? [], nowFrom(moment));
    // Four days late: the 10th is done, the 11th–13th are skipped in one go, today is next.
    expect(item).toMatchObject({ date: '2026-11-14', open: true, overdue: true });
    expect(s.occurrences.get(id)?.map((o) => [o.date, o.status])).toEqual([['2026-11-10', 'completed'], ['2026-11-13', 'skipped']]);
    expect(taskIn(s, id)).toMatchObject({ status: 'not_started', dueDate: '2026-11-10', rrule: 'FREQ=DAILY' });

    await actions.complete([id]);
    s = await snap();
    item = itemOf(taskIn(s, id), s.occurrences.get(id) ?? [], nowFrom(moment));
    expect(item.date).toBe('2026-11-15');
    const view = todayView(s, nowFrom(moment), toLocal);
    expect(view.doneToday).toHaveLength(2);
    expect(upcomingView(s, nowFrom(moment), '2026-11-15', '2026-11-17').map((d) => d.date)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17']);
  });

  it('reopens one completed occurrence', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Stretch', dueDate: '2026-11-14', rrule: 'FREQ=DAILY' });
    await actions.complete([id]);
    await actions.reopen(id, '2026-11-14');
    const s = await snap();
    expect(itemOf(taskIn(s, id), s.occurrences.get(id) ?? [], nowFrom(moment)).date).toBe('2026-11-14');
  });

  it('completes the same occurrence to the same row id on any device', async () => {
    const a = await setup();
    const { id } = await a.actions.createTask({ title: 'Stretch', dueDate: '2026-11-14', rrule: 'FREQ=DAILY' });
    await a.actions.complete([id]);
    const occ = (await a.snap()).occurrences.get(id)![0];
    expect(occ.id).toBe(occurrenceId(id, '2026-11-14'));
  });
});

describe('rescheduling', () => {
  it('moves one occurrence of a repeating task, or the whole series', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Report', dueDate: '2026-11-14', dueTime: '09:00', rrule: 'FREQ=WEEKLY' });
    await actions.reschedule([id], '2026-11-16', undefined, 'occurrence');
    let s = await snap();
    expect(itemOf(taskIn(s, id), s.occurrences.get(id) ?? [], nowFrom(moment))).toMatchObject({ date: '2026-11-16', time: '09:00' });
    expect(taskIn(s, id).dueDate).toBe('2026-11-14');

    await actions.complete([id]);
    s = await snap();
    expect(itemOf(taskIn(s, id), s.occurrences.get(id) ?? [], nowFrom(moment)).date).toBe('2026-11-21');

    await actions.reschedule([id], '2026-11-25', '18:00', 'series');
    s = await snap();
    expect(taskIn(s, id)).toMatchObject({ dueDate: '2026-11-25', dueTime: '18:00' });
  });

  it('moves a later occurrence dragged in the calendar, leaving the current one and the series alone', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Gym', dueDate: '2026-11-14', dueTime: '07:00', rrule: 'FREQ=DAILY' });
    await actions.reschedule([id], '2026-11-20', '18:30', 'occurrence', '2026-11-19');
    const s = await snap();
    const records = s.occurrences.get(id) ?? [];
    expect(records.map((r) => [r.date, r.status, r.movedToDate, r.movedToTime])).toEqual([['2026-11-19', 'skipped', '2026-11-20', '18:30']]);
    expect(itemOf(taskIn(s, id), records, nowFrom(moment))).toMatchObject({ date: '2026-11-14', time: '07:00' });
    expect(taskIn(s, id)).toMatchObject({ dueDate: '2026-11-14', dueTime: '07:00' });
    // A day that is not one of its days, or one already done, is not moved.
    const before = (await snap()).occurrences.get(id)!.length;
    await actions.complete([id]);
    await actions.reschedule([id], '2026-11-21', null, 'occurrence', '2026-11-14');
    await actions.reschedule([id], '2026-11-21', null, 'occurrence', '2026-11-10');
    expect((await snap()).occurrences.get(id)!.length).toBe(before + 1);
  });

  it('skips one occurrence', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Gym', dueDate: '2026-11-14', rrule: 'FREQ=DAILY' });
    await actions.skipOccurrence(id);
    const s = await snap();
    expect(itemOf(taskIn(s, id), s.occurrences.get(id) ?? [], nowFrom(moment)).date).toBe('2026-11-15');
    expect(todayView(s, nowFrom(moment), toLocal).stats.done).toBe(0);
  });

  it('moves several tasks at once and clears a date', async () => {
    const { actions, snap } = await setup();
    const a = (await actions.createTask({ title: 'A', dueDate: '2026-11-10' })).id;
    const b = (await actions.createTask({ title: 'B', dueDate: '2026-11-11', dueTime: '08:00' })).id;
    await actions.reschedule([a, b], '2026-11-15', undefined);
    let s = await snap();
    expect([taskIn(s, a).dueDate, taskIn(s, b).dueDate, taskIn(s, b).dueTime]).toEqual(['2026-11-15', '2026-11-15', '08:00']);
    await actions.reschedule([b], null, undefined);
    s = await snap();
    expect([taskIn(s, b).dueDate, taskIn(s, b).dueTime]).toEqual([null, null]);
  });
});

describe('editing', () => {
  it('sets and clears the completion time with the status', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'A' });
    await actions.updateTask(id, { status: 'completed' });
    expect(taskIn(await snap(), id).completedAt).toBe(moment.toISOString());
    await actions.updateTask(id, { status: 'waiting' });
    expect(taskIn(await snap(), id)).toMatchObject({ status: 'waiting', completedAt: null });
  });

  it('replaces tags, and brings back a tag used again', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'A', tags: ['exam', 'aws'] });
    await actions.setTags(id, ['AWS']);
    let s = await snap();
    expect(s.taskTags.get(id)?.map((t) => s.tags.find((x) => x.id === t)?.name)).toEqual(['aws']);
    await actions.setTags(id, ['aws', 'exam']);
    s = await snap();
    expect(s.taskTags.get(id)).toHaveLength(2);
  });

  it('adds, ticks, renames and removes subtasks', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'A' });
    await actions.addSubtask(id, 'One');
    await actions.addSubtask(id, 'Two');
    let subs = (await snap()).subtasks.get(id)!;
    await actions.updateSubtask(subs[0].id, { isCompleted: true, title: 'First' });
    await actions.deleteSubtask(subs[1].id);
    subs = (await snap()).subtasks.get(id)!;
    expect(subs.map((x) => [x.title, x.isCompleted])).toEqual([['First', true]]);
  });

  it('replaces reminders', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'A', dueDate: '2026-11-15', reminders: [{ kind: 'before_due', offsetMinutes: 10 }] });
    await actions.setReminders(id, [{ kind: 'before_due', offsetMinutes: 60 }]);
    expect((await snap()).reminders.map((r) => r.offsetMinutes)).toEqual([60]);
  });

  it('duplicates a task with its subtasks, tags, reminders and links', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({
      title: 'A', status: 'completed', subtasks: ['x'], tags: ['t'], reminders: [{ kind: 'before_due', offsetMinutes: 5 }], links: [{ url: 'example.com' }],
    });
    const copy = (await actions.duplicate(id)).id;
    const s = await snap();
    expect(taskIn(s, copy)).toMatchObject({ title: 'A', status: 'not_started', completedAt: null });
    expect([s.subtasks.get(copy)?.length, s.taskTags.get(copy)?.length, s.links.get(copy)?.length]).toEqual([1, 1, 1]);
    expect(s.reminders.filter((r) => r.taskId === copy)).toHaveLength(1);
  });

  it('deletes tasks with everything attached, and undoes the delete', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'A', subtasks: ['x'], tags: ['t'], reminders: [{ kind: 'before_due', offsetMinutes: 5 }] });
    const undo = await actions.deleteTasks([id]);
    let s = await snap();
    expect([s.tasks.length, s.subtasks.size, s.reminders.length, s.taskTags.size]).toEqual([0, 0, 0, 0]);
    await actions.undo(undo);
    s = await snap();
    expect([s.tasks.length, s.subtasks.get(id)?.length, s.reminders.length, s.taskTags.get(id)?.length]).toEqual([1, 1, 1, 1]);
  });

  it('changes priority on several tasks at once', async () => {
    const { actions, snap } = await setup();
    const ids = [(await actions.createTask({ title: 'A' })).id, (await actions.createTask({ title: 'B' })).id];
    await actions.updateTasks(ids, { priority: 'critical', projectId: null });
    expect((await snap()).tasks.map((t) => t.priority)).toEqual(['critical', 'critical']);
  });
});

describe('projects, categories and saved filters', () => {
  it('keeps the tasks of a deleted project or category', async () => {
    const { actions, snap } = await setup();
    const project = (await actions.createProject({ name: 'Study', deadline: '2026-12-31' })).id;
    const category = (await actions.createCategory('Home')).id;
    const { id } = await actions.createTask({ title: 'Read', projectId: project, categoryId: category });
    await actions.deleteProject(project);
    await actions.deleteCategory(category);
    const s = await snap();
    expect(s.projects).toEqual([]);
    expect(s.categories).toEqual([]);
    expect(taskIn(s, id)).toMatchObject({ projectId: null, categoryId: null });
  });

  it('saves and reads back a filter', async () => {
    const { actions, snap } = await setup();
    await actions.saveFilter('Hot', { due: 'overdue', priorities: ['critical'] });
    expect((await snap()).savedFilters).toMatchObject([{ name: 'Hot', filter: { due: 'overdue', priorities: ['critical'] } }]);
  });

  it('counts edits waiting to be sent', async () => {
    const { actions, snap } = await setup();
    // The task, the tag, and the link between them.
    await actions.createTask({ title: 'A', tags: ['x'] });
    expect((await snap()).pendingEdits).toBe(3);
  });
});

describe('Mark completed from a notification', () => {
  it('completes a one-off task once; a second tap changes nothing', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Pay rent', dueDate: '2026-11-14', dueTime: '18:00' });
    expect(await actions.completeFromNotification(id, null, moment)).toBe(true);
    expect(taskIn(await snap(), id).status).toBe('completed');
    expect(await actions.completeFromNotification(id, null, moment)).toBe(false);
  });

  it("completes exactly the day the notification was for, never the next day's", async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Water the plants', dueDate: '2026-11-14', rrule: 'FREQ=DAILY' });
    expect(await actions.completeFromNotification(id, '2026-11-14', moment)).toBe(true);
    // The same notification tapped again (or after the app already ticked it): nothing more.
    expect(await actions.completeFromNotification(id, '2026-11-14', moment)).toBe(false);
    const records = (await snap()).occurrences.get(id) ?? [];
    expect(records.map((r) => [r.date, r.status])).toEqual([['2026-11-14', 'completed']]);
  });

  it('a tap for a task deleted since does nothing', async () => {
    const { actions } = await setup();
    const { id } = await actions.createTask({ title: 'Gone' });
    await actions.deleteTasks([id]);
    expect(await actions.completeFromNotification(id, null, moment)).toBe(false);
  });
});

describe('summary settings', () => {
  it('are kept in the profile beside other settings, and can be undone', async () => {
    const { store, actions, snap } = await setup();
    await store.applyRemote({ profiles: [{ id: USER, timezone: 'Asia/Kolkata', settings: { theme: 'dark' }, rev: 1 }] });
    const undo = await actions.setSummaries(USER, { morning: '07:30', evening: null });
    expect((await snap()).profile?.settings).toEqual({ theme: 'dark', notifications: { morning: '07:30', evening: null } });
    await actions.undo(undo);
    expect((await snap()).profile?.settings).toEqual({ theme: 'dark' });
  });

  it('wait for the profile to arrive from the account', async () => {
    const { actions } = await setup();
    await expect(actions.setSummaries(USER, { morning: '08:00', evening: '21:00' })).rejects.toThrow('has not arrived');
  });
});
