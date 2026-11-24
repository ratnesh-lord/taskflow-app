/**
 * The Eisenhower matrix: open tasks sorted by two questions.
 *
 *   Urgent     overdue, or due within the next two days
 *   Important  critical or high priority
 *
 * Both come from fields a task already has, so the matrix needs nothing
 * stored of its own, and moving a task to another box changes the task
 * itself: its priority, its date, or both.
 */
import { allItems, compareItems, type Snapshot, type TaskItem } from './agenda';
import { addDays, type LocalDate, type Now } from './dates';
import type { Priority } from './types';

export type Quadrant = 'do' | 'schedule' | 'delegate' | 'drop';

export const URGENT_DAYS = 2;
/** Moving a task out of Urgent gives it this many days. */
export const NOT_URGENT_DAYS = 7;

export const QUADRANTS: readonly { key: Quadrant; title: string; hint: string; urgent: boolean; important: boolean }[] = [
  { key: 'do', title: 'Do now', hint: 'Urgent and important', urgent: true, important: true },
  { key: 'schedule', title: 'Schedule', hint: 'Important, not urgent', urgent: false, important: true },
  { key: 'delegate', title: 'Delegate', hint: 'Urgent, not important', urgent: true, important: false },
  { key: 'drop', title: 'Drop', hint: 'Neither', urgent: false, important: false },
];

export function isUrgent(item: Pick<TaskItem, 'date'>, today: LocalDate): boolean {
  return item.date != null && item.date <= addDays(today, URGENT_DAYS);
}

export function isImportant(item: Pick<TaskItem, 'task'>): boolean {
  return item.task.priority === 'critical' || item.task.priority === 'high';
}

export function quadrantOf(item: Pick<TaskItem, 'date' | 'task'>, today: LocalDate): Quadrant {
  const u = isUrgent(item, today);
  const i = isImportant(item);
  return u && i ? 'do' : i ? 'schedule' : u ? 'delegate' : 'drop';
}

/** Every open task, in its box, in the usual order. */
export function matrixOf(data: Snapshot, now: Now): Record<Quadrant, TaskItem[]> {
  const out: Record<Quadrant, TaskItem[]> = { do: [], schedule: [], delegate: [], drop: [] };
  for (const item of allItems(data, now)) {
    if (item.open) out[quadrantOf(item, now.date)].push(item);
  }
  for (const list of Object.values(out)) list.sort(compareItems);
  return out;
}

export type MatrixMove = { priority?: Priority; date?: LocalDate };

/**
 * What changes when a task is moved to a box. Into Important: high priority
 * (a critical task stays critical). Out of it: medium. Into Urgent: due
 * today. Out of it: due in a week. Nothing changes along an axis the task
 * already sits right on.
 */
export function moveTo(item: Pick<TaskItem, 'date' | 'task'>, target: Quadrant, today: LocalDate): MatrixMove {
  const box = QUADRANTS.find((q) => q.key === target)!;
  const out: MatrixMove = {};
  if (box.important && !isImportant(item)) out.priority = 'high';
  if (!box.important && isImportant(item)) out.priority = 'medium';
  if (box.urgent && !isUrgent(item, today)) out.date = today;
  if (!box.urgent && isUrgent(item, today)) out.date = addDays(today, NOT_URGENT_DAYS);
  return out;
}
