import type { ExternalEvent } from '@/core/calendar';
import type { LocalDate } from '@/core/dates';

/** Google Calendar events between two days, for the calendar views. */
export function useGoogleEvents(_from: LocalDate, _to: LocalDate): { items: ExternalEvent[]; message: string | null } {
  return { items: NONE, message: null };
}

const NONE: ExternalEvent[] = [];
