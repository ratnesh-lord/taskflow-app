/**
 * Quick add: one line of plain English turned into a task.
 *
 *   "Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before"
 *   → title "Complete AWS certification revision", due tomorrow 19:00, reminder 30 min before.
 *
 * What it understands (case does not matter):
 *   dates      today, tonight, tomorrow, day after tomorrow, monday / on fri / next friday,
 *              next week, next month, this weekend, in 3 days / in 2 weeks / in a month,
 *              15 nov, nov 15th, 15/11 (day first), 15/11/2027, 2026-11-15, on the 15th
 *   times      7pm, 7:30 pm, 19:00, at 7 (1–6 means afternoon), noon, midnight,
 *              morning 09:00, afternoon 14:00, evening 18:00, tonight 20:00, in 2 hours
 *   repeats    every day / weekday / weekend / week / month / year, every other week,
 *              every 3 days, every mon and wed, every 15th, every morning;
 *              daily / weekly / monthly / yearly at the end of the line
 *   reminders  remind me 30 minutes before, remind me 1 hour before, remind me at 6pm,
 *              remind me (at the due time)
 *   priority   p1–p4 or !1–!4 (critical → low), !high, "high priority", "priority low"
 *   tags       #exam   project  @work   estimate  for 45 min, for 2 hours
 *
 * Every recognised piece is reported with its position, so the screen can show
 * it and the user can tap it to keep those words in the title instead.
 */
import { addDays, addMonths, daysInMonth, isLocalDate, type LocalDate, type LocalTime, makeDate, minutesToTime, parts, weekday } from './dates';
import { formatRule, nextOnOrAfter, parseRule, type Rule, type Weekday, WORKDAYS } from './recurrence';
import type { Priority } from './types';

export type PieceKind = 'date' | 'time' | 'repeat' | 'reminder' | 'priority' | 'tag' | 'project' | 'estimate';

export type Piece = { kind: PieceKind; text: string; start: number; end: number };

export type ReminderDraft =
  | { kind: 'before_due'; offsetMinutes: number }
  | { kind: 'absolute'; date: LocalDate; time: LocalTime };

export type QuickAdd = {
  title: string;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  rrule: string | null;
  reminders: ReminderDraft[];
  priority: Priority | null;
  tags: string[];
  project: string | null;
  estimatedMinutes: number | null;
  pieces: Piece[];
};

export type QuickAddContext = {
  today: LocalDate;
  /** Minutes since midnight now, to tell whether a time today has passed. */
  nowMinutes: number;
  /** Texts of pieces the user tapped to keep as words (compared without case). */
  ignore?: readonly string[];
};

// ---------------------------------------------------------------------------
// Word lists
// ---------------------------------------------------------------------------

const WEEKDAY_WORDS: [RegExp, Weekday][] = [
  [/^sun/, 0], [/^mon/, 1], [/^tue/, 2], [/^wed/, 3], [/^thu/, 4], [/^fri/, 5], [/^sat/, 6],
];
const WD_FULL = '(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?';
const WD_ANY = '(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)s?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const NUM = '(\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half\\s+an?)';
const ORD = '(?:st|nd|rd|th)?';
const PREFIX = '(?:\\b(?:on|by|due|for)\\s+)?';
const TIME_AMPM = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)(?![a-z])';
const TIME_24 = '(\\d{1,2}):(\\d{2})(?!\\d)';

function weekdayOf(word: string): Weekday {
  const w = word.toLowerCase();
  for (const [re, day] of WEEKDAY_WORDS) if (re.test(w)) return day;
  throw new Error(`not a weekday: ${word}`);
}

function numberOf(word: string): number {
  const w = word.toLowerCase().replace(/\s+/g, ' ');
  if (/^half an?$/.test(w)) return 0.5;
  return /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? NaN;
}

function unitMinutes(unit: string): number {
  const u = unit.toLowerCase();
  if (/^m/.test(u)) return 1;
  if (/^h/.test(u)) return 60;
  if (/^d/.test(u)) return 1440;
  if (/^w/.test(u)) return 10080;
  return NaN;
}

function clockTime(hour: number, minute: number, meridiem: string | undefined): LocalTime | null {
  if (minute > 59) return null;
  let h = hour;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    const pm = /^p/i.test(meridiem);
    h = (h % 12) + (pm ? 12 : 0);
  } else if (h > 23) {
    return null;
  }
  return minutesToTime(h * 60 + minute);
}

/** "at 7" with no am or pm: 1–6 is taken as afternoon, 7–11 as morning. */
function bareHour(hour: number): LocalTime | null {
  if (hour >= 1 && hour <= 6) return minutesToTime((hour + 12) * 60);
  if (hour >= 0 && hour <= 23) return minutesToTime(hour * 60);
  return null;
}

/** The weekday on or after today (or strictly after, for "next"). */
function comingWeekday(today: LocalDate, day: Weekday, strictlyAfter: boolean): LocalDate {
  let diff = (day - weekday(today) + 7) % 7;
  if (diff === 0 && strictlyAfter) diff = 7;
  return addDays(today, diff);
}

/** A day and month without a year: this year, or next year if it has passed. */
function nextDayMonth(today: LocalDate, month: number, day: number, year?: number): LocalDate | null {
  if (month < 1 || month > 12) return null;
  const t = parts(today);
  let y = year ?? t.year;
  if (y < 100) y += 2000;
  if (day < 1 || day > daysInMonth(y, month)) {
    if (year != null || day > daysInMonth(y + 1, month)) return null;
  }
  let date = day <= daysInMonth(y, month) ? makeDate(y, month, day) : null;
  if (year == null && (date == null || date < today)) {
    y += 1;
    date = day <= daysInMonth(y, month) ? makeDate(y, month, day) : null;
  }
  return date;
}

/** The next date that falls on this day of a month (today counts). */
function nextMonthDay(today: LocalDate, day: number): LocalDate | null {
  if (day < 1 || day > 31) return null;
  for (let k = 0; k < 13; k += 1) {
    const first = addMonths(makeDate(parts(today).year, parts(today).month, 1), k);
    const p = parts(first);
    if (day <= daysInMonth(p.year, p.month)) {
      const d = makeDate(p.year, p.month, day);
      if (d >= today) return d;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

type State = {
  date: LocalDate | null;
  time: LocalTime | null;
  /** A time that only applies when no other time is given ("tonight", "every morning"). */
  softTime: LocalTime | null;
  rule: Rule | null;
  /** The date a repeat starts from, when the repeat names one ("every 15th"). */
  ruleStart: LocalDate | null;
  reminders: ReminderDraft[];
  absoluteReminders: { dateWord: string | null; time: LocalTime }[];
  priority: Priority | null;
  tags: string[];
  project: string | null;
  estimate: number | null;
};

type Rule_ = {
  kind: PieceKind;
  re: RegExp;
  /** Only when nothing but recognised pieces follows ("Water plants daily", not "daily standup notes"). */
  tail?: boolean;
  apply: (m: RegExpExecArray, s: State, ctx: QuickAddContext) => boolean;
};

const ruleOf = (r: Rule): Rule => r;

const RULES: Rule_[] = [
  // ---- reminders --------------------------------------------------------------
  {
    kind: 'reminder',
    re: new RegExp(`(?:,?\\s*\\band\\s+)?\\bremind\\s+me\\s+${NUM}\\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w)\\s+(?:before|earlier|ahead|prior)\\b(?:\\s+(?:it|that|the\\s+deadline))?`, 'gi'),
    apply: (m, s) => {
      const n = numberOf(m[1]);
      const unit = unitMinutes(m[2]);
      if (!Number.isFinite(n) || !Number.isFinite(unit)) return false;
      s.reminders.push({ kind: 'before_due', offsetMinutes: Math.round(n * unit) });
      return true;
    },
  },
  {
    kind: 'reminder',
    re: new RegExp(`(?:,?\\s*\\band\\s+)?\\bremind\\s+me\\s+(?:(today|tomorrow|tonight)\\s+)?(?:at\\s+)?(?:${TIME_AMPM}|${TIME_24}|(noon|midnight))`, 'gi'),
    apply: (m, s) => {
      const t =
        m[4] ? clockTime(Number(m[2]), Number(m[3] ?? 0), m[4])
        : m[5] ? clockTime(Number(m[5]), Number(m[6]), undefined)
        : m[7] ? (m[7].toLowerCase() === 'noon' ? '12:00' : '00:00')
        : null;
      if (!t) return false;
      s.absoluteReminders.push({ dateWord: m[1]?.toLowerCase() ?? null, time: t });
      return true;
    },
  },
  {
    kind: 'reminder',
    re: /(?:,?\s*\band\s+)?\bremind\s+me\b(?:\s+(?:to|of\s+it|about\s+it)\b)?/gi,
    apply: (_m, s) => {
      s.reminders.push({ kind: 'before_due', offsetMinutes: 0 });
      return true;
    },
  },

  // ---- repeats --------------------------------------------------------------------
  {
    kind: 'repeat',
    re: new RegExp(`\\bevery\\s+(\\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s+(days?|weeks?|months?|years?)\\b`, 'gi'),
    apply: (m, s) => {
      const n = numberOf(m[1]);
      const unit = m[2].toLowerCase();
      if (!Number.isInteger(n) || n < 1 || n > 999) return false;
      const freq = unit.startsWith('d') ? 'daily' : unit.startsWith('w') ? 'weekly' : unit.startsWith('m') ? 'monthly' : 'yearly';
      s.rule = ruleOf({ freq, interval: n });
      return true;
    },
  },
  {
    kind: 'repeat',
    re: new RegExp(`\\bevery\\s+(?:(other)\\s+)?(${WD_ANY}(?:\\s*(?:,|and|&)\\s*${WD_ANY})*)\\b`, 'gi'),
    apply: (m, s, ctx) => {
      const days = m[2].split(/\s*(?:,|and|&)\s*/i).filter(Boolean).map(weekdayOf);
      const rule: Rule = { freq: 'weekly', interval: m[1] ? 2 : 1, byDay: [...new Set(days)] };
      s.rule = ruleOf(parseRule(formatRule(rule)) ?? rule);
      s.ruleStart = s.ruleStart ?? ctx.today;
      return true;
    },
  },
  {
    kind: 'repeat',
    re: /\bevery\s+(?:(other)\s+)?(day|weekday|weekend|week|fortnight|month|year|morning|afternoon|evening|night)\b/gi,
    apply: (m, s) => {
      const every = m[1] ? 2 : 1;
      const word = m[2].toLowerCase();
      if (word === 'weekday') s.rule = { freq: 'weekly', interval: every, byDay: WORKDAYS };
      else if (word === 'weekend') s.rule = { freq: 'weekly', interval: every, byDay: [6, 0] };
      else if (word === 'week') s.rule = { freq: 'weekly', interval: every };
      else if (word === 'fortnight') s.rule = { freq: 'weekly', interval: 2 };
      else if (word === 'month') s.rule = { freq: 'monthly', interval: every };
      else if (word === 'year') s.rule = { freq: 'yearly', interval: every };
      else s.rule = { freq: 'daily', interval: every };
      if (word === 'morning') s.softTime = '09:00';
      if (word === 'afternoon') s.softTime = '14:00';
      if (word === 'evening') s.softTime = '18:00';
      if (word === 'night') s.softTime = '21:00';
      return true;
    },
  },
  {
    kind: 'repeat',
    re: new RegExp(`\\bevery\\s+(?:month\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}(?:\\s+(?:of\\s+)?(?:the|every|each)\\s+month)?(?!\\s*(?:days?|weeks?|months?|years?|${MONTH_RE}))\\b`, 'gi'),
    apply: (m, s, ctx) => {
      const start = nextMonthDay(ctx.today, Number(m[1]));
      if (!start) return false;
      s.rule = { freq: 'monthly', interval: 1 };
      s.ruleStart = start;
      return true;
    },
  },

  // ---- dates ------------------------------------------------------------------------------
  {
    kind: 'date',
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    apply: (m, s) => {
      const d = `${m[1]}-${m[2]}-${m[3]}`;
      if (!isLocalDate(d)) return false;
      s.date = d;
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`${PREFIX}(?:the\\s+)?\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4}))?`, 'gi'),
    apply: (m, s, ctx) => {
      const d = nextDayMonth(ctx.today, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, Number(m[1]), m[3] ? Number(m[3]) : undefined);
      if (!d) return false;
      s.date = d;
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`${PREFIX}\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})${ORD}\\b(?:,?\\s+(\\d{4}))?`, 'gi'),
    apply: (m, s, ctx) => {
      const d = nextDayMonth(ctx.today, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]), m[3] ? Number(m[3]) : undefined);
      if (!d) return false;
      s.date = d;
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`${PREFIX}\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?\\b(?![/:\\d-])`, 'gi'),
    apply: (m, s, ctx) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const year = m[3] ? Number(m[3]) : undefined;
      // Day first, as written in India; month first only when day first is impossible.
      const d = nextDayMonth(ctx.today, b, a, year) ?? (a <= 12 ? nextDayMonth(ctx.today, a, b, year) : null);
      if (!d) return false;
      s.date = d;
      return true;
    },
  },
  {
    kind: 'date',
    re: /(?:\b(?:on|by|due)\s+)?\b(?:the\s+)?day\s+after\s+tomorrow\b/gi,
    apply: (_m, s, ctx) => {
      s.date = addDays(ctx.today, 2);
      return true;
    },
  },
  {
    kind: 'date',
    re: /(?:\b(?:on|by|due|for)\s+)?\b(today|tonight|tomorrow|tmrw|tmr)\b/gi,
    apply: (m, s, ctx) => {
      const w = m[1].toLowerCase();
      s.date = w === 'today' || w === 'tonight' ? ctx.today : addDays(ctx.today, 1);
      if (w === 'tonight') s.softTime = '20:00';
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`(?:\\b(?:on|by|due|for)\\s+)?\\b(?:(this|next|coming)\\s+)?(${WD_FULL})\\b|\\b(?:on|by|due|for|this|next|coming)\\s+(${WD_ANY})\\b`, 'gi'),
    apply: (m, s, ctx) => {
      // "friday", "on fri", "next friday": the coming Friday, never today.
      s.date = comingWeekday(ctx.today, weekdayOf(m[2] ?? m[3]), true);
      return true;
    },
  },
  {
    kind: 'date',
    re: /(?:\b(?:on|by|due|for)\s+)?\b(?:(this|next)\s+)?(weekend|week|month)\b/gi,
    apply: (m, s, ctx) => {
      const which = m[1]?.toLowerCase();
      const word = m[2].toLowerCase();
      if (word === 'weekend') {
        const wd = weekday(ctx.today);
        s.date = wd === 0 || wd === 6 ? (which === 'next' ? comingWeekday(ctx.today, 6, true) : ctx.today) : comingWeekday(ctx.today, 6, false);
        return true;
      }
      if (which !== 'next') return false;
      if (word === 'week') s.date = comingWeekday(ctx.today, 1, true);
      else s.date = addMonths(makeDate(parts(ctx.today).year, parts(ctx.today).month, 1), 1);
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`\\bin\\s+${NUM}\\s+(days?|weeks?|months?|years?)\\b`, 'gi'),
    apply: (m, s, ctx) => {
      const n = numberOf(m[1]);
      if (!Number.isInteger(n) || n < 1 || n > 3650) return false;
      const u = m[2].toLowerCase();
      s.date = u.startsWith('d') ? addDays(ctx.today, n) : u.startsWith('w') ? addDays(ctx.today, 7 * n) : addMonths(ctx.today, u.startsWith('m') ? n : 12 * n);
      return true;
    },
  },
  {
    kind: 'date',
    re: new RegExp(`\\b(?:on|by|due)\\s+the\\s+(\\d{1,2})${ORD}\\b(?!\\s*(?:${MONTH_RE}|of))`, 'gi'),
    apply: (m, s, ctx) => {
      const d = nextMonthDay(ctx.today, Number(m[1]));
      if (!d) return false;
      s.date = d;
      return true;
    },
  },

  // ---- times --------------------------------------------------------------------------------
  {
    kind: 'time',
    re: new RegExp(`\\bin\\s+${NUM}\\s+(hours?|hrs?|minutes?|mins?)\\b`, 'gi'),
    apply: (m, s, ctx) => {
      const n = numberOf(m[1]);
      if (!Number.isFinite(n) || n <= 0) return false;
      const total = ctx.nowMinutes + Math.round(n * unitMinutes(m[2]));
      s.date = s.date ?? addDays(ctx.today, Math.floor(total / 1440));
      s.time = minutesToTime(total % 1440);
      return true;
    },
  },
  {
    kind: 'time',
    re: new RegExp(`(?:\\b(?:at|by|@)\\s*)?\\b${TIME_AMPM}`, 'gi'),
    apply: (m, s) => {
      const t = clockTime(Number(m[1]), Number(m[2] ?? 0), m[3]);
      if (!t) return false;
      s.time = t;
      return true;
    },
  },
  {
    kind: 'time',
    re: new RegExp(`(?:\\b(?:at|by)\\s+)?\\b${TIME_24}`, 'gi'),
    apply: (m, s) => {
      const t = clockTime(Number(m[1]), Number(m[2]), undefined);
      if (!t) return false;
      s.time = t;
      return true;
    },
  },
  {
    kind: 'time',
    re: /\b(?:at|by)\s+(\d{1,2})(?:\.(\d{2}))?(?:\s*o'?clock)?\b(?![:./\d-])(?!\s*(?:%|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|people|kg|km|rs|inr|units?|items?|pages?)\b)/gi,
    apply: (m, s) => {
      const hour = Number(m[1]);
      const minute = Number(m[2] ?? 0);
      const t = bareHour(hour);
      if (!t || minute > 59) return false;
      s.time = minutesToTime((Number(t.slice(0, 2)) * 60) + minute);
      return true;
    },
  },
  {
    kind: 'time',
    re: /(?:\b(?:at|by)\s+)?\b(noon|midday|midnight)\b/gi,
    apply: (m, s) => {
      s.time = m[1].toLowerCase() === 'midnight' ? '00:00' : '12:00';
      return true;
    },
  },
  {
    kind: 'time',
    re: /\b(?:in\s+the\s+|this\s+)(morning|afternoon|evening)\b/gi,
    apply: (m, s) => {
      const w = m[1].toLowerCase();
      s.softTime = w === 'morning' ? '09:00' : w === 'afternoon' ? '14:00' : '18:00';
      return true;
    },
  },

  // ---- priority, tags, project, estimate ------------------------------------------------------
  {
    kind: 'priority',
    re: /(?:^|\s)(?:p([1-4])|!([1-4])|!(critical|urgent|high|medium|normal|low))(?=\s|$|[,.;])/gi,
    apply: (m, s) => {
      const w = m[3]?.toLowerCase();
      s.priority = w
        ? w === 'urgent' ? 'critical' : w === 'normal' ? 'medium' : (w as Priority)
        : (['critical', 'high', 'medium', 'low'] as const)[Number(m[1] ?? m[2]) - 1];
      return true;
    },
  },
  {
    kind: 'priority',
    re: /\b(?:(critical|urgent|high|medium|normal|low)\s+priority|priority\s*:?\s*(critical|urgent|high|medium|normal|low))\b/gi,
    apply: (m, s) => {
      const w = (m[1] ?? m[2]).toLowerCase();
      s.priority = w === 'urgent' ? 'critical' : w === 'normal' ? 'medium' : (w as Priority);
      return true;
    },
  },
  {
    kind: 'tag',
    re: /(?:^|\s)#([^\s#@,;]+)/g,
    apply: (m, s) => {
      const tag = m[1].replace(/[.!?]+$/, '');
      if (!tag || /^\d+$/.test(tag)) return false;
      if (!s.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) s.tags.push(tag);
      return true;
    },
  },
  {
    kind: 'project',
    re: /(?:^|\s)@([^\s#@,;]+)/g,
    apply: (m, s) => {
      const name = m[1].replace(/[.!?]+$/, '');
      if (!name || /^\d/.test(name)) return false;
      s.project = name;
      return true;
    },
  },
  {
    kind: 'estimate',
    re: new RegExp(`\\bfor\\s+(?:about\\s+)?${NUM}\\s*(minutes?|mins?|m|hours?|hrs?|h)\\b`, 'gi'),
    apply: (m, s) => {
      const n = numberOf(m[1]);
      const minutes = Math.round(n * unitMinutes(m[2]));
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 100000) return false;
      s.estimate = minutes;
      return true;
    },
  },

  // ---- single repeat words, only at the end -------------------------------------------------------
  {
    kind: 'repeat',
    tail: true,
    re: /\b(daily|weekdays|weekends|weekly|fortnightly|monthly|yearly|annually)\b/gi,
    apply: (m, s) => {
      if (s.rule) return false;
      const w = m[1].toLowerCase();
      s.rule =
        w === 'daily' ? { freq: 'daily', interval: 1 }
        : w === 'weekdays' ? { freq: 'weekly', interval: 1, byDay: WORKDAYS }
        : w === 'weekends' ? { freq: 'weekly', interval: 1, byDay: [6, 0] }
        : w === 'weekly' ? { freq: 'weekly', interval: 1 }
        : w === 'fortnightly' ? { freq: 'weekly', interval: 2 }
        : w === 'monthly' ? { freq: 'monthly', interval: 1 }
        : { freq: 'yearly', interval: 1 };
      return true;
    },
  },
];

const CONNECTORS = /^(?:and|at|on|by|due|to|for|the|with|then)$/i;

function cleanTitle(text: string): string {
  let words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const isJunk = (w: string) => CONNECTORS.test(w) || /^[,;:\-–—&]+$/.test(w);
  while (words.length && isJunk(words[words.length - 1])) words = words.slice(0, -1);
  while (words.length && /^(?:and|then|,|;|-|–|—)$/i.test(words[0])) words = words.slice(1);
  return words.join(' ').replace(/\s+([,;:.!?])/g, '$1').replace(/[,;:\-–—]+$/, '').trim();
}

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAdd {
  const ignore = new Set((ctx.ignore ?? []).map((t) => t.trim().toLowerCase()));
  const used = new Array<boolean>(text.length).fill(false);
  const pieces: Piece[] = [];
  const s: State = {
    date: null, time: null, softTime: null, rule: null, ruleStart: null, reminders: [], absoluteReminders: [],
    priority: null, tags: [], project: null, estimate: null,
  };

  const free = (start: number, end: number) => {
    for (let i = start; i < end; i += 1) if (used[i]) return false;
    return true;
  };
  const onlyPiecesAfter = (end: number) => {
    for (let i = end; i < text.length; i += 1) if (!used[i] && !/[\s,.;!]/.test(text[i])) return false;
    return true;
  };

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
        continue;
      }
      // Leading whitespace in a match is not part of the piece.
      const lead = m[0].length - m[0].trimStart().length;
      const start = m.index + lead;
      const end = m.index + m[0].trimEnd().length;
      const piece = text.slice(start, end);
      if (!free(start, end) || ignore.has(piece.trim().toLowerCase())) continue;
      if (rule.tail && !onlyPiecesAfter(end)) continue;
      // Kinds that only make sense once (a second date or time is left in the title).
      if ((rule.kind === 'date' && s.date) || (rule.kind === 'time' && s.time && !/in\s/i.test(piece)) || (rule.kind === 'repeat' && s.rule)) continue;
      const snapshot = JSON.stringify(s);
      if (!rule.apply(m, s, ctx)) {
        Object.assign(s, JSON.parse(snapshot));
        continue;
      }
      for (let i = start; i < end; i += 1) used[i] = true;
      pieces.push({ kind: rule.kind, text: piece, start, end });
    }
  }

  // ---- put the pieces together ------------------------------------------------------------
  const time = s.time ?? s.softTime;
  let date = s.date;
  let rrule: string | null = null;

  if (s.rule) {
    rrule = formatRule(s.rule);
    // A repeat starts on the named date, else on its first occurrence from today.
    const from = date ?? s.ruleStart ?? ctx.today;
    let first = nextOnOrAfter(from, s.rule, from) ?? from;
    // Started today at a time already gone: begin with the next occurrence instead.
    const minutes = time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : null;
    if (!s.date && first === ctx.today && minutes != null && minutes <= ctx.nowMinutes) {
      first = nextOnOrAfter(from, s.rule, addDays(ctx.today, 1)) ?? first;
    }
    date = first;
  } else if (!date && time) {
    // A time alone means today, or tomorrow if that time has passed.
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    date = minutes > ctx.nowMinutes ? ctx.today : addDays(ctx.today, 1);
  }

  const reminders = [...s.reminders];
  for (const r of s.absoluteReminders) {
    let rd = r.dateWord === 'tomorrow' ? addDays(ctx.today, 1) : r.dateWord ? ctx.today : date ?? ctx.today;
    const minutes = Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3));
    if (!r.dateWord && !date && minutes <= ctx.nowMinutes) rd = addDays(ctx.today, 1);
    reminders.push({ kind: 'absolute', date: rd, time: r.time });
  }

  // Remove the recognised pieces from the title.
  let title = '';
  for (let i = 0; i < text.length; i += 1) title += used[i] ? ' ' : text[i];

  pieces.sort((a, b) => a.start - b.start);
  return {
    title: cleanTitle(title),
    dueDate: date,
    dueTime: time,
    rrule,
    reminders,
    priority: s.priority,
    tags: s.tags,
    project: s.project,
    estimatedMinutes: s.estimate,
    pieces,
  };
}
