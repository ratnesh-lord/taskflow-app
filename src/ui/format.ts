import { formatTime, type LocalTime } from '@/core/dates';

let cached: boolean | null = null;

/** Whether this phone shows times as "7:00 pm" rather than "19:00". */
export function usesHour12(): boolean {
  if (cached == null) {
    try {
      cached = Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? false;
    } catch {
      cached = false;
    }
  }
  return cached;
}

/** A time in the phone's style. */
export function showTime(time: LocalTime): string {
  return formatTime(time, usesHour12());
}

/** A short time for list rows: "19:00", or "7 pm" / "7:30 pm". */
export function shortTime(time: LocalTime): string {
  const full = formatTime(time, usesHour12());
  return usesHour12() ? full.replace(':00 ', ' ') : full;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "45 min", "2 h", "1 h 30 min". */
export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "30 min before", "1 h before", "1 day before", "At the due time". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'At the due time';
  if (minutes % 1440 === 0) return `${plural(minutes / 1440, 'day')} before`;
  return `${duration(minutes)} before`;
}
