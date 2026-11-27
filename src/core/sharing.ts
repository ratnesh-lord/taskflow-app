/**
 * Who a shared task belongs to, and who may do what with it.
 *
 * A task is personal (no group) or belongs to a group. A group task has:
 *   createdBy  the person who made it
 *   ownerId    the person it is assigned to; null means its creator has it
 *   isPrivate  only creator and owner see it (the server enforces this)
 *
 * Rules (the database enforces the same ones; these let the screens offer
 * only what will be accepted):
 *   - Creator and owner may change everything, including who it is assigned
 *     to. Other members can only look.
 *   - A task is "mine" when it is personal, assigned to me, or created by me
 *     and assigned to nobody. Mine is what Today, Upcoming, the widgets and
 *     the reminders use, so a task assigned to someone else leaves my lists
 *     and only its owner is reminded.
 */
import type { TaskRecord } from './agenda';
import { isOpenStatus } from './types';

export type Sharing = Pick<TaskRecord, 'groupId' | 'ownerId' | 'createdBy' | 'isPrivate'>;

export type GroupRole = 'owner' | 'admin' | 'member';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** A username as the server stores it, or null when it cannot be one. */
export function cleanUsername(text: string): string | null {
  const u = text.trim().toLowerCase().replace(/^@/, '');
  return USERNAME_RE.test(u) ? u : null;
}

/** Who has the task: its owner, or its creator when it is assigned to nobody. */
export function assigneeOf(task: Sharing): string | null {
  return task.ownerId ?? task.createdBy ?? null;
}

export function isGroupTask(task: Sharing): boolean {
  return !!task.groupId;
}

/** A task in my own lists: personal, assigned to me, or mine and assigned to nobody. */
export function isMine(task: Sharing, me: string): boolean {
  if (!task.groupId) return true;
  return assigneeOf(task) === me;
}

/** May I change this task (and its subtasks, reminders and repeats)? */
export function canEdit(task: Sharing, me: string): boolean {
  if (!task.groupId) return true;
  return task.createdBy === me || task.ownerId === me || task.createdBy == null;
}

/** May I hand it back to its creator? (Only the person it is assigned to, when that is not the creator.) */
export function canDecline(task: Sharing, me: string): boolean {
  return !!task.groupId && task.ownerId === me && task.createdBy !== me;
}

export function canManageMembers(role: GroupRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

/** May someone with `role` remove a member whose role is `target`? */
export function canRemove(role: GroupRole | null, target: GroupRole): boolean {
  if (target === 'owner') return false;
  return role === 'owner' || (role === 'admin' && target === 'member');
}

/**
 * Open group tasks assigned to me by someone else that I have not been told
 * about yet. `seen` maps task id to when I was first told (ms); the result
 * carries the new map, which also forgets tasks no longer assigned to me (so
 * a task handed back and assigned again is announced again).
 */
export function newAssignments(
  tasks: readonly TaskRecord[],
  me: string,
  seen: Readonly<Record<string, number>>,
  nowMs: number,
): { fresh: TaskRecord[]; seen: Record<string, number> } {
  const next: Record<string, number> = {};
  const fresh: TaskRecord[] = [];
  for (const t of tasks) {
    if (!t.groupId || t.ownerId !== me || t.createdBy === me || !isOpenStatus(t.status)) continue;
    if (seen[t.id] !== undefined) next[t.id] = seen[t.id];
    else {
      next[t.id] = nowMs;
      fresh.push(t);
    }
  }
  return { fresh, seen: next };
}

/** "Alice A (@alice)", or just one of them. */
export function personLabel(p: { displayName?: string | null; username?: string | null } | null | undefined): string {
  if (!p) return 'Someone';
  const name = (p.displayName ?? '').trim();
  const user = (p.username ?? '').trim();
  if (name && user) return `${name} (@${user})`;
  if (user) return `@${user}`;
  return name || 'Someone';
}
