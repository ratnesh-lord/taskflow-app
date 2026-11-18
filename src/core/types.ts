/** Shared task vocabulary. Values match the database enums exactly. */

export const STATUSES = ['inbox', 'not_started', 'in_progress', 'waiting', 'completed', 'archived'] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: 'Inbox',
  not_started: 'Not started',
  in_progress: 'In progress',
  waiting: 'Waiting',
  completed: 'Completed',
  archived: 'Archived',
};

/** Statuses a task can be "open" in, i.e. still to do. */
export const OPEN_STATUSES: readonly TaskStatus[] = ['inbox', 'not_started', 'in_progress', 'waiting'];

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Higher number sorts first. */
export const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export function isOpenStatus(status: TaskStatus): boolean {
  return status !== 'completed' && status !== 'archived';
}
