import { randomUUID } from 'node:crypto';

import { Actions } from './actions';
import { backupCounts, BackupError, backupFileName, makeBackup, readBackup, restoreBackup } from './backup';
import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { openNodeDb } from './testing/node-db';

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function setup() {
  const now = () => new Date(2026, 10, 18, 10, 0);
  const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now });
  const actions = new Actions(store, { newId: randomUUID, now });
  return { store, actions, snap: () => loadSnapshot(store) };
}

describe('export and restore', () => {
  it('a backup holds everything, survives JSON, and restoring brings deleted and changed items back', async () => {
    const { store, actions, snap } = await setup();
    const project = await actions.createProject({ name: 'Home', deadline: '2026-12-01' });
    const { id: rent } = await actions.createTask({
      title: 'Pay rent', dueDate: '2026-11-20', dueTime: '09:00', projectId: project.id, tags: ['money'], subtasks: ['Check balance'],
      reminders: [{ kind: 'before_due', offsetMinutes: 60 }],
    });
    const { id: plants } = await actions.createTask({ title: 'Water the plants', dueDate: '2026-11-18', rrule: 'FREQ=DAILY' });
    await actions.complete([plants]);
    await actions.saveFilter('Money', { tagIds: [] });

    const backup = readBackup(JSON.stringify(await makeBackup(store, { now: new Date('2026-11-18T04:30:00Z') })));
    expect(backupFileName(backup.exported_at)).toBe('taskflow-backup-2026-11-18.json');
    expect(backupCounts(backup)).toMatchObject({ projects: 1, tasks: 2, tags: 1, task_tags: 1, subtasks: 1, reminders: 1, task_occurrences: 1, saved_filters: 1 });
    expect(backup.tables.profiles).toBeUndefined();

    // After the backup: one task deleted, one renamed, one new.
    await actions.deleteTasks([rent]);
    await actions.updateTask(plants, { title: 'Water the garden' });
    const { id: added } = await actions.createTask({ title: 'Made after the backup' });

    const { changed, undo } = await restoreBackup(store, backup);
    expect(changed).toBeGreaterThan(0);
    const s = await snap();
    expect(s.tasks.map((t) => t.title).sort()).toEqual(['Made after the backup', 'Pay rent', 'Water the plants']);
    expect(s.tasks.find((t) => t.id === rent)).toMatchObject({ dueTime: '09:00', projectId: project.id });
    expect(s.subtasks.get(rent)?.map((x) => x.title)).toEqual(['Check balance']);
    expect(s.occurrences.get(plants)?.map((o) => o.status)).toEqual(['completed']);
    expect(s.tasks.find((t) => t.id === added)).toBeDefined();
    // The restore is ordinary edits, so it syncs.
    expect((await store.outbox()).slice(-3).every((o) => o.kind === 'upsert' || o.kind === 'restore')).toBe(true);

    await actions.undo(undo);
    expect((await snap()).tasks.map((t) => t.title).sort()).toEqual(['Made after the backup', 'Water the garden']);
  });

  it('restoring the same backup twice changes nothing the second time', async () => {
    const { store, actions } = await setup();
    await actions.createTask({ title: 'Once' });
    const backup = await makeBackup(store);
    await restoreBackup(store, backup);
    const before = await store.outboxCount();
    await restoreBackup(store, backup);
    expect(await store.outboxCount()).toBe(before);
  });

  it('explains files that are not usable backups', () => {
    expect(() => readBackup('not json')).toThrow(new BackupError('This file is not a TaskFlow backup: it is not readable as JSON.'));
    expect(() => readBackup('{"hello": 1}')).toThrow('This file is not a TaskFlow backup.');
    expect(() => readBackup(JSON.stringify({ format: 'taskflow-backup', version: 99, tables: {} }))).toThrow('newer version');
    expect(() => readBackup(JSON.stringify({ format: 'taskflow-backup', version: 1, tables: { tasks: [{ id: 'x' }] } }))).toThrow('no valid id');
    // A table this version does not know is skipped, not an error.
    expect(readBackup(JSON.stringify({ format: 'taskflow-backup', version: 1, tables: { future_things: [] } })).tables).toEqual({});
  });
});
