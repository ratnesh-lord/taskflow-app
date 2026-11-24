/**
 * Habits: something done regularly, with a target per day ("8 glasses of
 * water", "1 run"). Each time it is done is a log row with an amount; a day
 * counts as done when its amounts add up to the target.
 *
 * Schedules, as stored (supabase/migrations/20261125000100_productivity.sql):
 *   daily          every day
 *   days:1,3,5     on those weekdays (0 = Sunday … 6 = Saturday)
 *   week:3         on any 3 days of each week (weeks start on Monday)
 */
import { addDays, compareDates, type LocalDate, type LocalTime, startOfWeek, WEEKDAY_SHORT, weekday } from './dates';

export type Schedule = { kind: 'daily' } | { kind: 'days'; days: number[] } | { kind: 'week'; times: number };

export type HabitRecord = {
  id: string;
  title: string;
  icon: string | null;
  color: string | null;
  schedule: string;
  target: number;
  unit: string;
  reminderTime: LocalTime | null;
  status: 'active' | 'archived';
  sortOrder: number;
  createdAt: string;
};

export type HabitLogRecord = { id: string; habitId: string; date: LocalDate; amount: number; loggedAt: string };

export const MAX_TARGET = 1000;
export const MAX_UNIT = 30;

/** How far back streaks look (about three years). */
const LOOKBACK_DAYS = 1100;

const SCHEDULE_RE = /^(daily|days:[0-6](,[0-6]){0,6}|week:[1-7])$/;

export function isScheduleText(text: string): boolean {
  return SCHEDULE_RE.test(text);
}

export function parseSchedule(text: string | null | undefined): Schedule {
  if (!text || !SCHEDULE_RE.test(text) || text === 'daily') return { kind: 'daily' };
  if (text.startsWith('week:')) return { kind: 'week', times: Number(text.slice(5)) };
  const days = [...new Set(text.slice(5).split(',').map(Number))].sort((a, b) => a - b);
  return days.length === 7 ? { kind: 'daily' } : { kind: 'days', days };
}

export function formatSchedule(s: Schedule): string {
  if (s.kind === 'daily') return 'daily';
  if (s.kind === 'week') return `week:${Math.min(7, Math.max(1, Math.round(s.times)))}`;
  const days = [...new Set(s.days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return 'daily';
  return `days:${days.join(',')}`;
}

/** "Every day", "Weekdays", "Mon, Wed, Fri", "3 days a week". */
export function describeSchedule(s: Schedule): string {
  if (s.kind === 'daily') return 'Every day';
  if (s.kind === 'week') return s.times === 7 ? 'Every day' : s.times === 1 ? 'Once a week' : `${s.times} days a week`;
  const key = s.days.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  // Monday first, as the week is shown.
  return [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_SHORT[d]).join(', ');
}

/** Is the habit meant to be done on this day? A "N days a week" habit can be done on any day. */
export function isScheduled(s: Schedule, date: LocalDate): boolean {
  return s.kind !== 'days' || s.days.includes(weekday(date));
}

/** Total amount logged per day. */
export function amountsByDate(logs: readonly HabitLogRecord[]): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const l of logs) out.set(l.date, (out.get(l.date) ?? 0) + l.amount);
  return out;
}

export type DayState =
  /** reached the target */
  | 'done'
  /** some, not enough */
  | 'partial'
  /** a scheduled day that passed with nothing */
  | 'missed'
  /** today, nothing yet */
  | 'open'
  /** not a scheduled day (or any day of an "N days a week" habit) with nothing */
  | 'rest'
  /** before the habit was created */
  | 'before'
  | 'future';

export function dayState(
  habit: Pick<HabitRecord, 'schedule' | 'target'>, amounts: ReadonlyMap<LocalDate, number>, date: LocalDate, today: LocalDate, createdOn?: LocalDate,
): DayState {
  if (compareDates(date, today) > 0) return 'future';
  const count = amounts.get(date) ?? 0;
  if (count >= habit.target) return 'done';
  if (count > 0) return 'partial';
  if (createdOn && date < createdOn) return 'before';
  const s = parseSchedule(habit.schedule);
  if (s.kind === 'week' || !isScheduled(s, date)) return 'rest';
  return date === today ? 'open' : 'missed';
}

/** Days of one Monday-to-Sunday week that reached the target. */
function doneDaysInWeek(target: number, amounts: ReadonlyMap<LocalDate, number>, monday: LocalDate): number {
  let n = 0;
  for (let i = 0; i < 7; i += 1) if ((amounts.get(addDays(monday, i)) ?? 0) >= target) n += 1;
  return n;
}

export type Streak = {
  /** Done in a row up to now (today or this week still counts while it is not over). */
  current: number;
  best: number;
  /** What one step of the streak is. */
  unit: 'day' | 'week';
};

/**
 * Streaks over scheduled days, or over weeks for an "N days a week" habit.
 * Unscheduled days neither break nor extend a streak. Today (or this week)
 * not yet done does not break it either: the day is not over.
 */
export function streakOf(habit: Pick<HabitRecord, 'schedule' | 'target'>, logs: readonly HabitLogRecord[], today: LocalDate): Streak {
  const s = parseSchedule(habit.schedule);
  const amounts = amountsByDate(logs);
  let first = today;
  for (const d of amounts.keys()) if (d < first) first = d;
  if (first < addDays(today, -LOOKBACK_DAYS)) first = addDays(today, -LOOKBACK_DAYS);

  const slots: boolean[] = [];
  if (s.kind === 'week') {
    for (let w = startOfWeek(first); w <= today; w = addDays(w, 7)) slots.push(doneDaysInWeek(habit.target, amounts, w) >= s.times);
  } else {
    for (let d = first; d <= today; d = addDays(d, 1)) {
      if (isScheduled(s, d)) slots.push((amounts.get(d) ?? 0) >= habit.target);
    }
  }

  let best = 0;
  let run = 0;
  for (const done of slots) {
    run = done ? run + 1 : 0;
    if (run > best) best = run;
  }
  let i = slots.length - 1;
  const lastIsNow = s.kind === 'week' || isScheduled(s, today);
  if (i >= 0 && !slots[i] && lastIsNow) i -= 1; // today, or this week, is still going
  let current = 0;
  while (i >= 0 && slots[i]) {
    current += 1;
    i -= 1;
  }
  return { current, best, unit: s.kind === 'week' ? 'week' : 'day' };
}

/**
 * Share of scheduled days (or weeks) from `from` to `to` that reached the
 * target, counting only from the day the habit was created. Today, or this
 * week, counts only once it is done. Null when there is nothing to count yet.
 */
export function completionRate(
  habit: Pick<HabitRecord, 'schedule' | 'target'>,
  logs: readonly HabitLogRecord[],
  from: LocalDate,
  to: LocalDate,
  today: LocalDate,
  createdOn: LocalDate,
): { done: number; total: number; percent: number | null } {
  const s = parseSchedule(habit.schedule);
  const amounts = amountsByDate(logs);
  const start = createdOn > from ? createdOn : from;
  const end = to < today ? to : today;
  let done = 0;
  let total = 0;
  if (s.kind === 'week') {
    for (let w = startOfWeek(start); w <= end; w = addDays(w, 7)) {
      const met = doneDaysInWeek(habit.target, amounts, w) >= s.times;
      const over = addDays(w, 6) < today;
      if (met) done += 1;
      if (met || over) total += 1;
    }
  } else {
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!isScheduled(s, d)) continue;
      const met = (amounts.get(d) ?? 0) >= habit.target;
      if (met) done += 1;
      if (met || d < today) total += 1;
    }
  }
  return { done, total, percent: total === 0 ? null : Math.round((done / total) * 100) };
}

export type HabitToday = {
  count: number;
  target: number;
  done: boolean;
  /** Should it be done today (false on a rest day of a "Mon, Wed, Fri" habit, or once the week's days are met). */
  due: boolean;
  /** For "N days a week": days done this week and how many are wanted. */
  week: { done: number; wanted: number } | null;
};

export function habitToday(habit: Pick<HabitRecord, 'schedule' | 'target'>, logs: readonly HabitLogRecord[], today: LocalDate): HabitToday {
  const s = parseSchedule(habit.schedule);
  const amounts = amountsByDate(logs);
  const count = amounts.get(today) ?? 0;
  const done = count >= habit.target;
  if (s.kind === 'week') {
    const weekDone = doneDaysInWeek(habit.target, amounts, startOfWeek(today));
    return { count, target: habit.target, done, due: !done && weekDone < s.times, week: { done: weekDone, wanted: s.times } };
  }
  return { count, target: habit.target, done, due: !done && isScheduled(s, today), week: null };
}

/** The last seven days, oldest first, for the row of squares under each habit. */
export function lastSevenDays(
  habit: Pick<HabitRecord, 'schedule' | 'target'>, logs: readonly HabitLogRecord[], today: LocalDate, createdOn?: LocalDate,
): { date: LocalDate; state: DayState }[] {
  const amounts = amountsByDate(logs);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, state: dayState(habit, amounts, date, today, createdOn) };
  });
}

/** When it was last done, or null. */
export function lastLoggedAt(logs: readonly HabitLogRecord[]): string | null {
  let last: string | null = null;
  for (const l of logs) if (!last || l.loggedAt > last) last = l.loggedAt;
  return last;
}

/** "Just now", "25 min ago", "3 h ago", "2 days ago". */
export function sinceWords(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/**
 * Days in the next `days` (from today) on which the habit's reminder should
 * ring: scheduled days, except today once it is done, and for an "N days a
 * week" habit, not once this week's days are met.
 */
export function reminderDays(habit: HabitRecord, logs: readonly HabitLogRecord[], today: LocalDate, days: number): LocalDate[] {
  if (habit.status !== 'active' || !habit.reminderTime) return [];
  const s = parseSchedule(habit.schedule);
  const amounts = amountsByDate(logs);
  const out: LocalDate[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = addDays(today, i);
    if (!isScheduled(s, d)) continue;
    if ((amounts.get(d) ?? 0) >= habit.target) continue;
    if (s.kind === 'week' && startOfWeek(d) === startOfWeek(today) && doneDaysInWeek(habit.target, amounts, startOfWeek(today)) >= s.times) continue;
    out.push(d);
  }
  return out;
}

/** "3 of 8 glasses", "Done", "1 of 1". */
export function progressWords(t: HabitToday, unit: string): string {
  if (t.target === 1) return t.done ? 'Done today' : 'Not yet today';
  return `${t.count} of ${t.target}${unit ? ` ${unit}` : ''}`;
}

/** Pictures offered for a habit. */
export const HABIT_EMOJI = [
  '💧', '🏃', '🏋️', '🧘', '🚴', '🚶', '📚', '✍️',
  '💊', '🍎', '🥗', '😴', '☀️', '🌙', '🦷', '🧹',
  '🙏', '💰', '📞', '🌱', '🐶', '🎵', '✅', '⭐',
] as const;
