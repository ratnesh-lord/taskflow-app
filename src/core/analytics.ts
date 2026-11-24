/**
 * Numbers for the Analytics screen and the weekly review. Everything is
 * worked out from the tasks and occurrences already on the device.
 *
 * "Done" counts each completed one-off task and each completed occurrence of
 * a repeating task once, on the day it was completed.
 *
 * The completion rate is the share of what was due in a period that got done:
 *   - a one-off task counts if its due date is in the period;
 *   - a repeating task counts once per occurrence in the period; a skipped
 *     occurrence does not count, a moved one counts on the day it moved to;
 *   - today counts only for what is already done, since the day is not over.
 */
import { completedItems, seriesOf, type Snapshot, type TaskItem, type ToLocalDate } from './agenda';
import { addDays, type LocalDate, startOfWeek } from './dates';
import { occurrencesBetween } from './recurrence';
import type { Priority } from './types';

export type DayCount = { date: LocalDate; count: number };

/** Everything completed from one day to another (inclusive), newest first. */
export function doneBetween(data: Snapshot, from: LocalDate, to: LocalDate, toLocal: ToLocalDate): TaskItem[] {
  return completedItems(data).filter((i) => {
    const d = toLocal(i.completedAt!);
    return d >= from && d <= to;
  });
}

/** Completed per day, oldest day first, with a zero for days with none. */
export function donePerDay(data: Snapshot, from: LocalDate, to: LocalDate, toLocal: ToLocalDate): DayCount[] {
  const counts = new Map<LocalDate, number>();
  for (const item of doneBetween(data, from, to, toLocal)) {
    const d = toLocal(item.completedAt!);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const out: DayCount[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, count: counts.get(d) ?? 0 });
  return out;
}

export type DoneCounts = { today: number; week: number; month: number };

/** Completed today, this week (from Monday) and this calendar month. */
export function doneCounts(data: Snapshot, today: LocalDate, toLocal: ToLocalDate): DoneCounts {
  const week = startOfWeek(today);
  const month = `${today.slice(0, 7)}-01`;
  let t = 0;
  let w = 0;
  let m = 0;
  for (const item of completedItems(data)) {
    const d = toLocal(item.completedAt!);
    if (d > today) continue;
    if (d === today) t += 1;
    if (d >= week) w += 1;
    if (d >= month) m += 1;
  }
  return { today: t, week: w, month: m };
}

export type Rate = { due: number; done: number; percent: number | null };

export function completionRate(data: Snapshot, from: LocalDate, today: LocalDate): Rate {
  let due = 0;
  let done = 0;
  const count = (date: LocalDate, isDone: boolean) => {
    if (date < from || date > today) return;
    if (date === today && !isDone) return;
    due += 1;
    if (isDone) done += 1;
  };
  for (const task of data.tasks) {
    if (task.status === 'archived') continue;
    const series = seriesOf(task);
    if (!series) {
      if (task.dueDate) count(task.dueDate, task.status === 'completed');
      continue;
    }
    const records = new Map((data.occurrences.get(task.id) ?? []).map((r) => [r.date, r]));
    // Occurrences that moved into the period from before it.
    for (const r of records.values()) {
      if (r.status === 'skipped' && r.movedToDate && r.date < from) count(r.movedToDate, false);
    }
    for (const d of occurrencesBetween(series.dueDate, series.rule, from, today, series.until)) {
      const r = records.get(d);
      if (!r) count(d, false);
      else if (r.status === 'completed') count(d, true);
      else if (r.movedToDate) count(r.movedToDate, false);
    }
  }
  return { due, done, percent: due === 0 ? null : Math.round((done / due) * 100) };
}

export type GroupCount<K> = { key: K; count: number };

/** Completed in a period, per project (null = no project), most first. */
export function doneByProject(items: readonly TaskItem[]): GroupCount<string | null>[] {
  const counts = new Map<string | null, number>();
  for (const i of items) counts.set(i.task.projectId, (counts.get(i.task.projectId) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** Completed in a period, per priority, critical first (all four, zeros included). */
export function doneByPriority(items: readonly TaskItem[]): GroupCount<Priority>[] {
  const order: Priority[] = ['critical', 'high', 'medium', 'low'];
  return order.map((key) => ({ key, count: items.filter((i) => i.task.priority === key).length }));
}

/** The day of the week with the most completed, as 0 = Sunday … 6 = Saturday, or null with nothing done. */
export function busiestWeekday(days: readonly DayCount[]): number | null {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) totals[new Date(`${d.date}T00:00:00Z`).getUTCDay()] += d.count;
  const max = Math.max(...totals);
  return max === 0 ? null : totals.indexOf(max);
}

/** Sum of counts. */
export function total(days: readonly DayCount[]): number {
  return days.reduce((n, d) => n + d.count, 0);
}
