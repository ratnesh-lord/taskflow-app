/**
 * The sync engine against the real database functions: two devices (two
 * SQLite stores) of one account sync through sync_push and sync_pull in a
 * real Postgres with every migration applied.
 *
 * Runs only when TASKFLOW_SYNC_TEST_DB names such a database (as
 * supabase/tests/run.sh does); plain `npm test` skips it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { occurrenceId } from '@/core/ids';

import { Actions } from './actions';
import { columnsOf, TABLE_NAMES, TIME_COLUMNS, TIMESTAMP_COLUMNS } from './schema';
import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { readProblems, SyncEngine, type PullReply, type PushOp, type PushReply, type SyncTransport } from './sync';
import { openNodeDb } from './testing/node-db';

const DB = process.env.TASKFLOW_SYNC_TEST_DB;
const maybe = DB ? describe : describe.skip;

function psql(sql: string): string {
  return execFileSync('psql', ['-qAt', '-v', 'ON_ERROR_STOP=1', '-d', DB!, '-c', sql], { encoding: 'utf8' }).trim();
}

const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Calls the sync functions exactly as the app does, as the signed-in user. */
function transportFor(userId: string): SyncTransport & { offline: boolean } {
  const call = (statement: string) =>
    psql(`begin; set local role authenticated; set local request.jwt.claim.sub = ${literal(userId)}; ${statement}; commit;`);
  const t = {
    offline: false,
    async push(deviceId: string, ops: PushOp[]): Promise<PushReply> {
      if (t.offline) throw new Error('offline');
      return JSON.parse(call(`select public.sync_push(${literal(deviceId)}::uuid, ${literal(JSON.stringify(ops))}::jsonb)`));
    },
    async pull(since: number, limit: number): Promise<PullReply> {
      if (t.offline) throw new Error('offline');
      return JSON.parse(call(`select public.sync_pull(${since}, ${limit})`));
    },
  };
  return t;
}

const files: string[] = [];
afterAll(() => {
  for (const f of files) rmSync(f, { force: true });
});

async function device(userId: string, start: Date) {
  let moment = start;
  const deviceId = randomUUID();
  const file = join(tmpdir(), `taskflow-sync-${deviceId}.db`);
  files.push(file);
  const store = await Store.open(openNodeDb(file), { userId, deviceId, now: () => moment });
  const actions = new Actions(store, { newId: randomUUID, now: () => moment });
  const transport = transportFor(userId);
  const engine = new SyncEngine(store, transport, { deviceId, pushBatch: 7, pullLimit: 5 });
  return {
    store,
    actions,
    transport,
    sync: () => engine.run(),
    snap: () => loadSnapshot(store),
    /** Move this device's clock forward. */
    later: (minutes: number) => {
      moment = new Date(moment.getTime() + minutes * 60_000);
    },
  };
}

function newUser(): string {
  return psql(`select test.new_user(${literal(`${randomUUID()}@example.com`)}, 'Sync Test')`);
}

maybe('sync against the real database', () => {
  it('local tables have exactly the server columns, types and required fields', () => {
    const rows = psql(
      `select table_name, column_name, data_type, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = any (public.sync_tables())`,
    )
      .split('\n')
      .map((l) => l.split('|'));
    const sync = new Set(['id', 'user_id', 'created_at', 'updated_at', 'deleted_at', 'rev', 'field_ts']);
    for (const table of TABLE_NAMES) {
      const server = rows.filter((r) => r[0] === table && !sync.has(r[1]));
      expect([table, server.map((r) => r[1]).sort()]).toEqual([table, Object.keys(columnsOf(table)).sort()]);
      const times = server.filter((r) => r[2] === 'time without time zone').map((r) => r[1]).sort();
      expect([table, times]).toEqual([table, [...(TIME_COLUMNS[table] ?? [])].sort()]);
      const stamps = server.filter((r) => r[2] === 'timestamp with time zone').map((r) => r[1]).sort();
      expect([table, stamps]).toEqual([table, [...(TIMESTAMP_COLUMNS[table] ?? [])].sort()]);
      // A column the app always fills (it has a default here) must not hold nulls on the server.
      for (const [name, col] of Object.entries(columnsOf(table))) {
        if (col.default === undefined) continue;
        const server_col = server.find((r) => r[1] === name)!;
        expect([table, name, server_col[3]]).toEqual([table, name, 'NO']);
      }
    }
  });

  it('a task made on one device arrives on the other with every detail', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);

    const project = await phone.actions.createProject({ name: 'Cloud exam', deadline: '2026-12-01' });
    const { id } = await phone.actions.createTask({
      title: 'Complete AWS certification revision', dueDate: '2026-11-19', dueTime: '19:00', priority: 'high',
      projectId: project.id, tags: ['study'], subtasks: ['Book the exam'], reminders: [{ kind: 'before_due', offsetMinutes: 30 }],
    });
    await phone.actions.complete([id]);
    const report = await phone.sync();
    expect(report.rejected).toBe(0);
    expect(await phone.store.outboxCount()).toBe(0);

    await web.sync();
    const s = await web.snap();
    const task = s.tasks.find((t) => t.id === id)!;
    expect(task).toMatchObject({ title: 'Complete AWS certification revision', dueDate: '2026-11-19', dueTime: '19:00', priority: 'high', status: 'completed', projectId: project.id });
    // Times and timestamps are stored in the app's own form, not Postgres's.
    const raw = (await web.store.rows('tasks')).find((t) => t.id === id)!;
    expect(raw.due_time).toBe('19:00');
    expect(raw.completed_at).toMatch(/Z$/);
    expect(task.completedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(s.projects.map((p) => [p.name, p.deadline])).toEqual([['Cloud exam', '2026-12-01']]);
    expect(s.tags.map((t) => t.name)).toEqual(['study']);
    expect(s.subtasks.get(id)?.map((x) => x.title)).toEqual(['Book the exam']);
    expect(s.reminders.filter((r) => r.taskId === id)).toHaveLength(1);
    expect(s.pendingEdits).toBe(0);
  });

  it('edits to different fields on two offline devices both survive', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);
    const { id } = await phone.actions.createTask({ title: 'Pay rent', dueDate: '2026-11-20' });
    await phone.sync();
    await web.sync();

    phone.later(1);
    web.later(2);
    await phone.actions.updateTask(id, { title: 'Pay the rent' });
    await web.actions.updateTask(id, { priority: 'critical' });
    await web.sync();
    await phone.sync();
    await web.sync();

    for (const d of [phone, web]) {
      expect((await d.snap()).tasks.find((t) => t.id === id)).toMatchObject({ title: 'Pay the rent', priority: 'critical' });
    }
  });

  it('when both change the same field, the later edit wins on both devices, whichever syncs first', async () => {
    for (const order of ['earlier first', 'later first'] as const) {
      const user = newUser();
      const start = new Date(2026, 10, 18, 9, 0);
      const phone = await device(user, start);
      const web = await device(user, start);
      const { id } = await phone.actions.createTask({ title: 'Draft' });
      await phone.sync();
      await web.sync();

      phone.later(1);
      await phone.actions.updateTask(id, { title: 'Earlier edit' });
      web.later(5);
      await web.actions.updateTask(id, { title: 'Later edit' });
      if (order === 'earlier first') {
        await phone.sync();
        await web.sync();
        await phone.sync();
      } else {
        await web.sync();
        await phone.sync();
        await web.sync();
      }
      for (const d of [phone, web]) {
        expect([order, (await d.snap()).tasks.find((t) => t.id === id)?.title]).toEqual([order, 'Later edit']);
        expect(await d.store.outboxCount()).toBe(0);
      }
    }
  });

  it('a deletion reaches the other device, and so does undoing it', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);
    const { id } = await phone.actions.createTask({ title: 'Old idea' });
    await phone.sync();
    await web.sync();

    phone.later(1);
    const undo = await phone.actions.deleteTasks([id]);
    await phone.sync();
    await web.sync();
    expect((await web.snap()).tasks.find((t) => t.id === id)).toBeUndefined();

    phone.later(1);
    await phone.actions.undo(undo);
    await phone.sync();
    await web.sync();
    expect((await web.snap()).tasks.find((t) => t.id === id)?.title).toBe('Old idea');
  });

  it('a repeat completed on one device shows done on the other, and the same day done on both stays one record', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);
    const { id } = await phone.actions.createTask({ title: 'Water the plants', dueDate: '2026-11-18', rrule: 'FREQ=DAILY' });
    await phone.sync();
    await web.sync();

    // Both devices tick today's time while offline.
    phone.later(1);
    web.later(2);
    await phone.actions.complete([id]);
    await web.actions.complete([id]);
    await phone.sync();
    await web.sync();
    await phone.sync();

    const rows = psql(`select count(*) from public.task_occurrences where task_id = ${literal(id)}`);
    expect(rows).toBe('1');
    const occ = occurrenceId(id, '2026-11-18');
    for (const d of [phone, web]) {
      const records = (await d.snap()).occurrences.get(id) ?? [];
      expect(records.map((r) => [r.date, r.status])).toEqual([['2026-11-18', 'completed']]);
      expect(records[0].id ?? occ).toBe(occ);
    }
  });

  it('a field still waiting to be sent is not overwritten by a pull; other fields are', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);
    const { id } = await phone.actions.createTask({ title: 'Report' });
    await phone.sync();
    await web.sync();

    web.later(1);
    await web.actions.updateTask(id, { priority: 'low' });
    await web.sync();

    phone.later(2);
    await phone.actions.updateTask(id, { title: 'Quarterly report' });
    phone.transport.offline = true;
    await expect(phone.sync()).rejects.toThrow('offline');
    phone.transport.offline = false;

    // Pull only (a push would send the title): the title waits, the priority arrives.
    const pulled = await phone.store.applyRemote(
      JSON.parse(psql(`begin; set local role authenticated; set local request.jwt.claim.sub = ${literal(user)}; select public.sync_pull(0, 100); commit;`)).changes,
    );
    expect(pulled).toBeGreaterThan(0);
    expect((await phone.snap()).tasks.find((t) => t.id === id)).toMatchObject({ title: 'Quarterly report', priority: 'low' });

    await phone.sync();
    await web.sync();
    expect((await web.snap()).tasks.find((t) => t.id === id)).toMatchObject({ title: 'Quarterly report', priority: 'low' });
  });

  it('edits made offline wait in the outbox and go up when the connection is back', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);
    phone.transport.offline = true;
    for (let i = 1; i <= 20; i += 1) await phone.actions.createTask({ title: `Offline task ${i}` });
    await expect(phone.sync()).rejects.toThrow('offline');
    expect(await phone.store.outboxCount()).toBe(20);

    phone.transport.offline = false;
    const report = await phone.sync();
    expect(report.pushed).toBe(20);
    await web.sync();
    expect((await web.snap()).tasks).toHaveLength(20);
  });

  it('a device too far behind starts over, keeping its own unsent edits', async () => {
    const user = newUser();
    const start = new Date(2026, 10, 18, 9, 0);
    const phone = await device(user, start);
    const web = await device(user, start);
    await phone.actions.createTask({ title: 'Kept' });
    await phone.sync();
    await web.sync();
    const { id: gone } = await phone.actions.createTask({ title: 'Deleted long ago' });
    await phone.sync();
    await web.sync();
    phone.later(1);
    await phone.actions.deleteTasks([gone]);
    await phone.sync();

    // The web device was offline while the deletion was purged (as after 90 days).
    psql(`update public.sync_state set purge_rev = rev where user_id = ${literal(user)}`);
    web.later(3);
    const { id: mine } = await web.actions.createTask({ title: 'Made while away' });
    const report = await web.sync();
    expect(report.reset).toBe(true);
    const titles = (await web.snap()).tasks.map((t) => t.title).sort();
    expect(titles).toEqual(['Kept', 'Made while away']);
    expect(titles).not.toContain('Deleted long ago');
    await phone.sync();
    expect((await phone.snap()).tasks.find((t) => t.id === mine)?.title).toBe('Made while away');
  });

  it('an edit the server refuses leaves the outbox and is listed as a problem', async () => {
    const user = newUser();
    const phone = await device(user, new Date(2026, 10, 18, 9, 0));
    // A task pointing at a project that exists nowhere: the database refuses it.
    await phone.store.transaction((tx) => tx.write('tasks', randomUUID(), { title: 'Orphan', project_id: randomUUID() }));
    const report = await phone.sync();
    expect(report.rejected).toBe(1);
    expect(await phone.store.outboxCount()).toBe(0);
    const problems = await readProblems(phone.store);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ table: 'tasks' });
  });

  it("one account never receives another account's tasks", async () => {
    const a = await device(newUser(), new Date(2026, 10, 18, 9, 0));
    const b = await device(newUser(), new Date(2026, 10, 18, 9, 0));
    await a.actions.createTask({ title: 'Private to A' });
    await a.sync();
    await b.sync();
    expect((await b.snap()).tasks).toHaveLength(0);
  });
});
