import { randomUUID } from 'node:crypto';

import { itemOf } from '@/core/agenda';
import { nowFrom } from '@/core/dates';
import { runningSession } from '@/core/focus';
import { habitToday, streakOf } from '@/core/habits';
import { noteId } from '@/core/ids';
import { moveTo, quadrantOf } from '@/core/matrix';

import { Actions, InvalidInput } from './actions';
import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { openNodeDb } from './testing/node-db';

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Wednesday 25 November 2026, 10:00 on this machine's clock.
let moment = new Date(2026, 10, 25, 10, 0);
const now = () => moment;

async function setup() {
  moment = new Date(2026, 10, 25, 10, 0);
  const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now });
  const actions = new Actions(store, { newId: randomUUID, now });
  return { store, actions, snap: () => loadSnapshot(store) };
}

describe('goals', () => {
  it('a goal collects linked tasks; deleting it unlinks them and Undo links them back', async () => {
    const { actions, snap, store } = await setup();
    const { id: goal } = await actions.createGoal({ title: ' Run a half marathon ', targetDate: '2027-03-01' });
    const { id: task } = await actions.createTask({ title: 'Buy shoes', goalId: goal });
    let s = await snap();
    expect(s.goals).toMatchObject([{ id: goal, title: 'Run a half marathon', targetDate: '2027-03-01', status: 'active' }]);
    expect(s.tasks[0].goalId).toBe(goal);

    await actions.updateGoal(goal, { status: 'achieved' });
    expect((await snap()).goals[0].status).toBe('achieved');

    const undo = await actions.deleteGoal(goal);
    s = await snap();
    expect(s.goals).toEqual([]);
    expect(s.tasks.find((t) => t.id === task)?.goalId).toBeNull();
    await actions.undo(undo);
    s = await snap();
    expect(s.goals).toHaveLength(1);
    expect(s.tasks.find((t) => t.id === task)?.goalId).toBe(goal);
    expect((await store.outbox()).some((op) => op.table === 'goals')).toBe(true);
  });

  it('refuses a goal without a name', async () => {
    const { actions } = await setup();
    await expect(actions.createGoal({ title: '  ' })).rejects.toThrow(InvalidInput);
  });
});

describe('habits', () => {
  it('logs add up per day, "−" takes back the latest, and a streak follows', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createHabit({ title: 'Drink water', target: 8, unit: 'glasses', icon: 'e:💧', reminderTime: '11:00' });
    await actions.logHabit(id, '2026-11-24', 8);
    await actions.logHabit(id, '2026-11-25');
    moment = new Date(2026, 10, 25, 10, 5);
    await actions.logHabit(id, '2026-11-25', 2);
    let s = await snap();
    const habit = s.habits[0];
    expect(habit).toMatchObject({ title: 'Drink water', target: 8, unit: 'glasses', schedule: 'daily', reminderTime: '11:00', status: 'active' });
    expect(habitToday(habit, s.habitLogs.get(id)!, '2026-11-25').count).toBe(3);
    expect(streakOf(habit, s.habitLogs.get(id)!, '2026-11-25').current).toBe(1);

    await actions.unlogHabit(id, '2026-11-25');
    s = await snap();
    expect(habitToday(habit, s.habitLogs.get(id)!, '2026-11-25').count).toBe(1);
    expect(await actions.unlogHabit(id, '2026-11-20')).toBeNull();
  });

  it('checks names, schedules, targets and times', async () => {
    const { actions } = await setup();
    await expect(actions.createHabit({ title: '' })).rejects.toThrow('A habit needs a name.');
    await expect(actions.createHabit({ title: 'Run', schedule: 'weekly' })).rejects.toThrow(InvalidInput);
    await expect(actions.createHabit({ title: 'Run', target: 0 })).rejects.toThrow(InvalidInput);
    await expect(actions.createHabit({ title: 'Run', target: 1.5 })).rejects.toThrow(InvalidInput);
    await expect(actions.createHabit({ title: 'Run', reminderTime: '25:00' })).rejects.toThrow(InvalidInput);
    const { id } = await actions.createHabit({ title: 'Run', schedule: 'days:1,3,5' });
    await expect(actions.logHabit(id, '2026-11-25', 0)).rejects.toThrow(InvalidInput);
  });

  it('archiving keeps the history; deleting removes it', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createHabit({ title: 'Read' });
    await actions.logHabit(id, '2026-11-25');
    await actions.updateHabit(id, { status: 'archived' });
    let s = await snap();
    expect(s.habits[0].status).toBe('archived');
    expect(s.habitLogs.get(id)).toHaveLength(1);
    await actions.deleteHabit(id);
    s = await snap();
    expect(s.habits).toEqual([]);
    expect(s.habitLogs.size).toBe(0);
  });
});

describe('notes', () => {
  it('one note per day, with the same id on every device; planned and reviewed marks', async () => {
    const { actions, snap } = await setup();
    await actions.saveNote('day', '2026-11-25', 'Call the bank first.');
    await actions.saveNote('day', '2026-11-25', 'Call the bank first. Then the report.');
    await actions.setPlanned('day', '2026-11-25', true);
    await actions.saveNote('week', '2026-11-23', 'Good week.');
    const s = await snap();
    expect(s.notes.size).toBe(2);
    expect(s.notes.get('day:2026-11-25')).toMatchObject({
      id: noteId(USER, 'day', '2026-11-25'), body: 'Call the bank first. Then the report.', plannedAt: moment.toISOString(),
    });
    expect(s.notes.get('week:2026-11-23')?.body).toBe('Good week.');
    await expect(actions.saveNote('day', '2026-11-25', 'x'.repeat(20001))).rejects.toThrow(InvalidInput);
  });
});

describe('focus timer', () => {
  it('starting stops what was running; stopping ends it now', async () => {
    const { actions, snap } = await setup();
    const { id: task } = await actions.createTask({ title: 'Write report' });
    const { id: first } = await actions.startFocus({ kind: 'focus', minutes: 25, taskId: task, deviceId: DEVICE });
    moment = new Date(2026, 10, 25, 10, 10);
    const { id: second } = await actions.startFocus({ kind: 'break', minutes: 5, taskId: null, deviceId: DEVICE });
    let s = await snap();
    expect(s.focusSessions.map((x) => x.id)).toEqual([second, first]);
    expect(s.focusSessions[1]).toMatchObject({ taskId: task, endedAt: moment.toISOString(), plannedMinutes: 25, deviceId: DEVICE });
    expect(runningSession(s.focusSessions, moment.getTime())?.id).toBe(second);

    moment = new Date(2026, 10, 25, 10, 12);
    await actions.stopFocus(second);
    s = await snap();
    expect(runningSession(s.focusSessions, moment.getTime())).toBeNull();
    await expect(actions.startFocus({ kind: 'focus', minutes: 0, taskId: null, deviceId: DEVICE })).rejects.toThrow(InvalidInput);
  });

  it('a deleted task leaves its sessions with no task', async () => {
    const { actions, snap } = await setup();
    const { id: task } = await actions.createTask({ title: 'Gone' });
    await actions.startFocus({ kind: 'focus', minutes: 25, taskId: task, deviceId: DEVICE });
    await actions.deleteTasks([task]);
    expect((await snap()).focusSessions[0].taskId).toBeNull();
  });
});

describe('matrix moves', () => {
  it('changes priority and date in one step that one Undo reverses', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Plan trip', priority: 'low' });
    const nowLocal = nowFrom(moment);
    let s = await snap();
    const item = itemOf(s.tasks[0], [], nowLocal);
    const undo = await actions.applyMove(id, moveTo(item, 'do', nowLocal.date));
    s = await snap();
    expect(s.tasks[0]).toMatchObject({ priority: 'high', dueDate: '2026-11-25' });
    expect(quadrantOf(itemOf(s.tasks[0], [], nowLocal), nowLocal.date)).toBe('do');
    await actions.undo(undo);
    s = await snap();
    expect(s.tasks[0]).toMatchObject({ priority: 'low', dueDate: null });
  });

  it('moves only the current occurrence of a repeating task', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Water plants', dueDate: '2026-11-25', rrule: 'FREQ=WEEKLY' });
    await actions.applyMove(id, { date: '2026-12-02' });
    const s = await snap();
    expect(s.tasks[0].dueDate).toBe('2026-11-25');
    expect(itemOf(s.tasks[0], s.occurrences.get(id) ?? [], nowFrom(moment)).date).toBe('2026-12-02');
  });
});

describe('export and restore', () => {
  it('a backup carries goals, habits with their logs, notes and focus sessions', async () => {
    const { actions, snap } = await setup();
    const { id: goal } = await actions.createGoal({ title: 'Learn Spanish' });
    const { id: habit } = await actions.createHabit({ title: 'Read', target: 2 });
    await actions.logHabit(habit, '2026-11-25');
    await actions.saveNote('day', '2026-11-25', 'Kept in the backup.');
    await actions.startFocus({ kind: 'focus', minutes: 25, taskId: null, deviceId: DEVICE });
    const backup = await actions.exportBackup();
    const tables = backup.tables as Record<string, unknown[]>;
    for (const t of ['goals', 'habits', 'habit_logs', 'daily_notes', 'focus_sessions']) expect([t, tables[t]?.length]).toEqual([t, 1]);

    await actions.deleteGoal(goal);
    await actions.deleteHabit(habit);
    await actions.restoreBackup(backup);
    const s = await snap();
    expect(s.goals.map((g) => g.title)).toEqual(['Learn Spanish']);
    expect(s.habitLogs.get(habit)).toHaveLength(1);
    expect(s.notes.get('day:2026-11-25')?.body).toBe('Kept in the backup.');
  });
});
