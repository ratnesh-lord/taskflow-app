/**
 * Turns tasks and reminders into the list of notifications the phone should
 * show over the next 30 days. The Android runtime (modules/taskflow-alarms)
 * stores this list and fires it with the app closed.
 *
 * Times are wall-clock ("2026-11-20T18:30"), not instants: the runtime turns
 * them into instants in whatever time zone the phone is in when it arms
 * them, so a task due at 7 PM reminds at 7 PM local time after travelling.
 * A reminder set for a fixed moment ("absolute", from quick add) is an
 * instant and does not move.
 */
import {
  addDays, compareDates, formatTime, type LocalDate, type LocalTime, minutesToTime, type Now, shortDate, timeToMinutes,
} from './dates';
import { compareItems, itemOf, type ReminderRecord, type Snapshot, type TaskItem, seriesOf } from './agenda';
import { type Occurrence, projectedOccurrences } from './recurrence';
import { isOpenStatus } from './types';

export type AlarmItem = { taskId: string; occurrenceDate: LocalDate | null; title: string };

export type PlannedAlarm = {
  key: string;
  kind: 'reminder' | 'morning' | 'evening';
  /** Wall-clock time in the phone's zone, "YYYY-MM-DDTHH:MM". */
  local?: string;
  /** A fixed instant (ms since 1970), for reminders set for an exact moment. */
  at?: number;
  channel: 'reminders' | 'summaries';
  title: string;
  body: string;
  /** Summaries: the title when one item is left ({n} in title is the count). */
  titleOne?: string;
  taskId?: string;
  occurrenceDate?: LocalDate | null;
  reminderId?: string;
  /** Show Mark completed and Snooze. */
  actions?: boolean;
  items?: AlarmItem[];
  link: string;
};

export type SummarySettings = { morning: LocalTime | null; evening: LocalTime | null };

export const DEFAULT_SUMMARIES: SummarySettings = { morning: '08:00', evening: '21:00' };

const HORIZON_DAYS = 30;
const MAX_ALARMS = 500;
const MAX_ITEMS = 50;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Read the summary times from the profile's settings ({ notifications: { morning, evening } }). */
export function readSummarySettings(settings: unknown): SummarySettings {
  const n = (settings as { notifications?: { morning?: unknown; evening?: unknown } } | null)?.notifications;
  const pick = (v: unknown, fallback: LocalTime | null): LocalTime | null => {
    if (v === null) return null; // switched off
    return typeof v === 'string' && TIME_RE.test(v) ? v : fallback;
  };
  return { morning: pick(n?.morning, DEFAULT_SUMMARIES.morning), evening: pick(n?.evening, DEFAULT_SUMMARIES.evening) };
}

/** "2026-11-20T18:30" minus some minutes, on the calendar (no time zone involved). */
export function wallClockMinus(date: LocalDate, time: LocalTime, minutes: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  const m = timeToMinutes(time) ?? 0;
  const t = new Date(Date.UTC(y, mo - 1, d, 0, m - minutes));
  return t.toISOString().slice(0, 16);
}

function nowWallClock(now: Now): string {
  return `${now.date}T${minutesToTime(now.minutes)}`;
}

function dueWords(date: LocalDate, time: LocalTime | null, fireDate: LocalDate, hour12: boolean, today: LocalDate): string {
  const at = time ? ` at ${formatTime(time, hour12)}` : '';
  if (date === fireDate) return time ? `Due${at}` : 'Due today';
  if (date === addDays(fireDate, 1)) return `Due tomorrow${at}`;
  if (compareDates(date, fireDate) < 0) return `Was due ${shortDate(date, today)}${at}`;
  return `Due ${shortDate(date, today)}${at}`;
}

export type PlanOptions = {
  now: Now;
  /** The current instant, for reminders set for an exact moment. */
  nowMs: number;
  summaries: SummarySettings;
  hour12: boolean;
  projectName?: (id: string) => string | undefined;
};

/** Every notification still to come in the next 30 days, soonest first (at most 500). */
export function planAlarms(data: Snapshot & { reminders: readonly ReminderRecord[] }, opts: PlanOptions): PlannedAlarm[] {
  const { now, hour12 } = opts;
  const today = now.date;
  const end = addDays(today, HORIZON_DAYS);
  const nowLocal = nowWallClock(now);
  const out: PlannedAlarm[] = [];

  // Open dated occurrences per task within the horizon: the current one and later repeats.
  const items: TaskItem[] = [];
  const occurrencesOf = new Map<string, { date: LocalDate; showDate: LocalDate; showTime: LocalTime | null }[]>();
  for (const task of data.tasks) {
    const records = data.occurrences.get(task.id) ?? [];
    const item = itemOf(task, records, now);
    if (!item.open) continue;
    items.push(item);
    const list: { date: LocalDate; showDate: LocalDate; showTime: LocalTime | null }[] = [];
    if (item.date) list.push({ date: item.occurrence?.date ?? item.date, showDate: item.date, showTime: item.time });
    const series = seriesOf(task);
    if (series) {
      for (const o of projectedOccurrences(series, records, today, end) as Occurrence[]) {
        list.push({ date: o.date, showDate: o.showDate, showTime: o.showTime });
      }
    }
    occurrencesOf.set(task.id, list);
  }
  const byTask = new Map(items.map((i) => [i.task.id, i]));

  // Reminders.
  for (const r of data.reminders) {
    if (!r.isActive) continue;
    const item = byTask.get(r.taskId);
    if (!item) continue;
    const task = item.task;
    const project = task.projectId ? opts.projectName?.(task.projectId) : undefined;
    const withProject = (s: string) => (project ? `${s} · ${project}` : s);
    const base = { kind: 'reminder' as const, channel: 'reminders' as const, title: task.title, taskId: task.id, reminderId: r.id, actions: true, link: `taskflow://task/${task.id}` };

    if (r.kind === 'absolute') {
      const at = r.remindAt ? Date.parse(r.remindAt) : NaN;
      if (!Number.isFinite(at) || at <= opts.nowMs) continue;
      const fireDate = localDateOfMs(at);
      out.push({
        ...base, key: `a:${r.id}:${r.remindAt}`, at, occurrenceDate: item.occurrence?.date ?? null,
        body: withProject(item.date ? dueWords(item.date, item.time, fireDate, hour12, today) : 'Reminder'),
      });
      continue;
    }

    for (const o of occurrencesOf.get(task.id) ?? []) {
      // A task with no time is reminded relative to 09:00 on its day.
      const local = wallClockMinus(o.showDate, o.showTime ?? '09:00', r.offsetMinutes ?? 0);
      if (local <= nowLocal || local.slice(0, 10) >= end) continue;
      const fireDate = local.slice(0, 10);
      const words = (r.offsetMinutes ?? 0) === 0 && o.showTime ? 'Due now' : dueWords(o.showDate, o.showTime, fireDate, hour12, today);
      out.push({ ...base, key: `r:${r.id}:${o.date}`, local, occurrenceDate: seriesOf(task) ? o.date : null, body: withProject(words) });
    }
  }

  // Morning plan and evening check, per day.
  if (opts.summaries.morning || opts.summaries.evening) {
    const dueOn = new Map<LocalDate, AlarmItem[]>();
    const firstDate = new Map<string, LocalDate>(); // earliest open date per task, for "overdue by then"
    const titleOf = new Map(items.map((i) => [i.task.id, i.task.title]));
    for (const i of [...items].sort(compareItems)) {
      for (const o of occurrencesOf.get(i.task.id) ?? []) {
        const list = dueOn.get(o.showDate) ?? [];
        list.push({ taskId: i.task.id, occurrenceDate: seriesOf(i.task) ? o.date : null, title: i.task.title });
        dueOn.set(o.showDate, list);
        const f = firstDate.get(i.task.id);
        if (!f || o.showDate < f) firstDate.set(i.task.id, o.showDate);
      }
    }
    for (let day = today; compareDates(day, end) < 0; day = addDays(day, 1)) {
      const todays = dueOn.get(day) ?? [];
      if (opts.summaries.morning) {
        const local = `${day}T${opts.summaries.morning}`;
        if (local > nowLocal) {
          // Still open from earlier days by then (as far as is known now), then the day's own tasks.
          const earlier: AlarmItem[] = [];
          for (const [taskId, first] of firstDate) {
            if (compareDates(first, day) < 0) {
              const occ = (occurrencesOf.get(taskId) ?? []).find((o) => o.showDate === first);
              earlier.push({ taskId, occurrenceDate: occ && byTask.get(taskId)?.repeating ? occ.date : null, title: titleOf.get(taskId) ?? '' });
            }
          }
          const list = [...earlier, ...todays.filter((t) => !earlier.some((e) => e.taskId === t.taskId))].slice(0, MAX_ITEMS);
          if (list.length) {
            out.push({
              key: `m:${day}`, kind: 'morning', local, channel: 'summaries', title: '{n} tasks for today', titleOne: '1 task for today',
              body: '', items: list, link: 'taskflow://',
            });
          }
        }
      }
      if (opts.summaries.evening && todays.length) {
        const local = `${day}T${opts.summaries.evening}`;
        if (local > nowLocal) {
          out.push({
            key: `e:${day}`, kind: 'evening', local, channel: 'summaries', title: '{n} still open from today', titleOne: '1 still open from today',
            body: '', items: todays.slice(0, MAX_ITEMS), link: 'taskflow://',
          });
        }
      }
    }
  }

  const sortKey = (a: PlannedAlarm) => a.local ?? wallClockOfMs(a.at ?? 0);
  return out.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)).slice(0, MAX_ALARMS);
}

export type Snooze = { key: string; taskId?: string | null; occurrenceDate?: string | null; reminderId?: string | null };

/**
 * Snoozed notifications that should no longer go off: the task was completed,
 * deleted or archived, that time of a repeating task was completed or
 * skipped, or the reminder itself was removed or switched off. A snooze with
 * no task (the test reminder) always stays.
 */
export function closedSnoozes(
  data: Snapshot & { reminders: readonly ReminderRecord[] },
  snoozes: readonly Snooze[],
): string[] {
  const tasks = new Map(data.tasks.map((t) => [t.id, t]));
  const reminders = new Map(data.reminders.map((r) => [r.id, r]));
  const closed: string[] = [];
  for (const s of snoozes) {
    if (!s.taskId) continue;
    const task = tasks.get(s.taskId);
    let open = !!task && isOpenStatus(task.status);
    if (open && s.reminderId) {
      const r = reminders.get(s.reminderId);
      open = !!r && r.isActive && r.taskId === s.taskId;
    }
    if (open && s.occurrenceDate && task && seriesOf(task)) {
      const record = (data.occurrences.get(task.id) ?? []).find((r) => r.date === s.occurrenceDate);
      if (record && (record.status === 'completed' || (record.status === 'skipped' && !record.movedToDate))) open = false;
    }
    if (!open) closed.push(s.key);
  }
  return closed;
}

/** The phone's wall-clock time at an instant, "YYYY-MM-DDTHH:MM". */
function wallClockOfMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function localDateOfMs(ms: number): LocalDate {
  return wallClockOfMs(ms).slice(0, 10);
}
