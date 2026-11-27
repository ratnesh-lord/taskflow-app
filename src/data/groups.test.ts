/**
 * Group tasks on one device: the rules the app applies before anything is
 * sent (the server applies the same ones; see supabase/tests/06_groups.test.sql
 * and the two-person test in sync.db.test.ts).
 */
import { randomUUID } from 'node:crypto';

import { Actions, InvalidInput } from './actions';
import { checkAssignments } from './assignments';
import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { openNodeDb } from './testing/node-db';

const ME = '11111111-1111-4111-8111-111111111111';
const ALICE = '22222222-2222-4222-8222-222222222222';
const OUTSIDER = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function setup() {
  const moment = new Date(2026, 10, 28, 10, 0);
  const store = await Store.open(openNodeDb(), { userId: ME, deviceId: DEVICE, now: () => moment });
  const actions = new Actions(store, { newId: randomUUID, now: () => moment });
  // The group as a pull from the server would bring it.
  await store.applyRemote({
    groups: [{ id: GROUP, name: 'Flat 4', created_by: ALICE, rev: 1 }],
    group_members: [
      { id: randomUUID(), group_id: GROUP, member_id: ALICE, role: 'owner', status: 'active', username: 'alice', display_name: 'Alice', rev: 2 },
      { id: randomUUID(), group_id: GROUP, member_id: ME, role: 'member', status: 'active', username: 'me', display_name: 'Me', rev: 3 },
    ],
  });
  return { store, actions, snap: () => loadSnapshot(store) };
}

/** A group task from Alice, as pulled. */
const fromAlice = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: 'From Alice', status: 'not_started', priority: 'medium', group_id: GROUP, created_by: ALICE, owner_id: null, is_private: false,
  sort_order: 0, rev: 10, ...extra,
});

describe('group tasks on the device', () => {
  it('a task I create in a group has no project or tags, and its subtasks join the group', async () => {
    const { store, actions, snap } = await setup();
    const project = await actions.createProject({ name: 'Home' });
    await expect(actions.createTask({ title: 'Tagged', groupId: GROUP, tags: ['x'] })).rejects.toThrow(InvalidInput);
    const { id } = await actions.createTask({ title: 'Shared', groupId: GROUP, projectId: project.id, subtasks: ['Step'] });
    const s = await snap();
    expect(s.tasks.find((t) => t.id === id)).toMatchObject({ groupId: GROUP, projectId: null, createdBy: ME, ownerId: null });
    const [sub] = await store.rows('subtasks');
    expect(sub.group_id).toBe(GROUP);
    expect(s.groups.map((g) => [g.name, g.myRole, g.members.map((m) => m.username)])).toEqual([['Flat 4', 'member', ['alice', 'me']]]);
  });

  it('assigning to someone else takes the task out of my lists; assigning to an outsider is refused', async () => {
    const { actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Bins', groupId: GROUP });
    await expect(actions.assignTask(id, OUTSIDER)).rejects.toThrow('not a member');
    await actions.assignTask(id, ALICE);
    const s = await snap();
    expect(s.tasks.map((t) => t.id)).not.toContain(id);
    expect(s.groupTasks.find((t) => t.id === id)?.ownerId).toBe(ALICE);
    // As its creator I can still change it, and take it back.
    await actions.updateTask(id, { title: 'Bins, both' });
    await actions.assignTask(id, ME); // the creator taking it back is the same as nobody assigned
    expect((await snap()).tasks.find((t) => t.id === id)?.ownerId).toBeNull();
  });

  it("someone else's task can be looked at but not changed; one assigned to me can be, and handed back", async () => {
    const { store, actions, snap } = await setup();
    const theirs = randomUUID();
    const mine = randomUUID();
    await store.applyRemote({ tasks: [fromAlice(theirs), fromAlice(mine, { owner_id: ME, title: 'For me' })] });
    await expect(actions.complete([theirs])).rejects.toThrow('Only the person who created this task');
    await expect(actions.deleteTasks([theirs])).rejects.toThrow(InvalidInput);
    await actions.startFocus({ kind: 'focus', minutes: 25, taskId: theirs, deviceId: DEVICE }); // looking is fine
    expect((await snap()).tasks.map((t) => t.title)).toEqual(['For me']);
    await actions.complete([mine]);
    await actions.declineTask(mine);
    const s = await snap();
    expect(s.tasks).toEqual([]);
    expect(s.groupTasks.find((t) => t.id === mine)).toMatchObject({ ownerId: null, status: 'completed' });
    await expect(actions.declineTask(theirs)).rejects.toThrow(InvalidInput);
  });

  it('sharing a personal task moves it and its subtasks into the group and drops its tags', async () => {
    const { store, actions, snap } = await setup();
    const { id } = await actions.createTask({ title: 'Fix tap', tags: ['home'], subtasks: ['Washer'] });
    await actions.shareTask(id, GROUP, { ownerId: ALICE });
    const s = await snap();
    expect(s.groupTasks.find((t) => t.id === id)).toMatchObject({ groupId: GROUP, ownerId: ALICE, createdBy: ME });
    expect(s.taskTags.get(id)).toBeUndefined();
    expect((await store.rows('subtasks'))[0].group_id).toBe(GROUP);
    await expect(actions.shareTask(id, GROUP)).rejects.toThrow('already in a group');
  });

  it('a hidden row from the server is removed; leaving a group removes everything in it', async () => {
    const { store, snap } = await setup();
    const t = randomUUID();
    await store.applyRemote({ tasks: [fromAlice(t)], subtasks: [{ id: randomUUID(), task_id: t, title: 's', group_id: GROUP, rev: 11 }] });
    expect((await snap()).groupTasks).toHaveLength(1);
    await store.applyRemote({ tasks: [{ id: t, rev: 12, hidden: true }] });
    expect(await store.allRows('tasks')).toEqual([]);
    await store.dropGroup(GROUP);
    const s = await snap();
    expect(s.groups).toEqual([]);
    expect(await store.allRows('subtasks')).toEqual([]);
    expect(await store.allRows('group_members')).toEqual([]);
  });

  it('a newly assigned task is announced once, but not on the first look after signing in', async () => {
    const { store, snap } = await setup();
    await store.applyRemote({ tasks: [fromAlice(randomUUID(), { owner_id: ME, title: 'Old one' })] });
    expect((await checkAssignments(store, await snap(), 1000)).fresh).toEqual([]);
    await store.applyRemote({ tasks: [fromAlice(randomUUID(), { owner_id: ME, title: 'New one' })] });
    const second = await checkAssignments(store, await snap(), 2000);
    expect(second.fresh.map((a) => [a.by, a.task.title])).toEqual([['Alice', 'New one']]);
    expect(second.notices.map((n) => [n.title, n.at])).toEqual([['New one', 5000]]);
    expect((await checkAssignments(store, await snap(), 3000)).fresh).toEqual([]);
  });
});
