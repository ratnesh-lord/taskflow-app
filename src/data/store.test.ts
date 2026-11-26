import { rmSync } from 'node:fs';

import { HybridClock } from '@/core/hlc';

import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { openNodeDb } from './testing/node-db';

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK = '33333333-3333-4333-8333-333333333333';

async function openStore(path = ':memory:', at = new Date('2026-11-14T08:00:00Z')) {
  return Store.open(openNodeDb(path), { userId: USER, deviceId: DEVICE, now: () => at });
}

describe('Store', () => {
  it('creates a row and queues it in the shape sync_push takes', async () => {
    const store = await openStore();
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'Write report', priority: 'high', due_date: '2026-11-20' }));

    const [row] = await store.rows('tasks');
    expect(row).toMatchObject({ id: TASK, user_id: USER, title: 'Write report', priority: 'high', status: 'inbox', due_date: '2026-11-20', deleted_at: null, rev: 0 });
    expect(Object.keys(row.field_ts as object).sort()).toEqual(['due_date', 'priority', 'title']);

    const [op] = await store.outbox();
    expect(op).toMatchObject({ table: 'tasks', id: TASK, kind: 'upsert', patch: { title: 'Write report', priority: 'high', due_date: '2026-11-20' } });
    expect(op.ts).toMatch(/^\d{15}:\d{5}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
    expect(op.op_id).toBe(op.ts);
  });

  it('sends only the fields that actually change', async () => {
    const store = await openStore();
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A', priority: 'high' }));
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A', priority: 'low' }));
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A' }));
    const ops = await store.outbox();
    expect(ops).toHaveLength(2);
    expect(ops[1].patch).toEqual({ priority: 'low' });
    const [row] = await store.rows('tasks');
    expect((row.field_ts as Record<string, string>).priority).toBe(ops[1].ts);
    expect((row.field_ts as Record<string, string>).title).toBe(ops[0].ts);
  });

  it('stores booleans and JSON, and sends them as the server expects', async () => {
    const store = await openStore();
    await store.transaction(async (tx) => {
      await tx.write('subtasks', 's1', { task_id: TASK, title: 'Step', is_completed: true });
      await tx.write('saved_filters', 'f1', { name: 'Hot', query: { due: 'overdue', priorities: ['high'] } });
    });
    expect((await store.rows('subtasks'))[0].is_completed).toBe(true);
    expect((await store.rows('saved_filters'))[0].query).toEqual({ due: 'overdue', priorities: ['high'] });
    const ops = await store.outbox();
    expect(ops[0].patch).toEqual({ task_id: TASK, title: 'Step', is_completed: true });
    expect(ops[1].patch.query).toEqual({ due: 'overdue', priorities: ['high'] });
  });

  it('deletes by marking, queues a delete op, and can restore', async () => {
    const store = await openStore();
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A' }));
    await store.transaction((tx) => tx.remove('tasks', TASK));
    expect(await store.rows('tasks')).toEqual([]);
    expect((await store.allRows('tasks'))[0].deleted_at).toBe('2026-11-14T08:00:00.000Z');
    await store.transaction((tx) => tx.restore('tasks', TASK));
    expect(await store.rows('tasks')).toHaveLength(1);
    expect((await store.outbox()).map((o) => o.kind)).toEqual(['upsert', 'delete', 'restore']);
  });

  it('undoes a transaction with new edits that sync too', async () => {
    const store = await openStore();
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A', priority: 'high' }));
    const { undo } = await store.transaction(async (tx) => {
      await tx.write('tasks', TASK, { priority: 'low', status: 'completed' });
      await tx.write('subtasks', 's1', { task_id: TASK, title: 'New' });
      await tx.remove('tasks', TASK);
    });
    await store.undo(undo);
    const [row] = await store.rows('tasks');
    expect(row).toMatchObject({ priority: 'high', status: 'inbox', deleted_at: null });
    expect(await store.rows('subtasks')).toEqual([]);
    expect((await store.outbox()).map((o) => o.kind)).toEqual(['upsert', 'upsert', 'upsert', 'delete', 'restore', 'delete', 'upsert']);
  });

  it('saves nothing when a transaction fails', async () => {
    const store = await openStore();
    await expect(
      store.transaction(async (tx) => {
        await tx.write('tasks', TASK, { title: 'A' });
        await tx.write('tasks', 'x', { no_such_column: 1 });
      }),
    ).rejects.toThrow('tasks.no_such_column is not a column');
    expect(await store.rows('tasks')).toEqual([]);
    expect(await store.outbox()).toEqual([]);
  });

  it('refuses to write the columns the store manages', async () => {
    const store = await openStore();
    await expect(store.transaction((tx) => tx.write('tasks', TASK, { user_id: 'someone' }))).rejects.toThrow('not a column');
    await expect(store.transaction((tx) => tx.write('tasks', TASK, { rev: 5 }))).rejects.toThrow('not a column');
  });

  it('tells listeners after a change, and not after a write that changed nothing', async () => {
    const store = await openStore();
    const listener = jest.fn();
    store.subscribe(listener);
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A' }));
    await store.transaction((tx) => tx.write('tasks', TASK, { title: 'A' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps its data and clock across a restart, so stamps keep increasing', async () => {
    const path = `/tmp/taskflow-store-test-${process.pid}-${Date.now()}.db`;
    const first = await openStore(path, new Date('2026-11-14T08:00:00Z'));
    await first.transaction((tx) => tx.write('tasks', TASK, { title: 'A' }));
    const [firstOp] = await first.outbox();
    await first.close();

    // The phone's clock went backwards an hour.
    const second = await openStore(path, new Date('2026-11-14T07:00:00Z'));
    expect(await second.rows('tasks')).toHaveLength(1);
    await second.transaction((tx) => tx.write('tasks', TASK, { title: 'B' }));
    const ops = await second.outbox();
    expect(ops[1].ts > firstOp.ts).toBe(true);
    await second.close();
    rmSync(path, { force: true });
  });

  it('runs concurrent transactions one after another', async () => {
    const store = await openStore();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.transaction((tx) => tx.write('tasks', `t${i}`, { title: `T${i}` }))));
    expect(await store.rows('tasks')).toHaveLength(20);
    const ops = await store.outbox();
    expect(new Set(ops.map((o) => o.ts)).size).toBe(20);
    expect([...ops.map((o) => o.ts)].sort()).toEqual(ops.map((o) => o.ts));
  });

  it('uses the same timestamp format as the clock tests', () => {
    expect(new HybridClock(DEVICE, () => 0).now()).toMatch(/^\d{15}:\d{5}:/);
  });
});

describe('table versions and the screens\' cache', () => {
  it('moves for an edit, rows from the server and a clear, and only for the tables touched', async () => {
    const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now: () => new Date('2026-11-25T10:00:00Z') });
    const task = 'a1b2c3d4-0000-4000-8000-000000000001';
    expect([store.version('tasks'), store.version('habit_logs')]).toEqual([0, 0]);
    await store.transaction((tx) => tx.write('tasks', task, { title: 'First' }));
    expect([store.version('tasks'), store.version('habit_logs')]).toEqual([1, 0]);
    expect((await loadSnapshot(store)).tasks.map((t) => t.title)).toEqual(['First']);

    await store.transaction(async () => undefined);
    expect(store.version('tasks')).toBe(1);

    // The first edit has been sent, so the server's newer title is taken.
    await store.acknowledge((await store.outbox()).map((op) => op.seq));
    await store.applyRemote({ tasks: [{ id: task, title: 'From the server', rev: 5, field_ts: { title: '999999999999999:00000:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } }] });
    expect(store.version('tasks')).toBe(2);
    expect((await loadSnapshot(store)).tasks.map((t) => t.title)).toEqual(['From the server']);

    const { undo } = await store.transaction((tx) => tx.remove('tasks', task));
    expect((await loadSnapshot(store)).tasks).toEqual([]);
    await store.undo(undo);
    expect((await loadSnapshot(store)).tasks).toHaveLength(1);

    await store.clearSynced();
    expect(store.version('habit_logs')).toBe(1);
    expect((await loadSnapshot(store)).tasks).toEqual([]);
  });

  it('the light read matches the full read, without the sync bookkeeping', async () => {
    const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now: () => new Date('2026-11-25T10:00:00Z') });
    await store.transaction((tx) => tx.write('tasks', 'a1b2c3d4-0000-4000-8000-000000000002', { title: 'Same', due_date: '2026-11-30', estimated_minutes: 30 }));
    const [full] = await store.rows('tasks');
    const [light] = await store.view('tasks');
    const { field_ts: _ts, rev: _rev, user_id: _user, ...rest } = full as Record<string, unknown>;
    expect(light).toEqual(rest);
  });
});

describe('reading only what changed', () => {
  const at = () => new Date('2026-11-25T10:00:00Z');
  const T = (n: number) => `a1b2c3d4-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('the patched snapshot always equals a fresh read, through random edits, undos, server rows and clears', async () => {
    const { forgetCachedRows } = jest.requireActual('./snapshot') as typeof import('./snapshot');
    const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now: at });
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const undos: Awaited<ReturnType<Store['transaction']>>['undo'][] = [];
    for (let step = 0; step < 300; step += 1) {
      const n = Math.floor(rnd() * 40);
      const roll = rnd();
      if (roll < 0.45) {
        undos.push((await store.transaction((tx) => tx.write('tasks', T(n), { title: `t${step}`, due_date: rnd() < 0.5 ? '2026-11-25' : null }))).undo);
      } else if (roll < 0.6) {
        undos.push((await store.transaction(async (tx) => (await tx.get('tasks', T(n))) && tx.remove('tasks', T(n)))).undo);
      } else if (roll < 0.7 && undos.length) {
        await store.undo(undos.splice(Math.floor(rnd() * undos.length), 1)[0]);
      } else if (roll < 0.8) {
        await store.transaction(async (tx) => (await tx.get('tasks', T(n))) && tx.write('task_occurrences', T(1000 + step), { task_id: T(n), occurrence_date: '2026-11-25', status: 'completed' }));
      } else if (roll < 0.97) {
        await store.acknowledge((await store.outbox()).map((op) => op.seq));
        const count = rnd() < 0.2 ? 400 : 3;
        await store.applyRemote({
          tasks: Array.from({ length: count }, (_, i) => ({
            id: T((n + i) % 500), title: `remote ${step}`, rev: step, deleted_at: rnd() < 0.1 ? '2026-11-25T10:00:00Z' : null, field_ts: { title: `9999999999999${String(step).padStart(2, '0')}:00000:${DEVICE}` },
          })),
        });
      } else {
        await store.clearSynced();
      }
      const patched = await loadSnapshot(store);
      forgetCachedRows(store);
      const fresh = await loadSnapshot(store);
      const key = (d: typeof fresh) => ({
        tasks: [...d.tasks].sort((a, b) => a.id.localeCompare(b.id)),
        occurrences: [...d.occurrences.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort((x, y) => x.date.localeCompare(y.date))]),
      });
      expect([step, key(patched)]).toEqual([step, key(fresh)]);
    }
  });

  it('brings in many server rows at once, a row listed twice, and keeps a field with an unsent edit', async () => {
    const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now: at });
    await store.transaction((tx) => tx.write('tasks', T(1), { title: 'Mine, not sent yet' }));
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: T(100 + i), title: `Server ${i}`, priority: 'high', rev: 1 }));
    const applied = await store.applyRemote({
      tasks: [
        ...many,
        { id: T(1), title: 'Server title', priority: 'low', rev: 2 },
        { id: T(100), title: 'Server 0, newer', rev: 3 },
      ],
    });
    expect(applied).toBe(1002);
    const rows = await store.rows('tasks');
    expect(rows).toHaveLength(1001);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(T(1))).toMatchObject({ title: 'Mine, not sent yet', priority: 'low' });
    expect(byId.get(T(100))).toMatchObject({ title: 'Server 0, newer', priority: 'high', rev: 3 });
    expect(byId.get(T(1099))).toMatchObject({ title: 'Server 999', priority: 'high' });
  });
});
