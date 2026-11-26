import { leadText } from './TaskRow';

jest.mock('@/ui/format', () => ({ ...jest.requireActual('@/ui/format'), shortTime: (t: string) => (t === '12:30' ? '12:30 pm' : t) }));

describe('the label beside a task', () => {
  const today = '2026-11-27'; // Friday
  const at = (date: string | null, time: string | null = null) => ({ date, time });

  it('fits the column: never longer than "Yesterday"', () => {
    const dates = ['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-30', '2026-12-03', '2026-11-20', '2027-01-15', '2025-06-01'];
    const labels = dates.map((d) => leadText(at(d), today, 'date'));
    expect(labels).toEqual(['Yesterday', 'Today', 'Tomorrow', 'Mon', 'Thu', '20 Nov', '15 Jan', '1 Jun']);
    for (const l of labels) expect(l.length).toBeLessThanOrEqual('Yesterday'.length);
  });

  it('shows the time in time lists, and nothing without one', () => {
    expect(leadText(at('2026-11-27', '12:30'), today, 'time')).toBe('12:30 pm');
    expect(leadText(at('2026-11-27'), today, 'time')).toBe('');
    expect(leadText(at(null), today, 'date')).toBe('');
  });
});
