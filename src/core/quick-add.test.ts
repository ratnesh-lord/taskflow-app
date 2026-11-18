import { parseQuickAdd, type QuickAdd } from './quick-add';

// Saturday 14 November 2026, 10:00.
const ctx = { today: '2026-11-14', nowMinutes: 600 };
const parse = (text: string, ignore?: string[]) => parseQuickAdd(text, { ...ctx, ignore });

function expectTask(text: string, expected: Partial<QuickAdd>) {
  const got = parse(text);
  const subset = Object.fromEntries(Object.keys(expected).map((k) => [k, got[k as keyof QuickAdd]]));
  expect({ text, ...subset }).toEqual({ text, ...expected });
}

describe('quick add', () => {
  it('reads the example from the brief', () => {
    const r = parse('Complete AWS certification revision tomorrow at 7 PM and remind me 30 minutes before');
    expect(r).toMatchObject({
      title: 'Complete AWS certification revision',
      dueDate: '2026-11-15',
      dueTime: '19:00',
      rrule: null,
      reminders: [{ kind: 'before_due', offsetMinutes: 30 }],
    });
    expect(r.pieces.map((p) => [p.kind, p.text])).toEqual([
      ['date', 'tomorrow'],
      ['time', 'at 7 PM'],
      ['reminder', 'and remind me 30 minutes before'],
    ]);
  });

  it('leaves plain titles alone', () => {
    expectTask('Buy milk', { title: 'Buy milk', dueDate: null, dueTime: null, rrule: null, reminders: [], priority: null });
    expectTask('Write weekly report', { title: 'Write weekly report', rrule: null });
    expectTask('Fix critical bug', { title: 'Fix critical bug', priority: null });
    expectTask('Read chapters 1-2', { title: 'Read chapters 1-2', dueDate: null });
    expectTask('Call tom', { title: 'Call tom', dueDate: null });
    expectTask('Buy 3 apples', { title: 'Buy 3 apples', dueTime: null });
    expectTask('Book table for 4 people at 8', { title: 'Book table for 4 people', dueTime: '08:00' });
  });

  it('reads relative days', () => {
    expectTask('Pay bills today', { title: 'Pay bills', dueDate: '2026-11-14', dueTime: null });
    expectTask('Pay bills tonight', { title: 'Pay bills', dueDate: '2026-11-14', dueTime: '20:00' });
    expectTask('Visit bank day after tomorrow', { title: 'Visit bank', dueDate: '2026-11-16' });
    expectTask('Prepare slides in 3 days', { title: 'Prepare slides', dueDate: '2026-11-17' });
    expectTask('Service car in 2 weeks', { title: 'Service car', dueDate: '2026-11-28' });
    expectTask('Renew domain in a month', { title: 'Renew domain', dueDate: '2026-12-14' });
    expectTask('Plan trip next week', { title: 'Plan trip', dueDate: '2026-11-16' });
    expectTask('Clean garage this weekend', { title: 'Clean garage', dueDate: '2026-11-14' });
    expectTask('Budget review next month', { title: 'Budget review', dueDate: '2026-12-01' });
  });

  it('reads weekdays as the coming one, never today', () => {
    expectTask('Submit report friday', { title: 'Submit report', dueDate: '2026-11-20' });
    expectTask('Submit report on fri', { title: 'Submit report', dueDate: '2026-11-20' });
    expectTask('Laundry saturday', { title: 'Laundry', dueDate: '2026-11-21' });
    expectTask('Call dad next Monday', { title: 'Call dad', dueDate: '2026-11-16' });
  });

  it('reads calendar dates, day first', () => {
    expectTask('Doctor 15 nov 10:30', { title: 'Doctor', dueDate: '2026-11-15', dueTime: '10:30' });
    expectTask('Doctor on Nov 20th', { title: 'Doctor', dueDate: '2026-11-20' });
    expectTask('Dentist on 2 jan', { title: 'Dentist', dueDate: '2027-01-02' });
    expectTask('Tax return 31 July 2027', { title: 'Tax return', dueDate: '2027-07-31' });
    expectTask('Renew passport 20/12', { title: 'Renew passport', dueDate: '2026-12-20' });
    expectTask('Renew licence 13/05/2027', { title: 'Renew licence', dueDate: '2027-05-13' });
    expectTask('Party 2026-12-01 7:30 pm', { title: 'Party', dueDate: '2026-12-01', dueTime: '19:30' });
    expectTask('Exam on the 20th', { title: 'Exam', dueDate: '2026-11-20' });
    expectTask('Leap 30 feb', { title: 'Leap 30 feb', dueDate: null });
  });

  it('reads times, and moves a time already gone to tomorrow', () => {
    expectTask('Call mom tomorrow at 6', { title: 'Call mom', dueDate: '2026-11-15', dueTime: '18:00' });
    expectTask('Lunch at noon', { title: 'Lunch', dueDate: '2026-11-14', dueTime: '12:00' });
    expectTask('Breakfast at 8', { title: 'Breakfast', dueDate: '2026-11-15', dueTime: '08:00' });
    expectTask('Standup 9:45am', { title: 'Standup', dueDate: '2026-11-15', dueTime: '09:45' });
    expectTask('Meeting at 14:30', { title: 'Meeting', dueDate: '2026-11-14', dueTime: '14:30' });
    expectTask('Check oven in 45 minutes', { title: 'Check oven', dueDate: '2026-11-14', dueTime: '10:45' });
    expectTask('Review notes in the evening', { title: 'Review notes', dueDate: '2026-11-14', dueTime: '18:00' });
  });

  it('reads repeats and starts them at their first occurrence', () => {
    expectTask('Water plants every morning', { title: 'Water plants', rrule: 'FREQ=DAILY', dueTime: '09:00', dueDate: '2026-11-15' });
    expectTask('Team standup every weekday at 9:30am', {
      title: 'Team standup', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', dueTime: '09:30', dueDate: '2026-11-16',
    });
    expectTask('Gym every mon, wed and fri at 7', { title: 'Gym', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', dueTime: '07:00', dueDate: '2026-11-16' });
    expectTask('Backup every 3 days', { title: 'Backup', rrule: 'FREQ=DAILY;INTERVAL=3', dueDate: '2026-11-14' });
    expectTask('Pay credit card every 5th at 10am', { title: 'Pay credit card', rrule: 'FREQ=MONTHLY', dueDate: '2026-12-05', dueTime: '10:00' });
    expectTask('Sync every other week', { title: 'Sync', rrule: 'FREQ=WEEKLY;INTERVAL=2' });
    expectTask('Clean the house weekly', { title: 'Clean the house', rrule: 'FREQ=WEEKLY' });
    expectTask('Meditate daily at 6am', { title: 'Meditate', rrule: 'FREQ=DAILY', dueTime: '06:00', dueDate: '2026-11-15' });
    expectTask('Renew insurance every year on 3 March', { title: 'Renew insurance', rrule: 'FREQ=YEARLY', dueDate: '2027-03-03' });
    expectTask('Report every saturday', { title: 'Report', rrule: 'FREQ=WEEKLY;BYDAY=SA', dueDate: '2026-11-14' });
  });

  it('reads reminders', () => {
    expectTask('Flight tomorrow 6am remind me 2 hours before', {
      title: 'Flight', dueDate: '2026-11-15', dueTime: '06:00', reminders: [{ kind: 'before_due', offsetMinutes: 120 }],
    });
    expectTask('Exam friday remind me 1 day before', { title: 'Exam', reminders: [{ kind: 'before_due', offsetMinutes: 1440 }] });
    expectTask('Submit form tomorrow remind me at 8am', {
      title: 'Submit form', dueDate: '2026-11-15', reminders: [{ kind: 'absolute', date: '2026-11-15', time: '08:00' }],
    });
    expectTask('remind me to call the bank at 3pm', {
      title: 'call the bank', dueDate: '2026-11-14', dueTime: '15:00', reminders: [{ kind: 'before_due', offsetMinutes: 0 }],
    });
    expectTask('Stretch, remind me in half an hour', { title: 'Stretch', dueTime: '10:30', reminders: [{ kind: 'before_due', offsetMinutes: 0 }] });
  });

  it('reads priority, tags, project and estimate', () => {
    expectTask('Submit report by friday 5pm p1 #work @office', {
      title: 'Submit report', dueDate: '2026-11-20', dueTime: '17:00', priority: 'critical', tags: ['work'], project: 'office',
    });
    expectTask('Exam prep !2 #exam #aws', { title: 'Exam prep', priority: 'high', tags: ['exam', 'aws'] });
    expectTask('Tidy desk low priority', { title: 'Tidy desk', priority: 'low' });
    expectTask('Taxes priority: urgent', { title: 'Taxes', priority: 'critical' });
    expectTask('Study for the exam #study !high', { title: 'Study for the exam', priority: 'high', tags: ['study'] });
    expectTask('Call mum !urgent', { title: 'Call mum', priority: 'critical' });
    expectTask('Wow that was great!', { title: 'Wow that was great!', priority: null });
    expectTask('Prepare slides for 2 hours', { title: 'Prepare slides', estimatedMinutes: 120 });
    expectTask('Read for 45 min', { title: 'Read', estimatedMinutes: 45 });
    expectTask('Issue #42', { title: 'Issue #42', tags: [] });
  });

  it('keeps words the user tapped to keep', () => {
    expect(parse('Meet Monday team', ['Monday'])).toMatchObject({ title: 'Meet Monday team', dueDate: null });
    expect(parse('Write report weekly', ['weekly'])).toMatchObject({ title: 'Write report weekly', rrule: null });
  });

  it('can leave nothing for the title', () => {
    expect(parse('tomorrow at 7pm')).toMatchObject({ title: '', dueDate: '2026-11-15', dueTime: '19:00' });
  });
});
