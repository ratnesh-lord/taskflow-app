/**
 * Calendar dates and clock times without time zones.
 *
 * A task's due date and time are "floating": a task due at 19:00 on
 * 2026-11-20 is due at 19:00 wherever the phone is. They are kept as text:
 *   LocalDate  "YYYY-MM-DD"
 *   LocalTime  "HH:MM" (24-hour)
 * Arithmetic is done on UTC midnights so daylight-saving changes never shift a day.
 */

export type LocalDate = string;
export type LocalTime = string;

/** The current moment as the phone sees it. */
export type Now = { date: LocalDate; minutes: number };

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function makeDate(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

export function parts(date: LocalDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Not a date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function toMs(date: LocalDate): number {
  const { year, month, day } = parts(date);
  return Date.UTC(year, month - 1, day);
}

function fromMs(ms: number): LocalDate {
  const d = new Date(ms);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromMs(toMs(date) + days * DAY_MS);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/**
 * Months later, on `day` (default: the date's own day). A day the month does
 * not have becomes its last day: 31 January + 1 month = 28 or 29 February.
 */
export function addMonths(date: LocalDate, months: number, day?: number): LocalDate {
  const p = parts(date);
  const index = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return makeDate(year, month, Math.min(day ?? p.day, daysInMonth(year, month)));
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: LocalDate): number {
  return new Date(toMs(date)).getUTCDay();
}

/** The Monday on or before the date. */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a > b ? a : b;
}

/** The calendar date and minute of a moment, in the phone's own time zone. */
export function nowFrom(moment: Date): Now {
  return {
    date: makeDate(moment.getFullYear(), moment.getMonth() + 1, moment.getDate()),
    minutes: moment.getHours() * 60 + moment.getMinutes(),
  };
}

export function localDateOf(moment: Date): LocalDate {
  return nowFrom(moment).date;
}

/** "19:00" → 1140. Returns null for anything that is not a time of day. */
export function timeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = TIME_RE.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

export function minutesToTime(minutes: number): LocalTime {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Normalises "7:05", "07:05:00" and the like to "07:05". */
export function normaliseTime(time: string | null | undefined): LocalTime | null {
  const m = timeToMinutes(time);
  return m == null ? null : minutesToTime(m);
}

/** A local date and time as a real moment on this phone. */
export function toMoment(date: LocalDate, time: LocalTime | null): Date {
  const { year, month, day } = parts(date);
  const m = timeToMinutes(time) ?? 0;
  return new Date(year, month - 1, day, Math.floor(m / 60), m % 60);
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** "Today", "Tomorrow", "Yesterday", "Friday" within the coming week, else "Fri 21 Nov" (with the year if it differs). */
export function dayLabel(date: LocalDate, today: LocalDate): string {
  const diff = diffDays(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return WEEKDAY_LONG[weekday(date)];
  return shortDate(date, today);
}

/** "Fri 21 Nov", or "Fri 21 Nov 2027" outside the current year. */
export function shortDate(date: LocalDate, today: LocalDate): string {
  const p = parts(date);
  const base = `${WEEKDAY_SHORT[weekday(date)]} ${p.day} ${MONTH_SHORT[p.month - 1]}`;
  return p.year === parts(today).year ? base : `${base} ${p.year}`;
}

/** "Saturday 14 November". */
export function longDate(date: LocalDate): string {
  const p = parts(date);
  return `${WEEKDAY_LONG[weekday(date)]} ${p.day} ${MONTH_LONG[p.month - 1]}`;
}

/** "19:00" or "7:00 pm". */
export function formatTime(time: LocalTime, hour12: boolean): string {
  const m = timeToMinutes(time);
  if (m == null) return time;
  if (!hour12) return minutesToTime(m);
  const h = Math.floor(m / 60);
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)} ${suffix}`;
}
