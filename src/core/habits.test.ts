import { isEmoji } from './appearance';
import {
  HABIT_EMOJI, completionRate, dayState, describeSchedule, formatSchedule, habitToday, type HabitLogRecord, type HabitRecord, isScheduleText,
  lastLoggedAt, lastSevenDays, parseSchedule, progressWords, reminderDays, sinceWords, streakOf, amountsByDate,
} from './habits';

// Wednesday 25 November 2026.
const today = '2026-11-25';

let n = 0;
const log = (date: string, amount = 1, habitId = 'h1'): HabitLogRecord => {
  n += 1;
  return { id: `log-${n}`, habitId, date, amount, loggedAt: `${date}T08:${String(n % 60).padStart(2, '0')}:00Z` };
};

const habit = (over: Partial<HabitRecord> = {}): HabitRecord => ({
  id: 'h1', title: 'Drink water', icon: 'e:💧', color: null, schedule: 'daily', target: 1, unit: '', reminderTime: null,
  status: 'active', sortOrder: 0, createdAt: '2026-11-01T00:00:00Z', ...over,
});

describe('schedules', () => {
  it('reads, writes and describes each kind', () => {
    expect(parseSchedule('daily')).toEqual({ kind: 'daily' });
    expect(parseSchedule('days:5,1,3')).toEqual({ kind: 'days', days: [1, 3, 5] });
    expect(parseSchedule('week:3')).toEqual({ kind: 'week', times: 3 });
    expect(parseSchedule('days:0,1,2,3,4,5,6')).toEqual({ kind: 'daily' });
    expect(parseSchedule('nonsense')).toEqual({ kind: 'daily' });
    expect(parseSchedule(null)).toEqual({ kind: 'daily' });

    expect(formatSchedule({ kind: 'days', days: [5, 1, 3, 3] })).toBe('days:1,3,5');
    expect(formatSchedule({ kind: 'days', days: [] })).toBe('daily');
    expect(formatSchedule({ kind: 'week', times: 9 })).toBe('week:7');
    for (const text of ['daily', 'days:1,3,5', 'week:3']) expect(formatSchedule(parseSchedule(text))).toBe(text);

    expect(describeSchedule(parseSchedule('daily'))).toBe('Every day');
    expect(describeSchedule(parseSchedule('days:1,2,3,4,5'))).toBe('Weekdays');
    expect(describeSchedule(parseSchedule('days:0,6'))).toBe('Weekends');
    expect(describeSchedule(parseSchedule('days:0,1,3'))).toBe('Mon, Wed, Sun');
    expect(describeSchedule(parseSchedule('week:1'))).toBe('Once a week');
    expect(describeSchedule(parseSchedule('week:3'))).toBe('3 days a week');
  });

  it('accepts exactly what the database accepts', () => {
    for (const ok of ['daily', 'days:1,3,5', 'week:3', 'days:0']) expect(isScheduleText(ok)).toBe(true);
    for (const bad of ['weekly', 'days:7', 'week:0', 'week:8', 'days:', '']) expect(isScheduleText(bad)).toBe(false);
  });
});

describe('a day', () => {
  it('is done at the target, partial below it, missed when a scheduled day passed empty', () => {
    const h = habit({ target: 8 });
    const amounts = amountsByDate([log('2026-11-25', 3), log('2026-11-25', 5), log('2026-11-24', 2)]);
    expect(dayState(h, amounts, '2026-11-25', today)).toBe('done');
    expect(dayState(h, amounts, '2026-11-24', today)).toBe('partial');
    expect(dayState(h, amounts, '2026-11-23', today)).toBe('missed');
    expect(dayState(h, amounts, '2026-11-26', today)).toBe('future');
    expect(dayState(h, new Map(), today, today)).toBe('open');
  });

  it('a rest day of a "Mon, Wed, Fri" habit is not missed; nor is any day of an "N days a week" one', () => {
    expect(dayState(habit({ schedule: 'days:1,3,5' }), new Map(), '2026-11-24', today)).toBe('rest');
    expect(dayState(habit({ schedule: 'days:1,3,5' }), new Map(), '2026-11-23', today)).toBe('missed');
    expect(dayState(habit({ schedule: 'week:3' }), new Map(), '2026-11-23', today)).toBe('rest');
  });
});

describe('streaks', () => {
  it('counts done days in a row; today not yet done does not break it', () => {
    const logs = ['2026-11-20', '2026-11-22', '2026-11-23', '2026-11-24'].map((d) => log(d));
    expect(streakOf(habit(), logs, today)).toEqual({ current: 3, best: 3, unit: 'day' });
    expect(streakOf(habit(), [...logs, log(today)], today)).toEqual({ current: 4, best: 4, unit: 'day' });
  });

  it('a missed day yesterday ends the current streak but not the best', () => {
    const logs = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-25'].map((d) => log(d));
    expect(streakOf(habit(), logs, today)).toEqual({ current: 1, best: 4, unit: 'day' });
  });

  it('skips rest days', () => {
    // Mon 16, Wed 18, Fri 20, Mon 23 done; today (Wed 25) not yet.
    const logs = ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23'].map((d) => log(d));
    expect(streakOf(habit({ schedule: 'days:1,3,5' }), logs, today).current).toBe(4);
  });

  it('needs the full target', () => {
    const logs = [log('2026-11-24', 7), log('2026-11-23', 8)];
    expect(streakOf(habit({ target: 8 }), logs, today).current).toBe(0);
    expect(streakOf(habit({ target: 8 }), logs, today).best).toBe(1);
  });

  it('counts weeks for an "N days a week" habit, this week still in progress', () => {
    // Weeks from Monday 9, 16, 23 November. Two days each in the first two; one so far this week.
    const logs = ['2026-11-09', '2026-11-11', '2026-11-17', '2026-11-19', '2026-11-24'].map((d) => log(d));
    expect(streakOf(habit({ schedule: 'week:2' }), logs, today)).toEqual({ current: 2, best: 2, unit: 'week' });
    expect(streakOf(habit({ schedule: 'week:2' }), [...logs, log(today)], today).current).toBe(3);
  });

  it('is zero with no logs', () => {
    expect(streakOf(habit(), [], today)).toEqual({ current: 0, best: 0, unit: 'day' });
  });
});

describe('completion rate', () => {
  it('counts scheduled days from creation, leaving today out until it is done', () => {
    const logs = ['2026-11-20', '2026-11-22', '2026-11-24'].map((d) => log(d));
    // Created on the 20th: 20–24 is five days, three done; today is not over.
    expect(completionRate(habit(), logs, '2026-11-01', today, today, '2026-11-20')).toEqual({ done: 3, total: 5, percent: 60 });
    expect(completionRate(habit(), [...logs, log(today)], '2026-11-01', today, today, '2026-11-20')).toEqual({ done: 4, total: 6, percent: 67 });
    expect(completionRate(habit(), [], today, today, today, today).percent).toBeNull();
  });

  it('counts weeks for "N days a week"', () => {
    const logs = ['2026-11-09', '2026-11-11', '2026-11-17'].map((d) => log(d));
    // Weeks of 9 and 16 Nov are over (one met, one not); this week is neither.
    expect(completionRate(habit({ schedule: 'week:2' }), logs, '2026-11-09', today, today, '2026-11-01')).toEqual({ done: 1, total: 2, percent: 50 });
  });
});

describe('today', () => {
  it('reports the count, whether it is due, and the week for "N days a week"', () => {
    expect(habitToday(habit({ target: 8 }), [log(today, 3)], today)).toEqual({ count: 3, target: 8, done: false, due: true, week: null });
    expect(habitToday(habit({ schedule: 'days:1' }), [], today).due).toBe(false);
    const weekly = habitToday(habit({ schedule: 'week:2' }), [log('2026-11-23'), log('2026-11-24')], today);
    expect(weekly).toEqual({ count: 0, target: 1, done: false, due: false, week: { done: 2, wanted: 2 } });
    expect(progressWords(habitToday(habit({ target: 8 }), [log(today, 3)], today), 'glasses')).toBe('3 of 8 glasses');
    expect(progressWords(habitToday(habit(), [log(today)], today), '')).toBe('Done today');
  });

  it('shows the last seven days oldest first', () => {
    const days = lastSevenDays(habit(), [log('2026-11-24'), log('2026-11-19')], today);
    expect(days.map((d) => d.date)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']);
    expect(days.map((d) => d.state)).toEqual(['done', 'missed', 'missed', 'missed', 'missed', 'done', 'open']);
    // Created on the 23rd: the days before it are not missed.
    expect(lastSevenDays(habit(), [log('2026-11-24')], today, '2026-11-23').map((d) => d.state))
      .toEqual(['before', 'before', 'before', 'before', 'missed', 'done', 'open']);
  });

  it('says how long since it was last done', () => {
    const now = Date.parse('2026-11-25T12:00:00Z');
    expect(lastLoggedAt([])).toBeNull();
    expect(lastLoggedAt([{ ...log(today), loggedAt: '2026-11-25T09:00:00Z' }, { ...log(today), loggedAt: '2026-11-25T11:00:00Z' }])).toBe('2026-11-25T11:00:00Z');
    expect(sinceWords('2026-11-25T11:59:30Z', now)).toBe('Just now');
    expect(sinceWords('2026-11-25T11:35:00Z', now)).toBe('25 min ago');
    expect(sinceWords('2026-11-25T00:00:00Z', now)).toBe('12 h ago');
    expect(sinceWords('2026-11-22T12:00:00Z', now)).toBe('3 days ago');
    expect(sinceWords(null, now)).toBeNull();
  });
});

describe('reminder days', () => {
  it('rings on scheduled days still to do, not on rest days or once done', () => {
    const h = habit({ reminderTime: '10:00', schedule: 'days:1,3,5' });
    expect(reminderDays(h, [], today, 7)).toEqual(['2026-11-25', '2026-11-27', '2026-11-30']);
    expect(reminderDays(h, [log(today)], today, 7)).toEqual(['2026-11-27', '2026-11-30']);
  });

  it('stops for the rest of the week once an "N days a week" habit is met', () => {
    const h = habit({ reminderTime: '10:00', schedule: 'week:2' });
    expect(reminderDays(h, [log('2026-11-23'), log('2026-11-24')], today, 7)).toEqual(['2026-11-30', '2026-12-01']);
  });

  it('nothing without a time, or for an archived habit', () => {
    expect(reminderDays(habit(), [], today, 7)).toEqual([]);
    expect(reminderDays(habit({ reminderTime: '10:00', status: 'archived' }), [], today, 7)).toEqual([]);
  });
});

describe('habit pictures', () => {
  it('every suggested picture is a single emoji the app accepts', () => {
    for (const e of HABIT_EMOJI) expect([e, isEmoji(e)]).toEqual([e, true]);
    expect(new Set(HABIT_EMOJI).size).toBe(HABIT_EMOJI.length);
  });
});
