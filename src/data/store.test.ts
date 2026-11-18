import { rmSync } from 'node:fs';

import { HybridClock } from '@/core/hlc';

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
