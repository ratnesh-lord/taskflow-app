/**
 * "Alice assigned you a task": noticing group tasks newly assigned to me.
 *
 * The device remembers which assigned tasks it has already announced (in
 * meta, with when it first saw each). The first time this runs on a device
 * it only takes note, so signing in on a new phone does not announce every
 * task assigned so far.
 *
 * The result is used twice: as a message in the app, and as a notification
 * planned a few seconds ahead (src/core/alarms.ts), which the Android runtime
 * shows even when the app has been synced in the background.
 */
import type { AssignedNotice } from '@/core/alarms';
import type { TaskRecord } from '@/core/agenda';
import { newAssignments } from '@/core/sharing';

import type { DataSnapshot } from './snapshot';
import type { Store } from './store';

export const ASSIGNMENTS_SEEN_KEY = 'assignments_seen';
/** The notification is planned this long after the assignment is first seen. */
const SHOW_AFTER_MS = 3000;
/** ...and stays in the plan this long, so replanning in between cannot cancel it. */
const KEEP_MS = 10 * 60_000;

export type Assignment = { task: TaskRecord; by: string };

export async function checkAssignments(
  store: Store,
  data: Pick<DataSnapshot, 'me' | 'groupTasks' | 'groups'>,
  nowMs: number,
): Promise<{ fresh: Assignment[]; notices: AssignedNotice[] }> {
  let seen: Record<string, number> | null = null;
  try {
    const raw = await store.getMeta(ASSIGNMENTS_SEEN_KEY);
    if (raw) seen = JSON.parse(raw) as Record<string, number>;
  } catch {
    seen = null;
  }
  const firstRun = seen === null;
  const result = newAssignments(data.groupTasks, data.me.userId, seen ?? {}, nowMs);
  if (firstRun) for (const id of Object.keys(result.seen)) result.seen[id] = 0; // noted, not announced
  if (firstRun || JSON.stringify(result.seen) !== JSON.stringify(seen)) {
    await store.setMeta(ASSIGNMENTS_SEEN_KEY, JSON.stringify(result.seen));
  }

  const people = new Map(data.groups.flatMap((g) => g.members.map((m) => [m.memberId, m] as const)));
  const byOf = (t: TaskRecord) => {
    const p = t.createdBy ? people.get(t.createdBy) : undefined;
    return p?.displayName || (p?.username ? `@${p.username}` : 'Someone');
  };
  const fresh = firstRun ? [] : result.fresh.map((task) => ({ task, by: byOf(task) }));
  const tasks = new Map(data.groupTasks.map((t) => [t.id, t]));
  const notices: AssignedNotice[] = [];
  for (const [id, at] of Object.entries(result.seen)) {
    const task = tasks.get(id);
    if (!task || !at || nowMs - at > KEEP_MS) continue;
    notices.push({ taskId: id, title: task.title, by: byOf(task), at: at + SHOW_AFTER_MS });
  }
  return { fresh, notices };
}
