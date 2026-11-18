import {
  addDays, addMonths, dayLabel, diffDays, formatTime, isLocalDate, longDate, normaliseTime, nowFrom,
  shortDate, startOfWeek, timeToMinutes, weekday,
} from './dates';

describe('dates', () => {
  it('validates dates, including leap days', () => {
    expect(isLocalDate('2026-11-14')).toBe(true);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('14/11/2026')).toBe(false);
  });

  it('adds days across months, years and daylight-saving changes', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2026-11-14', '2026-12-25')).toBe(41);
  });

  it('adds months, falling back to the last day of a short month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('knows weekdays and the Monday a week starts on', () => {
    expect(weekday('2026-11-14')).toBe(6);
    expect(startOfWeek('2026-11-14')).toBe('2026-11-09');
    expect(startOfWeek('2026-11-09')).toBe('2026-11-09');
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09');
  });

  it('reads times in several forms', () => {
    expect(timeToMinutes('19:00')).toBe(1140);
    expect(timeToMinutes('7:05')).toBe(425);
    expect(timeToMinutes('07:05:00')).toBe(425);
    expect(timeToMinutes('24:00')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
    expect(normaliseTime('7:5')).toBeNull();
    expect(normaliseTime('19:30:00')).toBe('19:30');
  });

  it('takes the date and minute from a moment in the phone time zone', () => {
    expect(nowFrom(new Date(2026, 10, 14, 13, 30))).toEqual({ date: '2026-11-14', minutes: 810 });
  });

  it('labels days the way people say them', () => {
    expect(dayLabel('2026-11-14', '2026-11-14')).toBe('Today');
    expect(dayLabel('2026-11-15', '2026-11-14')).toBe('Tomorrow');
    expect(dayLabel('2026-11-13', '2026-11-14')).toBe('Yesterday');
    expect(dayLabel('2026-11-18', '2026-11-14')).toBe('Wednesday');
    expect(dayLabel('2026-11-21', '2026-11-14')).toBe('Sat 21 Nov');
    expect(shortDate('2027-01-02', '2026-11-14')).toBe('Sat 2 Jan 2027');
    expect(longDate('2026-11-14')).toBe('Saturday 14 November');
  });

  it('formats times in 24-hour or 12-hour style', () => {
    expect(formatTime('19:00', false)).toBe('19:00');
    expect(formatTime('19:00', true)).toBe('7:00 pm');
    expect(formatTime('00:15', true)).toBe('12:15 am');
    expect(formatTime('12:00', true)).toBe('12:00 pm');
  });
});
