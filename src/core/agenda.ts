/**
 * What each list shows, worked out from the stored rows.
 *
 * Overdue (scenario 11 of the brief):
 *   - A task is overdue when its due day is before today, or it is due today
 *     at a time that has passed. A task with no due date is never overdue.
 *   - Completed and archived tasks are never overdue.
 *   - A repeating task is judged by its current occurrence only.
 *   - Today's summary counts as "Overdue" the tasks from earlier days (the
 *     Overdue section). A task due earlier today is still in the Today list,
 *     marked late, and counts as pending.
 */
import { addDays, type LocalDate, type LocalTime, type Now, timeToMinutes, toMoment } from './dates';
import { currentOccurrence, type Occurrence, type OccurrenceRecord, parseRule, projectedOccurrences, type Series } from './recurrence';
import { isOpenStatus, type Priority, PRIORITY_RANK, type TaskStatus } from './types';

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  projectId: string | null;
  categoryId: string | null;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  estimatedMinutes: number | null;
  completedAt: string | null;
  rrule: string | null;
  recurUntil: LocalDate | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ReminderRecord = {
  id: string;
  taskId: string;
  kind: 'absolute' | 'before_due';
  remindAt: string | null;
  offsetMinutes: number | null;
  isActive: boolean;
};

/** One line in a list: a task, or one occurrence of a repeating task. */
export type TaskItem = {
  key: string;
  task: TaskRecord;
  occurrence: Occurrence | null;
  date: LocalDate | null;
  time: LocalTime | null;
  repeating: boolean;
  open: boolean;
  overdue: boolean;
  /** A later occurrence of a repeating task, shown in Upcoming only. */
  projected: boolean;
  /** When it was completed (for completed items). */
  completedAt: string | null;
};

/** Converts a stored timestamp to the phone's calendar date. */
export type ToLocalDate = (iso: string) => LocalDate;

export function seriesOf(task: TaskRecord): Series | null {
  const rule = parseRule(task.rrule);
  if (!rule || !task.dueDate) return null;
  return { dueDate: task.dueDate, dueTime: task.dueTime, rule, until: task.recurUntil };
}

export function isOverdue(date: LocalDate | null, time: LocalTime | null, now: Now): boolean {
  if (!date) return false;
  if (date < now.date) return true;
  if (date > now.date) return false;
  const m = timeToMinutes(time);
  return m != null && m < now.minutes;
}

/**
 * The item a task shows as in lists. A repeating task shows as its current
 * occurrence; a repeating task whose series has ended shows as completed.
 */
export function itemOf(task: TaskRecord, records: readonly OccurrenceRecord[], now: Now): TaskItem {
  const series = seriesOf(task);
  if (series && isOpenStatus(task.status)) {
    const occ = currentOccurrence(series, records);
    if (occ) {
      return {
        key: `${task.id}@${occ.date}`, task, occurrence: occ, date: occ.showDate, time: occ.showTime,
        repeating: true, open: true, overdue: isOverdue(occ.showDate, occ.showTime, now), projected: false, completedAt: null,
      };
    }
    const last = [...records].filter((r) => r.status === 'completed').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return {
      key: task.id, task, occurrence: null, date: null, time: null, repeating: true, open: false, overdue: false,
      projected: false, completedAt: last?.completedAt ?? null,
    };
  }
  const open = isOpenStatus(task.status);
  return {
    key: task.id, task, occurrence: null, date: task.dueDate, time: task.dueTime, repeating: !!series, open,
    overdue: open && isOverdue(task.dueDate, task.dueTime, now), projected: false, completedAt: task.completedAt,
  };
}

/** Sort order inside a day: timed items by time, then the rest by priority, then by when they were added. */
export function compareItems(a: TaskItem, b: TaskItem): number {
  const ad = a.date ?? '9999-99-99';
  const bd = b.date ?? '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = timeToMinutes(a.time) ?? 10_000;
  const bt = timeToMinutes(b.time) ?? 10_000;
  if (at !== bt) return at - bt;
  const p = PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority];
  if (p !== 0) return p;
  if (a.task.sortOrder !== b.task.sortOrder) return a.task.sortOrder - b.task.sortOrder;
  return a.task.createdAt < b.task.createdAt ? -1 : a.task.createdAt > b.task.createdAt ? 1 : 0;
}

export type TodayView = {
  overdue: TaskItem[];
  today: TaskItem[];
  doneToday: TaskItem[];
  stats: { scheduled: number; done: number; pending: number; overdue: number; percent: number };
};

export type Snapshot = {
  tasks: readonly TaskRecord[];
  /** Occurrence records per task id. */
  occurrences: ReadonlyMap<string, readonly OccurrenceRecord[]>;
};

const NONE: readonly OccurrenceRecord[] = [];

export function allItems(data: Snapshot, now: Now): TaskItem[] {
  return data.tasks.map((t) => itemOf(t, data.occurrences.get(t.id) ?? NONE, now));
}

/** Everything ever completed: one-off tasks and each completed occurrence of repeating ones, newest first. */
export function completedItems(data: Snapshot): TaskItem[] {
  const out: TaskItem[] = [];
  for (const task of data.tasks) {
    if (seriesOf(task)) {
      for (const r of data.occurrences.get(task.id) ?? NONE) {
        if (r.status === 'completed' && r.completedAt) {
          out.push({
            key: `${task.id}@${r.date}`, task, occurrence: { date: r.date, showDate: r.date, showTime: task.dueTime, moved: false },
            date: r.date, time: task.dueTime, repeating: true, open: false, overdue: false, projected: false, completedAt: r.completedAt,
          });
        }
      }
    } else if (task.status === 'completed' && task.completedAt) {
      out.push({
        key: task.id, task, occurrence: null, date: task.dueDate, time: task.dueTime, repeating: false, open: false,
        overdue: false, projected: false, completedAt: task.completedAt,
      });
    }
  }
  return out.sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1));
}

/** Everything completed on the given day, oldest first. */
export function completedOn(data: Snapshot, day: LocalDate, toLocal: ToLocalDate): TaskItem[] {
  return completedItems(data).filter((i) => toLocal(i.completedAt!) === day).reverse();
}

/** Completed items grouped by the day they were completed, newest day first. */
export function completedByDay(data: Snapshot, toLocal: ToLocalDate): { date: LocalDate; items: TaskItem[] }[] {
  const groups: { date: LocalDate; items: TaskItem[] }[] = [];
  for (const item of completedItems(data)) {
    const day = toLocal(item.completedAt!);
    const last = groups[groups.length - 1];
    if (last && last.date === day) last.items.push(item);
    else groups.push({ date: day, items: [item] });
  }
  return groups;
}

export function todayView(data: Snapshot, now: Now, toLocal: ToLocalDate): TodayView {
  const items = allItems(data, now).filter((i) => i.open && i.date);
  const overdue = items.filter((i) => i.date! < now.date).sort(compareItems);
  const today = items.filter((i) => i.date === now.date).sort(compareItems);
  const doneToday = completedOn(data, now.date, toLocal);
  const scheduled = today.length + doneToday.length;
  return {
    overdue,
    today,
    doneToday,
    stats: {
      scheduled,
      done: doneToday.length,
      pending: today.length,
      overdue: overdue.length,
      percent: scheduled === 0 ? 0 : Math.round((doneToday.length / scheduled) * 100),
    },
  };
}

/** Open items between two days (inclusive), with later occurrences of repeating tasks, grouped by day. */
export function upcomingView(data: Snapshot, now: Now, from: LocalDate, to: LocalDate): { date: LocalDate; items: TaskItem[] }[] {
  const byDay = new Map<LocalDate, TaskItem[]>();
  const add = (item: TaskItem) => {
    if (!item.date || item.date < from || item.date > to) return;
    const list = byDay.get(item.date) ?? [];
    list.push(item);
    byDay.set(item.date, list);
  };
  for (const task of data.tasks) {
    const records = data.occurrences.get(task.id) ?? NONE;
    const item = itemOf(task, records, now);
    if (!item.open) continue;
    add(item);
    const series = seriesOf(task);
    if (series) {
      for (const occ of projectedOccurrences(series, records, from, to)) {
        add({
          key: `${task.id}@${occ.date}`, task, occurrence: occ, date: occ.showDate, time: occ.showTime, repeating: true,
          open: true, overdue: false, projected: true, completedAt: null,
        });
      }
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, items]) => ({ date, items: items.sort(compareItems) }));
}

/** When a reminder goes off, or null when it cannot (no due date for a "before" reminder). */
export function reminderMoment(reminder: ReminderRecord, item: TaskItem): Date | null {
  if (reminder.kind === 'absolute') return reminder.remindAt ? new Date(reminder.remindAt) : null;
  if (!item.date) return null;
  // A "before" reminder on a task with no time counts from 09:00.
  const due = toMoment(item.date, item.time ?? '09:00');
  return new Date(due.getTime() - (reminder.offsetMinutes ?? 0) * 60_000);
}

export type NextReminder = { item: TaskItem; at: Date };

/** The next reminder still to go off, among open tasks. */
export function nextReminder(
  data: Snapshot,
  reminders: readonly ReminderRecord[],
  now: Now,
  moment: Date,
): NextReminder | null {
  const items = new Map(allItems(data, now).map((i) => [i.task.id, i]));
  let best: NextReminder | null = null;
  for (const r of reminders) {
    if (!r.isActive) continue;
    const item = items.get(r.taskId);
    if (!item?.open) continue;
    const at = reminderMoment(r, item);
    if (at && at.getTime() > moment.getTime() && (!best || at.getTime() < best.at.getTime())) best = { item, at };
  }
  return best;
}

/** Inbox: open tasks still waiting to be organised. */
export function inboxItems(data: Snapshot, now: Now): TaskItem[] {
  return allItems(data, now).filter((i) => i.open && i.task.status === 'inbox').sort((a, b) => (a.task.createdAt < b.task.createdAt ? 1 : -1));
}

export function upcomingRange(today: LocalDate, span: 'tomorrow' | 'week' | 'month'): { from: LocalDate; to: LocalDate } {
  const tomorrow = addDays(today, 1);
  return span === 'tomorrow' ? { from: tomorrow, to: tomorrow } : { from: tomorrow, to: addDays(today, span === 'week' ? 7 : 30) };
}

export type Progress = { total: number; done: number; open: number; overdue: number; percent: number };

/**
 * Progress of a group of tasks (a project). A repeating task counts once and
 * stays open while it has occurrences left; archived tasks are left out.
 */
export function progressOf(items: readonly TaskItem[]): Progress {
  const counted = items.filter((i) => i.task.status !== 'archived');
  const done = counted.filter((i) => !i.open).length;
  const overdue = counted.filter((i) => i.open && i.overdue).length;
  return {
    total: counted.length,
    done,
    open: counted.length - done,
    overdue,
    percent: counted.length === 0 ? 0 : Math.round((done / counted.length) * 100),
  };
}
