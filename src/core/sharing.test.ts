import { makeTask } from './fixtures';
import { assigneeOf, canDecline, canEdit, canRemove, cleanUsername, isMine, newAssignments, personLabel } from './sharing';

const ME = 'me';
const ALICE = 'alice';

describe('who has a task', () => {
  it('a personal task is mine and I may change it', () => {
    const t = makeTask();
    expect(isMine(t, ME)).toBe(true);
    expect(canEdit(t, ME)).toBe(true);
    expect(canDecline(t, ME)).toBe(false);
  });

  it('a group task assigned to nobody belongs to its creator', () => {
    const t = makeTask({ groupId: 'g', createdBy: ALICE, ownerId: null });
    expect(assigneeOf(t)).toBe(ALICE);
    expect(isMine(t, ME)).toBe(false);
    expect(isMine(t, ALICE)).toBe(true);
    expect(canEdit(t, ME)).toBe(false);
    expect(canEdit(t, ALICE)).toBe(true);
  });

  it('a task Alice assigned to me is mine; both of us may change it; I may decline it', () => {
    const t = makeTask({ groupId: 'g', createdBy: ALICE, ownerId: ME });
    expect(isMine(t, ME)).toBe(true);
    expect(isMine(t, ALICE)).toBe(false);
    expect(canEdit(t, ME)).toBe(true);
    expect(canEdit(t, ALICE)).toBe(true);
    expect(canDecline(t, ME)).toBe(true);
    expect(canDecline(t, ALICE)).toBe(false);
  });

  it('a task I created and assigned to Alice leaves my lists but stays mine to change', () => {
    const t = makeTask({ groupId: 'g', createdBy: ME, ownerId: ALICE });
    expect(isMine(t, ME)).toBe(false);
    expect(canEdit(t, ME)).toBe(true);
    expect(canDecline(t, ME)).toBe(false);
  });

  it('a task I assigned to myself cannot be declined', () => {
    expect(canDecline(makeTask({ groupId: 'g', createdBy: ME, ownerId: ME }), ME)).toBe(false);
  });
});

describe('removing members', () => {
  it('the owner removes anyone but the owner; an admin only ordinary members', () => {
    expect(canRemove('owner', 'admin')).toBe(true);
    expect(canRemove('owner', 'member')).toBe(true);
    expect(canRemove('owner', 'owner')).toBe(false);
    expect(canRemove('admin', 'member')).toBe(true);
    expect(canRemove('admin', 'admin')).toBe(false);
    expect(canRemove('member', 'member')).toBe(false);
    expect(canRemove(null, 'member')).toBe(false);
  });
});

describe('usernames', () => {
  it('are trimmed, lower-cased and may start with @', () => {
    expect(cleanUsername('  @Alice_99 ')).toBe('alice_99');
  });
  it('are 3 to 20 letters, digits or underscores', () => {
    expect(cleanUsername('al')).toBeNull();
    expect(cleanUsername('a'.repeat(21))).toBeNull();
    expect(cleanUsername('al ice')).toBeNull();
    expect(cleanUsername('alice.b')).toBeNull();
    expect(cleanUsername('abc')).toBe('abc');
  });
  it('people are shown by name and username', () => {
    expect(personLabel({ displayName: 'Alice A', username: 'alice' })).toBe('Alice A (@alice)');
    expect(personLabel({ displayName: '', username: 'alice' })).toBe('@alice');
    expect(personLabel(null)).toBe('Someone');
  });
});

describe('new assignments', () => {
  const assigned = makeTask({ groupId: 'g', createdBy: ALICE, ownerId: ME });
  const selfAssigned = makeTask({ groupId: 'g', createdBy: ME, ownerId: ME });
  const othersTask = makeTask({ groupId: 'g', createdBy: ALICE, ownerId: ALICE });
  const done = makeTask({ groupId: 'g', createdBy: ALICE, ownerId: ME, status: 'completed' });

  it('announces a task someone else assigned to me, once', () => {
    const first = newAssignments([assigned, selfAssigned, othersTask, done], ME, {}, 1000);
    expect(first.fresh.map((t) => t.id)).toEqual([assigned.id]);
    expect(first.seen).toEqual({ [assigned.id]: 1000 });
    const again = newAssignments([assigned], ME, first.seen, 2000);
    expect(again.fresh).toEqual([]);
    expect(again.seen).toEqual({ [assigned.id]: 1000 });
  });

  it('announces it again after it was handed back and assigned anew', () => {
    const back = newAssignments([{ ...assigned, ownerId: null }], ME, { [assigned.id]: 1000 }, 2000);
    expect(back.seen).toEqual({});
    expect(newAssignments([assigned], ME, back.seen, 3000).fresh).toHaveLength(1);
  });
});
