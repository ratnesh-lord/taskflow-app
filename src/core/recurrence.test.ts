import { addDays, addMonths, diffDays, parts, startOfWeek, weekday } from './dates';
import {
  currentOccurrence, describeRule, formatRule, nextAfter, nextOnOrAfter, occurrencesBetween, type OccurrenceRecord,
  parseRule, planCompletion, planMove, planSkip, presetOf, projectedOccurrences, type Rule, type Series, type Weekday,
} from './recurrence';

const rule = (text: string) => {
  const r = parseRule(text);
  if (!r) throw new Error(`bad rule ${text}`);
  return r;
};
const series = (dueDate: string, text: string, until: string | null = null, dueTime: string | null = null): Series => ({
  dueDate, dueTime, rule: rule(text), until,
});

describe('rule text', () => {
  it('reads and writes the supported rules', () => {
    for (const text of ['FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'FREQ=MONTHLY', 'FREQ=YEARLY']) {
      expect(formatRule(rule(text))).toBe(text);
    }
    expect(formatRule(rule('freq=weekly;byday=we,mo'))).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(formatRule(rule('RRULE:FREQ=WEEKLY;BYDAY=SU,SA'))).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
  });

  it('refuses rules it cannot follow', () => {
    for (const text of ['', 'FREQ=HOURLY', 'FREQ=DAILY;INTERVAL=0', 'FREQ=DAILY;INTERVAL=x', 'FREQ=MONTHLY;BYDAY=MO', 'FREQ=WEEKLY;BYDAY=XX', 'nonsense']) {
      expect(parseRule(text)).toBeNull();
    }
  });

  it('describes rules in words', () => {
    expect(describeRule(rule('FREQ=DAILY'), '2026-11-14')).toBe('Every day');
    expect(describeRule(rule('FREQ=DAILY;INTERVAL=3'), '2026-11-14')).toBe('Every 3 days');
    expect(describeRule(rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), '2026-11-14')).toBe('Every weekday');
    expect(describeRule(rule('FREQ=WEEKLY'), '2026-11-14')).toBe('Every week on Saturday');
    expect(describeRule(rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'), '2026-11-14')).toBe('Every 2 weeks on Mon, Wed');
    expect(describeRule(rule('FREQ=MONTHLY'), '2026-11-15')).toBe('Every month on the 15th');
    expect(describeRule(rule('FREQ=MONTHLY'), '2026-01-31')).toBe('Every month on the 31st (or the last day)');
    expect(describeRule(rule('FREQ=YEARLY'), '2026-11-14')).toBe('Every year on 14 November');
  });

  it('names presets', () => {
    expect(presetOf(null)).toBe('none');
    expect(presetOf(rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'))).toBe('weekdays');
    expect(presetOf(rule('FREQ=WEEKLY;BYDAY=MO,WE'))).toBe('custom');
    expect(presetOf(rule('FREQ=DAILY;INTERVAL=2'))).toBe('custom');
    expect(presetOf(rule('FREQ=MONTHLY'))).toBe('monthly');
  });
});

describe('occurrences', () => {
  it('every 3 days', () => {
    expect(occurrencesBetween('2026-11-01', rule('FREQ=DAILY;INTERVAL=3'), '2026-11-05', '2026-11-15')).toEqual(['2026-11-07', '2026-11-10', '2026-11-13']);
  });

  it('every weekday, from a Friday anchor', () => {
    expect(occurrencesBetween('2026-11-13', rule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), '2026-11-01', '2026-11-20')).toEqual([
      '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
    ]);
  });

  it('every other week on Monday, far from the anchor', () => {
    expect(occurrencesBetween('2026-01-05', rule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO'), '2026-11-01', '2026-11-30')).toEqual(['2026-11-09', '2026-11-23']);
  });

  it('every week with no days listed repeats on the anchor weekday', () => {
    expect(occurrencesBetween('2026-11-14', rule('FREQ=WEEKLY'), '2026-11-14', '2026-11-30')).toEqual(['2026-11-14', '2026-11-21', '2026-11-28']);
  });

  it('every month on the 31st uses the last day of shorter months', () => {
    expect(occurrencesBetween('2026-01-31', rule('FREQ=MONTHLY'), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
    expect(occurrencesBetween('2020-01-31', rule('FREQ=MONTHLY'), '2026-11-01', '2026-12-31')).toEqual(['2026-11-30', '2026-12-31']);
  });

  it('every year on 29 February falls on the 28th in other years', () => {
    expect(occurrencesBetween('2024-02-29', rule('FREQ=YEARLY'), '2024-01-01', '2028-12-31')).toEqual([
      '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
    ]);
  });

  it('stops at the end date and never goes before the anchor', () => {
    expect(occurrencesBetween('2026-11-10', rule('FREQ=DAILY'), '2026-11-01', '2026-11-30', '2026-11-12')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(nextOnOrAfter('2026-11-10', rule('FREQ=DAILY'), '2026-11-13', '2026-11-12')).toBeNull();
    expect(nextAfter('2026-11-14', rule('FREQ=YEARLY;INTERVAL=4'), '2026-11-14')).toBe('2030-11-14');
  });

  it('matches a simple day-by-day count for many random rules and windows', () => {
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const naive = (anchor: string, r: Rule, from: string, to: string): string[] => {
      const out: string[] = [];
      for (let d = anchor; d <= to; d = addDays(d, 1)) {
        if (d < from) continue;
        const a = parts(anchor);
        const p = parts(d);
        let hit = false;
        if (r.freq === 'daily') hit = diffDays(anchor, d) % r.interval === 0;
        if (r.freq === 'weekly') {
          const days = r.byDay?.length ? r.byDay : [weekday(anchor)];
          hit = days.includes(weekday(d) as Weekday) && (diffDays(startOfWeek(anchor), startOfWeek(d)) / 7) % r.interval === 0;
        }
        if (r.freq === 'monthly' || r.freq === 'yearly') {
          const step = r.freq === 'monthly' ? r.interval : r.interval * 12;
          const months = (p.year - a.year) * 12 + (p.month - a.month);
          hit = months % step === 0 && addMonths(anchor, months, a.day) === d;
        }
        if (hit) out.push(d);
      }
      return out;
    };
    const freqs = ['daily', 'weekly', 'monthly', 'yearly'] as const;
    for (let i = 0; i < 300; i += 1) {
      const freq = freqs[random(4)];
      const r: Rule = { freq, interval: 1 + random(freq === 'yearly' ? 2 : 4) };
      if (freq === 'weekly' && random(2)) r.byDay = [...new Set([random(7), random(7), random(7)])].sort() as Weekday[];
      const anchor = addDays('2024-01-01', random(900));
      const from = addDays(anchor, random(1200) - 200);
      const to = addDays(from, random(400));
      expect([i, occurrencesBetween(anchor, r, from, to)]).toEqual([i, naive(anchor, r, from, to)]);
    }
  });
});

describe('a series and its occurrences', () => {
  it('starts at the due date', () => {
    expect(currentOccurrence(series('2026-11-14', 'FREQ=DAILY', null, '07:00'), [])).toEqual({
      date: '2026-11-14', showDate: '2026-11-14', showTime: '07:00', moved: false,
    });
  });

  it('moves on after a completion, without losing the next ones', () => {
    const s = series('2026-11-14', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    const done = planCompletion(s, [], '2026-11-14', '2026-11-14T10:00:00Z');
    expect(done).toEqual([{ date: '2026-11-16', status: 'completed', completedAt: '2026-11-14T10:00:00Z', movedToDate: null, movedToTime: null }]);
    expect(currentOccurrence(s, done)?.date).toBe('2026-11-17');
    expect(projectedOccurrences(s, done, '2026-11-14', '2026-11-21').map((o) => o.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20']);
  });

  it('catches up after days left undone: the missed days are skipped in one go', () => {
    const s = series('2026-11-01', 'FREQ=DAILY');
    const records = planCompletion(s, [], '2026-11-14', 'x');
    expect(records).toEqual([
      { date: '2026-11-01', status: 'completed', completedAt: 'x', movedToDate: null, movedToTime: null },
      { date: '2026-11-13', status: 'skipped', movedToDate: null, movedToTime: null },
    ]);
    expect(currentOccurrence(s, records)?.date).toBe('2026-11-14');
  });

  it('does not skip anything when the task is on time', () => {
    const s = series('2026-11-14', 'FREQ=DAILY');
    expect(planCompletion(s, [], '2026-11-14', 'x')).toHaveLength(1);
  });

  it('moves one occurrence without touching the rest', () => {
    const s = series('2026-11-14', 'FREQ=WEEKLY', null, '09:00');
    const moved = planMove(s, [], '2026-11-16', '18:00')!;
    const records: OccurrenceRecord[] = [moved];
    expect(currentOccurrence(s, records)).toEqual({ date: '2026-11-14', showDate: '2026-11-16', showTime: '18:00', moved: true });
    expect(projectedOccurrences(s, records, '2026-11-14', '2026-11-30').map((o) => o.date)).toEqual(['2026-11-21', '2026-11-28']);
    const after = [...records.filter((r) => r.date !== '2026-11-14'), ...planCompletion(s, records, '2026-11-16', 'x')];
    expect(currentOccurrence(s, after)?.date).toBe('2026-11-21');
  });

  it('skips one occurrence', () => {
    const s = series('2026-11-14', 'FREQ=DAILY');
    expect(currentOccurrence(s, [planSkip(s, [])!])?.date).toBe('2026-11-15');
  });

  it('ends after its last occurrence', () => {
    const s = series('2026-11-14', 'FREQ=DAILY', '2026-11-15');
    const first = planCompletion(s, [], '2026-11-14', 'x');
    const second = [...first, ...planCompletion(s, first, '2026-11-15', 'x')];
    expect(currentOccurrence(s, second)).toBeNull();
    expect(planCompletion(s, second, '2026-11-16', 'x')).toEqual([]);
  });

  it('works out the same state whatever order two devices recorded in', () => {
    const s = series('2026-11-10', 'FREQ=DAILY');
    const a: OccurrenceRecord = { date: '2026-11-10', status: 'completed' };
    const b: OccurrenceRecord = { date: '2026-11-11', status: 'completed' };
    expect(currentOccurrence(s, [a, b])).toEqual(currentOccurrence(s, [b, a]));
  });
});
