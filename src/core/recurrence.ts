/**
 * Repeating tasks.
 *
 * A repeating task is ONE task row. Its due date is the first occurrence (the
 * anchor) and its `rrule` says how it repeats. Each occurrence the user deals
 * with gets a row in task_occurrences, keyed by the occurrence's original date:
 *
 *   completed                    done
 *   skipped                      passed over
 *   skipped + moved_to_date      moved to another day, still to do
 *
 * Completing an occurrence only adds a row; the task itself never changes. So
 * every future occurrence is still there, and two phones completing the same
 * day write the same row.
 *
 * Rules are a small subset of RFC 5545 RRULE text, enough for every case in
 * the brief: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL=n, and BYDAY for
 * weekly rules. Monthly and yearly rules repeat on the anchor's day; a month
 * without that day uses its last day (31 Jan → 28 Feb → 31 Mar).
 */
import {
  addDays,
  addMonths,
  compareDates,
  diffDays,
  isLocalDate,
  type LocalDate,
  type LocalTime,
  MONTH_LONG,
  parts,
  startOfWeek,
  weekday,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
} from './dates';

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** 0 = Sunday ... 6 = Saturday, as Date.getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Rule = { freq: Freq; interval: number; byDay?: Weekday[] };

const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const FREQS: Record<string, Freq> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
export const WORKDAYS: Weekday[] = [1, 2, 3, 4, 5];
export const MAX_INTERVAL = 999;

/** Monday-first order, the order weekdays are listed and generated in. */
export function mondayFirst(days: readonly Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

export function parseRule(text: string | null | undefined): Rule | null {
  if (!text) return null;
  const fields = new Map<string, string>();
  for (const part of text.trim().replace(/^RRULE:/i, '').split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    fields.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1).toUpperCase());
  }
  const freq = FREQS[fields.get('FREQ') ?? ''];
  if (!freq) return null;
  const interval = fields.has('INTERVAL') ? Number(fields.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null;
  const rule: Rule = { freq, interval };
  if (fields.has('BYDAY')) {
    if (freq !== 'weekly') return null;
    const days: Weekday[] = [];
    for (const code of fields.get('BYDAY')!.split(',')) {
      const i = CODES.indexOf(code as (typeof CODES)[number]);
      if (i < 0) return null;
      days.push(i as Weekday);
    }
    if (days.length === 0) return null;
    rule.byDay = mondayFirst(days);
  }
  return rule;
}

export function formatRule(rule: Rule): string {
  const out = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) out.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byDay?.length) out.push(`BYDAY=${mondayFirst(rule.byDay).map((d) => CODES[d]).join(',')}`);
  return out.join(';');
}

/** The weekdays a weekly rule falls on: its BYDAY list, else the anchor's weekday. */
function weekdaysOf(rule: Rule, anchor: LocalDate): Weekday[] {
  return rule.byDay?.length ? mondayFirst(rule.byDay) : [weekday(anchor) as Weekday];
}

/** "Every weekday", "Every 2 weeks on Mon, Wed", "Every month on the 31st (or the last day)". */
export function describeRule(rule: Rule, anchor: LocalDate | null): string {
  const n = rule.interval;
  const unit = (one: string) => (n === 1 ? `Every ${one}` : `Every ${n} ${one}s`);
  switch (rule.freq) {
    case 'daily':
      return unit('day');
    case 'weekly': {
      const days = anchor || rule.byDay?.length ? weekdaysOf(rule, anchor ?? '2000-01-03') : [];
      if (n === 1 && days.join() === WORKDAYS.join()) return 'Every weekday';
      if (n === 1 && days.join() === '6,0') return 'Every weekend';
      if (days.length === 0) return unit('week');
      const names = days.length === 1 ? WEEKDAY_LONG[days[0]] : days.map((d) => WEEKDAY_SHORT[d]).join(', ');
      return `${unit('week')} on ${names}`;
    }
    case 'monthly': {
      if (!anchor) return unit('month');
      const day = parts(anchor).day;
      return `${unit('month')} on the ${ordinal(day)}${day > 28 ? ' (or the last day)' : ''}`;
    }
    case 'yearly': {
      if (!anchor) return unit('year');
      const p = parts(anchor);
      return `${unit('year')} on ${p.day} ${MONTH_LONG[p.month - 1]}`;
    }
  }
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${teen ? 'th' : suffix}`;
}

/**
 * Every occurrence from `from` to `to` (both inclusive), oldest first.
 * The anchor itself is the first occurrence; nothing falls before it or after `until`.
 */
export function occurrencesBetween(
  anchor: LocalDate,
  rule: Rule,
  from: LocalDate,
  to: LocalDate,
  until: LocalDate | null = null,
  limit = 5000,
): LocalDate[] {
  const end = until && until < to ? until : to;
  const start = from > anchor ? from : anchor;
  const out: LocalDate[] = [];
  if (end < start) return out;
  const push = (d: LocalDate) => {
    if (d >= start && d <= end && d >= anchor) out.push(d);
  };

  switch (rule.freq) {
    case 'daily': {
      let k = Math.max(0, Math.ceil(diffDays(anchor, start) / rule.interval));
      for (let d = addDays(anchor, k * rule.interval); d <= end && out.length < limit; k += 1, d = addDays(anchor, k * rule.interval)) {
        push(d);
      }
      break;
    }
    case 'weekly': {
      const days = weekdaysOf(rule, anchor);
      const base = startOfWeek(anchor);
      let k = Math.max(0, Math.floor(diffDays(base, startOfWeek(start)) / 7 / rule.interval));
      for (;;) {
        const week = addDays(base, k * 7 * rule.interval);
        if (week > end || out.length >= limit) break;
        for (const day of days) push(addDays(week, (day + 6) % 7));
        k += 1;
      }
      break;
    }
    case 'monthly':
    case 'yearly': {
      const step = rule.freq === 'monthly' ? rule.interval : rule.interval * 12;
      const a = parts(anchor);
      const s = parts(start);
      let k = Math.max(0, Math.floor(((s.year - a.year) * 12 + (s.month - a.month)) / step) - 1);
      for (;;) {
        const d = addMonths(anchor, k * step, a.day);
        if (d > end || out.length >= limit) break;
        push(d);
        k += 1;
      }
      break;
    }
  }
  return out;
}

/** The first occurrence on or after `date`, or null when the series has ended. */
export function nextOnOrAfter(anchor: LocalDate, rule: Rule, date: LocalDate, until: LocalDate | null = null): LocalDate | null {
  // Every rule here repeats at least once in 999 years.
  const span = rule.freq === 'yearly' ? 366 * rule.interval + 400 : rule.freq === 'monthly' ? 31 * rule.interval + 62 : 7 * rule.interval + 7;
  const from = date > anchor ? date : anchor;
  const found = occurrencesBetween(anchor, rule, from, addDays(from, span), until, 1);
  return found[0] ?? null;
}

export function nextAfter(anchor: LocalDate, rule: Rule, date: LocalDate, until: LocalDate | null = null): LocalDate | null {
  return nextOnOrAfter(anchor, rule, addDays(date, 1), until);
}

// ---------------------------------------------------------------------------
// A series and the occurrences the user has dealt with
// ---------------------------------------------------------------------------

export type OccurrenceStatus = 'completed' | 'skipped';

export type OccurrenceRecord = {
  date: LocalDate;
  status: OccurrenceStatus;
  movedToDate?: LocalDate | null;
  movedToTime?: LocalTime | null;
  completedAt?: string | null;
};

export type Series = { dueDate: LocalDate; dueTime: LocalTime | null; rule: Rule; until: LocalDate | null };

export type Occurrence = {
  /** The occurrence's own date in the series (its key). */
  date: LocalDate;
  /** Where it shows: the moved-to date and time when it was moved. */
  showDate: LocalDate;
  showTime: LocalTime | null;
  moved: boolean;
};

/** Is this record finished with (completed, or skipped without being moved)? */
function closes(r: OccurrenceRecord): boolean {
  return r.status === 'completed' || (r.status === 'skipped' && !r.movedToDate);
}

/** The latest occurrence date the user has finished with, or null. */
export function lastClosed(records: readonly OccurrenceRecord[]): LocalDate | null {
  let last: LocalDate | null = null;
  for (const r of records) if (closes(r) && (last == null || r.date > last)) last = r.date;
  return last;
}

function occurrenceAt(series: Series, date: LocalDate, records: readonly OccurrenceRecord[]): Occurrence {
  const record = records.find((r) => r.date === date && r.status === 'skipped' && r.movedToDate);
  return record
    ? { date, showDate: record.movedToDate!, showTime: record.movedToTime ?? series.dueTime, moved: true }
    : { date, showDate: date, showTime: series.dueTime, moved: false };
}

/** The occurrence that is up next: the first one after the last finished one. Null when the series is over. */
export function currentOccurrence(series: Series, records: readonly OccurrenceRecord[]): Occurrence | null {
  const last = lastClosed(records);
  const date = last == null
    ? nextOnOrAfter(series.dueDate, series.rule, series.dueDate, series.until)
    : nextAfter(series.dueDate, series.rule, last, series.until);
  return date ? occurrenceAt(series, date, records) : null;
}

/**
 * Occurrences after the current one, for the Upcoming view. The current one
 * is left out; it is shown on its own (moved or not).
 */
export function projectedOccurrences(
  series: Series,
  records: readonly OccurrenceRecord[],
  from: LocalDate,
  to: LocalDate,
): Occurrence[] {
  const current = currentOccurrence(series, records);
  if (!current) return [];
  const start = maxDateOf(from, addDays(current.date, 1));
  return occurrencesBetween(series.dueDate, series.rule, start, to, series.until)
    .map((d) => occurrenceAt(series, d, records))
    .filter((o) => !records.some((r) => r.date === o.date && closes(r)));
}

function maxDateOf(a: LocalDate, b: LocalDate): LocalDate {
  return compareDates(a, b) >= 0 ? a : b;
}

/**
 * What to record when the current occurrence is completed.
 *
 * If the next occurrence would already be in the past (the task was left
 * undone for a while), the last missed one is recorded as skipped too, so the
 * task moves on to today or later instead of making the user tick off every
 * missed day.
 */
export function planCompletion(
  series: Series,
  records: readonly OccurrenceRecord[],
  today: LocalDate,
  completedAt: string,
): OccurrenceRecord[] {
  const current = currentOccurrence(series, records);
  if (!current) return [];
  const out: OccurrenceRecord[] = [{ date: current.date, status: 'completed', completedAt, movedToDate: null, movedToTime: null }];
  const next = nextAfter(series.dueDate, series.rule, current.date, series.until);
  if (next && next < today) {
    const missed = occurrencesBetween(series.dueDate, series.rule, next, addDays(today, -1), series.until);
    const lastMissed = missed[missed.length - 1];
    if (lastMissed) out.push({ date: lastMissed, status: 'skipped', movedToDate: null, movedToTime: null });
  }
  return out;
}

/** Skipping the current occurrence. */
export function planSkip(series: Series, records: readonly OccurrenceRecord[]): OccurrenceRecord | null {
  const current = currentOccurrence(series, records);
  return current ? { date: current.date, status: 'skipped', movedToDate: null, movedToTime: null } : null;
}

/**
 * Moving one occurrence to another day (and time): the current one, or a
 * later one named by its own date (dragged in the calendar). A date that is
 * not an occurrence of the series, or one already completed or skipped,
 * moves nothing.
 */
export function planMove(
  series: Series,
  records: readonly OccurrenceRecord[],
  toDate: LocalDate,
  toTime: LocalTime | null,
  occurrenceDate?: LocalDate,
): OccurrenceRecord | null {
  if (occurrenceDate !== undefined) {
    if (!isLocalDate(occurrenceDate)) return null;
    const isOccurrence = occurrencesBetween(series.dueDate, series.rule, occurrenceDate, occurrenceDate, series.until).length === 1;
    if (!isOccurrence || records.some((r) => r.date === occurrenceDate && closes(r))) return null;
    return { date: occurrenceDate, status: 'skipped', movedToDate: toDate, movedToTime: toTime };
  }
  const current = currentOccurrence(series, records);
  return current ? { date: current.date, status: 'skipped', movedToDate: toDate, movedToTime: toTime } : null;
}

// ---------------------------------------------------------------------------
// Presets offered in the editor
// ---------------------------------------------------------------------------

export type RepeatPreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export function presetRule(preset: Exclude<RepeatPreset, 'none' | 'custom'>): Rule {
  switch (preset) {
    case 'daily':
      return { freq: 'daily', interval: 1 };
    case 'weekdays':
      return { freq: 'weekly', interval: 1, byDay: WORKDAYS };
    case 'weekly':
      return { freq: 'weekly', interval: 1 };
    case 'monthly':
      return { freq: 'monthly', interval: 1 };
    case 'yearly':
      return { freq: 'yearly', interval: 1 };
  }
}

export function presetOf(rule: Rule | null): RepeatPreset {
  if (!rule) return 'none';
  if (rule.interval !== 1) return 'custom';
  if (rule.freq === 'weekly') {
    if (!rule.byDay?.length) return 'weekly';
    return rule.byDay.join() === WORKDAYS.join() ? 'weekdays' : 'custom';
  }
  return rule.freq;
}

/**
 * The first day on or after `date` that a rule can fall on. A weekly rule
 * with chosen weekdays starts on the first of them, so a task due on a
 * Tuesday set to "every Mon and Wed" starts on Wednesday, not Tuesday.
 */
export function alignStart(date: LocalDate, rule: Rule): LocalDate {
  if (rule.freq !== 'weekly' || !rule.byDay?.length) return date;
  for (let i = 0; i < 7; i++) {
    const d = addDays(date, i);
    if (rule.byDay.includes(weekday(d) as Weekday)) return d;
  }
  return date;
}
