/**
 * What the four home-screen widgets show, worked out by the app and handed to
 * the Android widget runtime (modules/taskflow-alarms/…/widgets) as JSON.
 *
 * The widgets draw with the app closed, sometimes after midnight, so the app
 * sends two days: today and tomorrow (as tomorrow will look if nothing else
 * changes). The runtime shows the day matching the phone's date and only
 * works out the one thing that changes by the minute: the next deadline.
 *
 * The counts are the Today screen's: "pending" is still open today,
 * "overdue" is still open from an earlier day, "done" is completed today.
 */
import { titleWithEmoji } from './appearance';
import { completedByDay, type Snapshot, type TaskItem, type ToLocalDate, todayView } from './agenda';
import { addDays, formatTime, type LocalDate, MONTH_SHORT, type Now, parts, startOfWeek, WEEKDAY_SHORT, weekday } from './dates';
import type { Priority } from './types';

export const WIDGET_ROWS = 20;

export type WidgetRow = {
  taskId: string;
  /** The day of a repeating task's occurrence; null for a one-off task. */
  occurrenceDate: LocalDate | null;
  title: string;
  /** What the row shows on the left: "13:00", "Any", or "20 Nov" for an earlier day. */
  label: string;
  /** "YYYY-MM-DDTHH:MM" for a timed row, "YYYY-MM-DD" for an untimed one. */
  due: string;
  priority: Priority;
  /** Open from an earlier day (overdue). */
  earlier: boolean;
  /** Added by the app before sending (src/platform/widgets.ts): the row's colour bar and priority mark, light and dark. */
  color?: { light: string; dark: string } | null;
  priorityColor?: { light: string; dark: string } | null;
};

export type WidgetDay = {
  date: LocalDate;
  /** "Sun 22 Nov". */
  heading: string;
  /** Overdue rows first, then the day's own, in the Today screen's order (at most 20). */
  rows: WidgetRow[];
  pending: number;
  overdue: number;
  done: number;
  /** Open by the end of this day (pending + overdue) with high or critical priority. */
  important: number;
  /** Completed per day, Monday to Sunday, for the week holding [date]. */
  week: number[];
};

export type WidgetData = {
  version: 1;
  generatedAt: number;
  signedIn: true;
  hour12: boolean;
  days: WidgetDay[];
};

export type SignedOutWidgetData = { version: 1; generatedAt: number; signedIn: false };

function heading(date: LocalDate): string {
  const p = parts(date);
  return `${WEEKDAY_SHORT[weekday(date)]} ${p.day} ${MONTH_SHORT[p.month - 1]}`;
}

function dayMonth(date: LocalDate): string {
  const p = parts(date);
  return `${p.day} ${MONTH_SHORT[p.month - 1]}`;
}

function rowOf(item: TaskItem, day: LocalDate, hour12: boolean): WidgetRow {
  const date = item.date!;
  const earlier = date < day;
  return {
    taskId: item.task.id,
    occurrenceDate: item.occurrence?.date ?? null,
    title: titleWithEmoji(item.task),
    label: earlier ? dayMonth(date) : item.time ? formatTime(item.time, hour12) : 'Any',
    due: item.time ? `${date}T${item.time}` : date,
    priority: item.task.priority,
    earlier,
  };
}

function dayOf(data: Snapshot, now: Now, toLocal: ToLocalDate, hour12: boolean, doneByDay: Map<LocalDate, number>): WidgetDay {
  const view = todayView(data, now, toLocal);
  const open = [...view.overdue, ...view.today];
  const monday = startOfWeek(now.date);
  return {
    date: now.date,
    heading: heading(now.date),
    rows: open.slice(0, WIDGET_ROWS).map((i) => rowOf(i, now.date, hour12)),
    pending: view.stats.pending,
    overdue: view.stats.overdue,
    done: view.stats.done,
    important: open.filter((i) => i.task.priority === 'high' || i.task.priority === 'critical').length,
    week: Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      return d <= now.date ? (doneByDay.get(d) ?? 0) : 0;
    }),
  };
}

/** Today and tomorrow, as the widgets show them. */
export function widgetData(
  data: Snapshot,
  opts: { now: Now; nowMs: number; toLocal: ToLocalDate; hour12: boolean },
): WidgetData {
  // The week bars need at most the last eight days (tomorrow's week included).
  const doneByDay = new Map(completedByDay(data, opts.toLocal, addDays(opts.now.date, -8)).map((g) => [g.date, g.items.length]));
  const tomorrow: Now = { date: addDays(opts.now.date, 1), minutes: 0 };
  return {
    version: 1,
    generatedAt: opts.nowMs,
    signedIn: true,
    hour12: opts.hour12,
    days: [dayOf(data, opts.now, opts.toLocal, opts.hour12, doneByDay), dayOf(data, tomorrow, opts.toLocal, opts.hour12, doneByDay)],
  };
}
