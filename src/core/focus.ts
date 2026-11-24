/**
 * The focus timer: timed periods of focus on one task (or none), with
 * breaks between them.
 *
 * A session is stored when it starts (started_at, planned_minutes). It needs
 * no further write to finish: once its planned time has passed it counts as
 * finished on time. Stopping early writes ended_at. Because the end is worked
 * out from the start, the timer keeps the right time while the app is
 * closed, and the phone that started it rings at the end (device_id).
 */
import type { LocalDate } from './dates';
import type { ToLocalDate } from './agenda';

export type FocusKind = 'focus' | 'break';

export type FocusRecord = {
  id: string;
  taskId: string | null;
  kind: FocusKind;
  startedAt: string;
  plannedMinutes: number;
  endedAt: string | null;
  deviceId: string | null;
};

export const FOCUS_MINUTES = [15, 25, 45, 60, 90] as const;
export const BREAK_MINUTES = [5, 10, 15, 30] as const;
export const DEFAULT_FOCUS = 25;
export const SHORT_BREAK = 5;
export const LONG_BREAK = 15;
/** A long break after this many focus sessions in a day. */
export const SESSIONS_BEFORE_LONG_BREAK = 4;
export const MAX_MINUTES = 240;

/** Stopped this close to the end still counts as finished. */
const ON_TIME_MS = 30_000;

const startMs = (s: FocusRecord) => Date.parse(s.startedAt);

export function plannedEndMs(s: FocusRecord): number {
  return startMs(s) + s.plannedMinutes * 60_000;
}

/** When it ended: when it was stopped, or its planned end. */
export function endMs(s: FocusRecord): number {
  const planned = plannedEndMs(s);
  if (!s.endedAt) return planned;
  const stopped = Date.parse(s.endedAt);
  return Number.isFinite(stopped) ? Math.min(stopped, planned) : planned;
}

export function isRunning(s: FocusRecord, nowMs: number): boolean {
  return !s.endedAt && plannedEndMs(s) > nowMs && Number.isFinite(startMs(s));
}

/** The session running now, if any (the latest started, when two devices each started one). */
export function runningSession(sessions: readonly FocusRecord[], nowMs: number): FocusRecord | null {
  let best: FocusRecord | null = null;
  for (const s of sessions) if (isRunning(s, nowMs) && (!best || s.startedAt > best.startedAt)) best = s;
  return best;
}

export function remainingMs(s: FocusRecord, nowMs: number): number {
  return Math.max(0, endMs(s) - nowMs);
}

/** Whole minutes spent so far (or in total, once over). */
export function spentMinutes(s: FocusRecord, nowMs: number): number {
  const ms = Math.min(endMs(s), nowMs) - startMs(s);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0;
}

export function finishedOnTime(s: FocusRecord): boolean {
  if (!s.endedAt) return true;
  return Date.parse(s.endedAt) >= plannedEndMs(s) - ON_TIME_MS;
}

/** "24:59", "1:05:00". */
export function clock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}

/** Focus sessions (not breaks) that ended, finished on time, on this day. */
export function finishedToday(sessions: readonly FocusRecord[], today: LocalDate, nowMs: number, toLocal: ToLocalDate): number {
  return sessions.filter((s) => s.kind === 'focus' && !isRunning(s, nowMs) && finishedOnTime(s) && toLocal(s.startedAt) === today).length;
}

/** The break to take next: a long one after every fourth focus session of the day. */
export function nextBreakMinutes(finishedFocusToday: number): number {
  return finishedFocusToday > 0 && finishedFocusToday % SESSIONS_BEFORE_LONG_BREAK === 0 ? LONG_BREAK : SHORT_BREAK;
}

/** Minutes of focus per day (by the day each session started); breaks are left out. */
export function focusMinutesByDay(sessions: readonly FocusRecord[], nowMs: number, toLocal: ToLocalDate): Map<LocalDate, number> {
  const out = new Map<LocalDate, number>();
  for (const s of sessions) {
    if (s.kind !== 'focus') continue;
    const day = toLocal(s.startedAt);
    out.set(day, (out.get(day) ?? 0) + spentMinutes(s, nowMs));
  }
  return out;
}

export type FocusTotals = { minutes: number; sessions: number; finished: number };

/** Focus from one day to another (inclusive). */
export function focusTotals(sessions: readonly FocusRecord[], from: LocalDate, to: LocalDate, nowMs: number, toLocal: ToLocalDate): FocusTotals {
  let minutes = 0;
  let count = 0;
  let finished = 0;
  for (const s of sessions) {
    if (s.kind !== 'focus') continue;
    const day = toLocal(s.startedAt);
    if (day < from || day > to) continue;
    count += 1;
    minutes += spentMinutes(s, nowMs);
    if (!isRunning(s, nowMs) && finishedOnTime(s)) finished += 1;
  }
  return { minutes, sessions: count, finished };
}

/** "1 h 40 min", "25 min", "0 min". */
export function minutesWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
