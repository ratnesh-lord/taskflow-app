/**
 * The calendar views: what each day holds, where blocks sit on the hour grid,
 * and what a drag drops onto.
 *
 * A day holds tasks (open ones, and ones completed on that day's schedule)
 * and, when Google Calendar is connected, the person's own events, read-only.
 * Tasks with a time sit on the hour grid; tasks without one, and all-day
 * events, sit in the all-day row above it.
 */
import { compareItems, itemOf, seriesOf, type Snapshot, type TaskItem, upcomingView } from './agenda';
import {
  addDays, addMonths, daysInMonth, type LocalDate, type LocalTime, makeDate, minutesToTime, type Now, parts, startOfWeek,
  timeToMinutes,
} from './dates';
import { isOpenStatus } from './types';

/** How long a task block is when the task has no estimate. */
export const DEFAULT_TASK_MINUTES = 30;
/** Drags snap to quarter hours. */
export const SNAP_MINUTES = 15;

/** An event from the person's Google Calendar, cut to one day. */
export type ExternalEvent = {
  /** Unique per day: the event id plus the day. */
  key: string;
  eventId: string;
  calendarName: string;
  title: string;
  date: LocalDate;
  /** Minutes from midnight on [date]; null for all-day. */
  start: number | null;
  end: number | null;
  link: string | null;
};

export type CalendarEntry =
  | { kind: 'task'; key: string; item: TaskItem; done: boolean; start: number | null; end: number | null }
  | { kind: 'event'; key: string; event: ExternalEvent; start: number | null; end: number | null };

export type CalendarDay = { date: LocalDate; allDay: CalendarEntry[]; timed: CalendarEntry[] };

function taskEntry(item: TaskItem, done: boolean): CalendarEntry {
  const start = timeToMinutes(item.time);
  const length = item.task.estimatedMinutes && item.task.estimatedMinutes > 0 ? item.task.estimatedMinutes : DEFAULT_TASK_MINUTES;
  return { kind: 'task', key: item.key, item, done, start, end: start == null ? null : Math.min(24 * 60, start + length) };
}

/**
 * Completed work that belongs on the calendar: one-off tasks completed with a
 * due date, and completed days of repeating tasks, on the day they were
 * scheduled for (where they were moved to, if moved).
 */
function doneItems(data: Snapshot, now: Now, from: LocalDate, to: LocalDate): TaskItem[] {
  const out: TaskItem[] = [];
  for (const task of data.tasks) {
    const series = seriesOf(task);
    if (series) {
      for (const r of data.occurrences.get(task.id) ?? []) {
        if (r.status !== 'completed') continue;
        const date = r.movedToDate ?? r.date;
        if (date < from || date > to) continue;
        const time = r.movedToTime ?? series.dueTime;
        out.push({
          key: `${task.id}@${r.date}`, task, occurrence: { date: r.date, showDate: date, showTime: time, moved: !!r.movedToDate },
          date, time, repeating: true, open: false, overdue: false, projected: false, completedAt: r.completedAt ?? null,
        });
      }
    } else if (task.status === 'completed' && task.dueDate && task.dueDate >= from && task.dueDate <= to) {
      out.push(itemOf(task, [], now));
    }
  }
  return out;
}

/** Every day from [from] to [to], with its tasks and events. */
export function calendarDays(data: Snapshot, now: Now, from: LocalDate, to: LocalDate, events: readonly ExternalEvent[] = []): CalendarDay[] {
  const days = new Map<LocalDate, CalendarDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, allDay: [], timed: [] });
  const put = (date: LocalDate, entry: CalendarEntry) => {
    const day = days.get(date);
    if (!day) return;
    (entry.start == null ? day.allDay : day.timed).push(entry);
  };
  for (const { date, items } of upcomingView(data, { date: '0000-01-01', minutes: 0 }, from, to)) {
    // upcomingView with an early "now" lists open items without judging overdue; judge here.
    for (const item of items) put(date, taskEntry(withOverdue(item, now), false));
  }
  for (const item of doneItems(data, now, from, to).sort(compareItems)) put(item.date!, taskEntry(item, true));
  for (const e of events) put(e.date, { kind: 'event', key: e.key, event: e, start: e.start, end: e.end });
  for (const day of days.values()) {
    day.timed.sort((a, b) => a.start! - b.start! || b.end! - a.end! || a.key.localeCompare(b.key));
    day.allDay.sort((a, b) => order(a) - order(b));
  }
  return [...days.values()];
}

function order(e: CalendarEntry): number {
  if (e.kind === 'event') return 0;
  return e.done ? 2 : 1;
}

function withOverdue(item: TaskItem, now: Now): TaskItem {
  if (!item.date || !item.open) return item;
  const m = timeToMinutes(item.time);
  const overdue = item.date < now.date || (item.date === now.date && m != null && m < now.minutes);
  return overdue === item.overdue ? item : { ...item, overdue };
}

// ---------------------------------------------------------------------------
// The hour grid
// ---------------------------------------------------------------------------

export type Placed = { key: string; start: number; end: number; column: number; columns: number };

/**
 * Side-by-side columns for overlapping blocks, the way calendars do it: blocks
 * that overlap (directly or through a chain) share the width of the widest
 * moment; each takes the first free column. Blocks shorter than [minLength]
 * minutes are laid out as if they were that long, so they stay tappable.
 */
export function layoutTimed(entries: readonly { key: string; start: number; end: number }[], minLength = DEFAULT_TASK_MINUTES): Placed[] {
  const sorted = [...entries]
    .map((e) => ({ key: e.key, start: e.start, end: Math.max(e.end, e.start + minLength) }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.key.localeCompare(b.key));
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];
  const close = () => {
    const columns = columnEnds.length;
    for (const p of cluster) p.columns = columns;
    out.push(...cluster);
    cluster = [];
    columnEnds = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) close();
    let column = columnEnds.findIndex((end) => end <= e.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(e.end);
    } else {
      columnEnds[column] = e.end;
    }
    cluster.push({ key: e.key, start: e.start, end: e.end, column, columns: 0 });
    clusterEnd = cluster.length === 1 ? e.end : Math.max(clusterEnd, e.end);
  }
  if (cluster.length) close();
  return out;
}

/** The time a point on the hour grid stands for, snapped to quarter hours and kept inside the day. */
export function minutesAt(offsetY: number, hourHeight: number, snap = SNAP_MINUTES): number {
  const raw = (offsetY / hourHeight) * 60;
  const snapped = Math.round(raw / snap) * snap;
  return Math.max(0, Math.min(24 * 60 - snap, snapped));
}

/** Where a dragged task lands: a day and a time, or a day with no time (the all-day row). */
export type Drop = { date: LocalDate; time: LocalTime | null };

export function dropFor(date: LocalDate, minutes: number | null): Drop {
  return { date, time: minutes == null ? null : minutesToTime(minutes) };
}

/** Whether a drop changes anything for the item. */
export function dropChanges(item: TaskItem, drop: Drop): boolean {
  return item.date !== drop.date || (item.time ?? null) !== drop.time;
}

/** Completed items and events cannot be dragged. */
export function canDrag(entry: CalendarEntry): boolean {
  return entry.kind === 'task' && !entry.done && entry.item.open && isOpenStatus(entry.item.task.status);
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

export type CalendarMode = 'day' | 'week' | 'month' | 'agenda';

/** Agenda shows this many days from the chosen day. */
export const AGENDA_DAYS = 30;

/** The days a view shows around [anchor]: one day, Monday to Sunday, the month's six weeks, or 30 days. */
export function rangeOf(mode: CalendarMode, anchor: LocalDate): { from: LocalDate; to: LocalDate } {
  switch (mode) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week': {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case 'month': {
      const p = parts(anchor);
      const from = startOfWeek(makeDate(p.year, p.month, 1));
      return { from, to: addDays(from, 41) };
    }
    case 'agenda':
      return { from: anchor, to: addDays(anchor, AGENDA_DAYS - 1) };
  }
}

/** The anchor one step back or forward: a day, a week, a month, or 30 days. */
export function step(mode: CalendarMode, anchor: LocalDate, direction: 1 | -1): LocalDate {
  switch (mode) {
    case 'day':
      return addDays(anchor, direction);
    case 'week':
      return addDays(anchor, 7 * direction);
    case 'month': {
      const p = parts(anchor);
      return addMonths(makeDate(p.year, p.month, 1), direction);
    }
    case 'agenda':
      return addDays(anchor, AGENDA_DAYS * direction);
  }
}

/** Whether [date] is inside the month of [anchor] (month view dims the others). */
export function inMonth(date: LocalDate, anchor: LocalDate): boolean {
  const a = parts(anchor);
  const d = parts(date);
  return a.year === d.year && a.month === d.month && d.day <= daysInMonth(a.year, a.month);
}
