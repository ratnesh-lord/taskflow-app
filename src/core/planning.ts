/**
 * Plan my day and the weekly review: which tasks each step shows.
 */
import { allItems, compareItems, completedItems, type Snapshot, type TaskItem, todayView, type ToLocalDate, upcomingView } from './agenda';
import { addDays, type LocalDate, type Now } from './dates';
import { PRIORITY_RANK } from './types';

export type DayPlan = {
  /** Open from earlier days: bring to today, move, or let go. */
  overdue: TaskItem[];
  /** Already on today. */
  today: TaskItem[];
  /** Could be added to today: undated tasks first, then the next seven days. */
  undated: TaskItem[];
  soon: TaskItem[];
  /** Estimated minutes of today's open tasks, and how many have no estimate. */
  minutes: number;
  unestimated: number;
};

const byPriorityThenAge = (a: TaskItem, b: TaskItem) =>
  PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority] || (a.task.createdAt < b.task.createdAt ? -1 : 1);

export function dayPlan(data: Snapshot, now: Now, toLocal: ToLocalDate): DayPlan {
  const view = todayView(data, now, toLocal);
  const week = addDays(now.date, 7);
  const items = allItems(data, now).filter((i) => i.open);
  const undated = items.filter((i) => !i.date).sort(byPriorityThenAge);
  const soon = items.filter((i) => i.date && i.date > now.date && i.date <= week).sort(compareItems);
  let minutes = 0;
  let unestimated = 0;
  for (const i of view.today) {
    if (i.task.estimatedMinutes != null) minutes += i.task.estimatedMinutes;
    else unestimated += 1;
  }
  return { overdue: view.overdue, today: view.today, undated, soon, minutes, unestimated };
}

export type WeekReview = {
  from: LocalDate;
  to: LocalDate;
  /** Completed in the last seven days, newest first. */
  done: TaskItem[];
  /** Open from before today. */
  slipped: TaskItem[];
  /** The next seven days, per day (later repeats included). */
  next: { date: LocalDate; items: TaskItem[] }[];
};

/** The last seven days up to today, and the seven after it. */
export function weekReview(data: Snapshot, now: Now, toLocal: ToLocalDate): WeekReview {
  const from = addDays(now.date, -6);
  const done = completedItems(data).filter((i) => {
    const d = toLocal(i.completedAt!);
    return d >= from && d <= now.date;
  });
  const slipped = todayView(data, now, toLocal).overdue;
  const next = upcomingView(data, now, addDays(now.date, 1), addDays(now.date, 7));
  return { from, to: now.date, done, slipped, next };
}

/** "3 h 20 min" of planned work, or null with no estimates. */
export function plannedWords(minutes: number): string | null {
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
