/**
 * Goals: something to achieve by a date, made of the tasks linked to it.
 * A goal's progress is the share of its linked tasks that are done (a
 * repeating task counts once, as in projects).
 */
import { allItems, type Progress, progressOf, type Snapshot, type TaskItem } from './agenda';
import { diffDays, type LocalDate, type Now } from './dates';

export type GoalStatus = 'active' | 'achieved' | 'dropped';

export type GoalRecord = {
  id: string;
  title: string;
  description: string;
  targetDate: LocalDate | null;
  status: GoalStatus;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
};

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = { active: 'Active', achieved: 'Achieved', dropped: 'Dropped' };

export function goalItems(data: Snapshot, goalId: string, now: Now): TaskItem[] {
  return allItems(data, now).filter((i) => i.task.goalId === goalId && i.task.status !== 'archived');
}

export type GoalProgress = Progress & {
  /** Days until the target date (negative once past), or null without one. */
  daysLeft: number | null;
  /** An active goal whose target date has passed with tasks still open. */
  late: boolean;
};

export function goalProgress(goal: Pick<GoalRecord, 'targetDate' | 'status'>, items: readonly TaskItem[], today: LocalDate): GoalProgress {
  const p = progressOf(items);
  const daysLeft = goal.targetDate ? diffDays(today, goal.targetDate) : null;
  return { ...p, daysLeft, late: goal.status === 'active' && daysLeft != null && daysLeft < 0 && p.open > 0 };
}

/** "Due in 12 days", "Due today", "3 days late", or null. */
export function daysLeftWords(daysLeft: number | null): string | null {
  if (daysLeft == null) return null;
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  if (daysLeft > 1) return `Due in ${daysLeft} days`;
  return daysLeft === -1 ? '1 day past' : `${-daysLeft} days past`;
}

/** Active first, by target date (none last), then the rest. */
export function sortGoals<T extends Pick<GoalRecord, 'status' | 'targetDate' | 'sortOrder' | 'title'>>(goals: readonly T[]): T[] {
  const rank = { active: 0, achieved: 1, dropped: 2 } as const;
  return [...goals].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31') ||
      a.sortOrder - b.sortOrder ||
      a.title.localeCompare(b.title),
  );
}
