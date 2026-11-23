/**
 * The rules of TaskFlow's Google integrations, with no network in them.
 *
 * Calendar: tasks with a date are copied, one way, into a calendar named
 * "TaskFlow" that the app creates in the person's Google Calendar. Each
 * event's id is worked out from the task (and, for a repeating task, the
 * day), so the same task never makes two events, whichever device sends it
 * and however often a request is retried. Every push compares what the
 * calendar should hold, from 30 days back to 90 days ahead, with what it
 * holds, and adds, changes or deletes only the difference. Repeating tasks
 * become one event per day in that window, so a skipped, moved or completed
 * day shows exactly as in TaskFlow.
 *
 * Events: the person's own calendars are read, never written, and shown in
 * the calendar views.
 *
 * Tasks: Google Tasks lists are imported once into TaskFlow (a list becomes
 * a project, "My Tasks" the Inbox, a subtask a subtask); TaskFlow tasks are
 * copied into a "TaskFlow" list. Which Google task belongs to which TaskFlow
 * task is kept in calendar_links, so importing or copying twice changes
 * rather than duplicates.
 */
import { itemOf, seriesOf, type Snapshot, type TaskItem, upcomingView } from './agenda';
import { titleWithEmoji } from './appearance';
import { DEFAULT_TASK_MINUTES, type ExternalEvent } from './calendar';
import { addDays, type LocalDate, minutesToTime, type Now, timeToMinutes } from './dates';
import { isOpenStatus } from './types';

// ---------------------------------------------------------------------------
// Scopes and settings
// ---------------------------------------------------------------------------

const G = 'https://www.googleapis.com/auth/';

/** The narrowest Google permissions each feature needs. */
export const SCOPES = {
  /** Who the person is (the address shown in More → Google). */
  identity: [`${G}userinfo.email`],
  /** Make the TaskFlow calendar and change only its events. */
  calendarWrite: [`${G}calendar.app.created`],
  /** Read the person's calendars and their events, to show them. */
  calendarRead: [`${G}calendar.calendarlist.readonly`, `${G}calendar.events.readonly`],
  tasks: [`${G}tasks`],
  /** Only files TaskFlow itself uploads. */
  drive: [`${G}drive.file`],
} as const;

export type GoogleFeature = Exclude<keyof typeof SCOPES, 'identity'>;

export function scopesFor(...features: GoogleFeature[]): string[] {
  return [...new Set([...SCOPES.identity, ...features.flatMap((f) => SCOPES[f])])];
}

/** Kept in the profile's settings, so every device of the account uses the same calendar, list and folder. */
export type GoogleSettings = {
  /** Copy tasks into the TaskFlow calendar. */
  calendarPush: boolean;
  calendarId: string | null;
  /** Show the person's Google events in the calendar views. */
  showEvents: boolean;
  tasksListId: string | null;
  driveFolderId: string | null;
};

export const NO_GOOGLE: GoogleSettings = { calendarPush: false, calendarId: null, showEvents: false, tasksListId: null, driveFolderId: null };

export function readGoogleSettings(settings: unknown): GoogleSettings {
  const g = (settings as { google?: Record<string, unknown> } | null)?.google;
  if (!g || typeof g !== 'object') return NO_GOOGLE;
  const id = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    calendarPush: g.calendarPush === true,
    calendarId: id(g.calendarId),
    showEvents: g.showEvents === true,
    tasksListId: id(g.tasksListId),
    driveFolderId: id(g.driveFolderId),
  };
}

// ---------------------------------------------------------------------------
// Calendar: what the TaskFlow calendar should hold
// ---------------------------------------------------------------------------

/** From 30 days back to 90 days ahead. Older events are left as they are. */
export const PUSH_DAYS_BACK = 30;
export const PUSH_DAYS_AHEAD = 90;

export type EventTime = { date: string } | { dateTime: string; timeZone: string };

/** The fields TaskFlow sets on an event (Google Calendar API v3, Events resource). */
export type EventBody = {
  id: string;
  summary: string;
  description: string;
  start: EventTime;
  end: EventTime;
  status: 'confirmed';
  transparency: 'transparent';
  reminders: { useDefault: false; overrides: [] };
  extendedProperties: { private: { taskflow: '1'; tfTask: string; tfHash: string } };
};

/**
 * An event id from a task id and, for a repeating task, the day. Google
 * allows the characters a–v and 0–9, 5 to 1024 of them; a UUID without its
 * dashes is hexadecimal, which fits.
 */
export function eventId(taskId: string, occurrenceDate?: string | null): string {
  const hex = taskId.replace(/-/g, '').toLowerCase();
  return occurrenceDate ? `${hex}d${occurrenceDate.replace(/-/g, '')}` : hex;
}

/** A short, stable fingerprint of what an event shows, to skip unchanged events. */
export function hashOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const FOOTER = 'Added by TaskFlow. Changes made here are replaced by TaskFlow; edit the task in TaskFlow instead.';

function eventFor(item: TaskItem, done: boolean, timeZone: string): EventBody {
  const date = item.date!;
  const start = timeToMinutes(item.time);
  const length = item.task.estimatedMinutes && item.task.estimatedMinutes > 0 ? item.task.estimatedMinutes : DEFAULT_TASK_MINUTES;
  let startTime: EventTime;
  let endTime: EventTime;
  if (start == null) {
    startTime = { date };
    endTime = { date: addDays(date, 1) };
  } else {
    const endMinutes = start + length;
    const endDate = endMinutes >= 24 * 60 ? addDays(date, Math.floor(endMinutes / (24 * 60))) : date;
    startTime = { dateTime: `${date}T${minutesToTime(start)}:00`, timeZone };
    endTime = { dateTime: `${endDate}T${minutesToTime(endMinutes % (24 * 60))}:00`, timeZone };
  }
  const shown = {
    summary: `${done ? '✓ ' : ''}${titleWithEmoji(item.task)}`,
    description: item.task.description.trim() ? `${item.task.description.trim()}\n\n${FOOTER}` : FOOTER,
    start: startTime,
    end: endTime,
  };
  return {
    id: eventId(item.task.id, item.repeating && item.occurrence ? item.occurrence.date : null),
    ...shown,
    status: 'confirmed',
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { taskflow: '1', tfTask: item.task.id, tfHash: hashOf(shown) } },
  };
}

/** Every event the TaskFlow calendar should hold between [from] and [to]. */
export function desiredEvents(data: Snapshot, opts: { from: LocalDate; to: LocalDate; timeZone: string; now: Now }): Map<string, EventBody> {
  const out = new Map<string, EventBody>();
  const add = (item: TaskItem, done: boolean) => {
    if (!item.date || item.date < opts.from || item.date > opts.to) return;
    const e = eventFor(item, done, opts.timeZone);
    out.set(e.id, e);
  };
  for (const { items } of upcomingView(data, opts.now, opts.from, opts.to)) for (const item of items) add(item, false);
  for (const task of data.tasks) {
    const series = seriesOf(task);
    if (series) {
      for (const r of data.occurrences.get(task.id) ?? []) {
        if (r.status !== 'completed') continue;
        add({
          key: `${task.id}@${r.date}`, task, occurrence: { date: r.date, showDate: r.movedToDate ?? r.date, showTime: r.movedToTime ?? series.dueTime, moved: !!r.movedToDate },
          date: r.movedToDate ?? r.date, time: r.movedToTime ?? series.dueTime, repeating: true, open: false, overdue: false, projected: false,
          completedAt: r.completedAt ?? null,
        }, true);
      }
    } else if (task.status === 'completed') {
      add(itemOf(task, [], opts.now), true);
    }
  }
  return out;
}

/** What the TaskFlow calendar holds now, as listed by Google. */
export type ExistingEvent = { id: string; hash: string | null };

export type CalendarPlan = { insert: EventBody[]; update: EventBody[]; remove: string[] };

/** The difference between what the calendar holds and what it should. */
export function planCalendar(desired: Map<string, EventBody>, existing: readonly ExistingEvent[]): CalendarPlan {
  const have = new Map(existing.map((e) => [e.id, e.hash]));
  const insert: EventBody[] = [];
  const update: EventBody[] = [];
  for (const [id, body] of desired) {
    if (!have.has(id)) insert.push(body);
    else if (have.get(id) !== body.extendedProperties.private.tfHash) update.push(body);
  }
  const remove = existing.filter((e) => !desired.has(e.id)).map((e) => e.id);
  return { insert, update, remove };
}

// ---------------------------------------------------------------------------
// Calendar: the person's own events
// ---------------------------------------------------------------------------

/** An event as Google lists it (the fields TaskFlow reads). */
export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

/**
 * A Google event cut into days, in the phone's time zone. [toLocal] turns an
 * instant into the phone's date and minutes. A timed event that runs past
 * midnight shows on each day it covers.
 */
export function eventDays(
  event: GoogleEvent,
  calendarName: string,
  toLocal: (iso: string) => { date: LocalDate; minutes: number },
): ExternalEvent[] {
  if (event.status === 'cancelled' || !event.start) return [];
  const title = event.summary?.trim() || '(No title)';
  const base = { eventId: event.id, calendarName, title, link: event.htmlLink ?? null };
  if (event.start.date) {
    // All-day: the end date is the day after the last day.
    const last = event.end?.date ? addDays(event.end.date, -1) : event.start.date;
    const out: ExternalEvent[] = [];
    for (let d = event.start.date; d <= last && out.length < 60; d = addDays(d, 1)) out.push({ ...base, key: `${event.id}|${d}`, date: d, start: null, end: null });
    return out;
  }
  if (!event.start.dateTime) return [];
  const s = toLocal(event.start.dateTime);
  const e = event.end?.dateTime ? toLocal(event.end.dateTime) : { date: s.date, minutes: s.minutes + 30 };
  const out: ExternalEvent[] = [];
  for (let d = s.date; d <= e.date && out.length < 60; d = addDays(d, 1)) {
    const start = d === s.date ? s.minutes : 0;
    const end = d === e.date ? e.minutes : 24 * 60;
    if (end <= start && !(d === s.date && d === e.date)) continue;
    out.push({ ...base, key: `${event.id}|${d}`, date: d, start, end: Math.max(end, start + 15) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Google Tasks
// ---------------------------------------------------------------------------

export const LINK_IMPORTED = 'google-tasks';
export const LINK_EXPORTED = 'google-tasks-export';

/** A task as Google Tasks lists it (the fields TaskFlow reads). */
export type GoogleTask = {
  id: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  parent?: string;
  deleted?: boolean;
  hidden?: boolean;
  position?: string;
};

/** Google's "due" is a date at midnight UTC; only the date means anything. */
export function dueDateOf(t: GoogleTask): LocalDate | null {
  return t.due && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? t.due.slice(0, 10) : null;
}

export type ImportedTask = {
  googleId: string;
  title: string;
  description: string;
  dueDate: LocalDate | null;
  completedAt: string | null;
  subtasks: { title: string; done: boolean }[];
};

/**
 * One Google Tasks list as TaskFlow tasks: top-level tasks become tasks,
 * their children subtasks. Tasks already imported ([known] Google ids) and
 * deleted ones are left out; an untitled task with no notes is skipped.
 */
export function planImport(tasks: readonly GoogleTask[], known: ReadonlySet<string>): ImportedTask[] {
  const live = tasks.filter((t) => !t.deleted);
  const children = new Map<string, GoogleTask[]>();
  for (const t of live) if (t.parent) children.set(t.parent, [...(children.get(t.parent) ?? []), t]);
  const byPosition = (a: GoogleTask, b: GoogleTask) => (a.position ?? '').localeCompare(b.position ?? '');
  return live
    .filter((t) => !t.parent && !known.has(t.id) && ((t.title ?? '').trim() || (t.notes ?? '').trim()))
    .sort(byPosition)
    .map((t) => ({
      googleId: t.id,
      title: (t.title ?? '').trim() || (t.notes ?? '').trim().split('\n')[0].slice(0, 200),
      description: (t.notes ?? '').trim(),
      dueDate: dueDateOf(t),
      completedAt: t.status === 'completed' ? (t.completed ?? new Date(0).toISOString()) : null,
      subtasks: (children.get(t.id) ?? []).sort(byPosition)
        .filter((c) => (c.title ?? '').trim())
        .map((c) => ({ title: c.title!.trim(), done: c.status === 'completed' })),
    }));
}

/** The body TaskFlow sends for a task copied to Google Tasks. */
export type GoogleTaskBody = { title: string; notes: string; status: 'needsAction' | 'completed'; due?: string };

export type ExportItem = { taskId: string; body: GoogleTaskBody };

/**
 * TaskFlow tasks to copy to Google Tasks: open tasks (a repeating one as its
 * current day) and tasks completed since they were last copied. Tasks that
 * came from Google Tasks are not copied back.
 */
export function planExport(data: Snapshot, now: Now, imported: ReadonlySet<string>, exported: ReadonlySet<string>): ExportItem[] {
  const out: ExportItem[] = [];
  for (const task of data.tasks) {
    if (imported.has(task.id)) continue;
    const item = itemOf(task, data.occurrences.get(task.id) ?? [], now);
    const open = item.open && isOpenStatus(task.status);
    if (!open && !(task.status === 'completed' && exported.has(task.id))) continue;
    if (task.status === 'archived') continue;
    out.push({
      taskId: task.id,
      body: {
        title: task.title,
        notes: task.description,
        status: open ? 'needsAction' : 'completed',
        ...(item.date ? { due: `${item.date}T00:00:00.000Z` } : {}),
      },
    });
  }
  return out;
}
