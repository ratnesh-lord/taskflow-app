import { makeTask } from './fixtures';
import {
  desiredEvents, eventDays, eventId, type GoogleTask, planCalendar, planExport, planImport, readGoogleSettings, scopesFor,
} from './google';
import type { OccurrenceRecord } from './recurrence';

const now = { date: '2026-11-23', minutes: 600 };
const window = { from: '2026-10-24', to: '2027-02-21', timeZone: 'Asia/Kolkata', now };
const data = (tasks: ReturnType<typeof makeTask>[], occ: Record<string, OccurrenceRecord[]> = {}) => ({ tasks, occurrences: new Map(Object.entries(occ)) });

describe('Google settings and permissions', () => {
  it('reads the settings, with everything off when there are none', () => {
    expect(readGoogleSettings(null)).toEqual({ calendarPush: false, calendarId: null, showEvents: false, tasksListId: null, driveFolderId: null });
    expect(readGoogleSettings({ google: { calendarPush: true, calendarId: 'c1', showEvents: 'yes', driveFolderId: '' } }))
      .toEqual({ calendarPush: true, calendarId: 'c1', showEvents: false, tasksListId: null, driveFolderId: null });
  });

  it('asks only for the permissions a feature needs, plus the account address', () => {
    expect(scopesFor('calendarWrite')).toEqual([
      'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/calendar.app.created',
    ]);
    expect(scopesFor('drive', 'drive')).toEqual(['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive.file']);
  });
});

describe('what the TaskFlow calendar should hold', () => {
  it('a timed task is an event of its estimate (30 minutes by default) in the account time zone; an untimed one is all-day', () => {
    const bill = makeTask({ title: 'Pay bill', dueDate: '2026-11-24', dueTime: '13:00' });
    const call = makeTask({ title: 'Call', dueDate: '2026-11-24', dueTime: '23:30', estimatedMinutes: 60 });
    const shop = makeTask({ title: 'Shop', dueDate: '2026-11-25', description: 'Milk' });
    const events = desiredEvents(data([bill, call, shop]), window);
    expect(events.get(eventId(bill.id))).toMatchObject({
      summary: 'Pay bill',
      start: { dateTime: '2026-11-24T13:00:00', timeZone: 'Asia/Kolkata' },
      end: { dateTime: '2026-11-24T13:30:00', timeZone: 'Asia/Kolkata' },
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { taskflow: '1', tfTask: bill.id } },
    });
    expect(events.get(eventId(call.id))!.end).toEqual({ dateTime: '2026-11-25T00:30:00', timeZone: 'Asia/Kolkata' });
    expect(events.get(eventId(shop.id))).toMatchObject({ start: { date: '2026-11-25' }, end: { date: '2026-11-26' } });
    expect(events.get(eventId(shop.id))!.description).toMatch(/^Milk\n\nAdded by TaskFlow/);
  });

  it('event ids are made of the characters Google allows, and differ per day of a repeat', () => {
    const id = eventId('4F1C2B8E-1D2E-4A3B-9C4D-5E6F7A8B9C0D');
    expect(id).toBe('4f1c2b8e1d2e4a3b9c4d5e6f7a8b9c0d');
    expect(eventId('4f1c2b8e-1d2e-4a3b-9c4d-5e6f7a8b9c0d', '2026-11-24')).toBe('4f1c2b8e1d2e4a3b9c4d5e6f7a8b9c0dd20261124');
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it('a repeating task is one event per day in the window: done days ticked, skipped days gone, moved days moved', () => {
    const t = makeTask({ title: 'Gym', dueDate: '2026-11-20', dueTime: '07:00', rrule: 'FREQ=DAILY', recurUntil: '2026-11-28' });
    const occ: OccurrenceRecord[] = [
      { date: '2026-11-20', status: 'completed', completedAt: '2026-11-20T02:00:00Z' },
      { date: '2026-11-21', status: 'skipped' },
      { date: '2026-11-22', status: 'completed', completedAt: '2026-11-22T02:00:00Z' },
      { date: '2026-11-23', status: 'skipped', movedToDate: '2026-11-24', movedToTime: '18:00' },
    ];
    const events = desiredEvents(data([t], { [t.id]: occ }), window);
    const days = [...events.values()].map((e) => `${e.summary} ${'dateTime' in e.start ? e.start.dateTime : ''}`).sort();
    expect(days).toEqual([
      'Gym 2026-11-24T07:00:00',
      'Gym 2026-11-24T18:00:00',
      'Gym 2026-11-25T07:00:00',
      'Gym 2026-11-26T07:00:00',
      'Gym 2026-11-27T07:00:00',
      'Gym 2026-11-28T07:00:00',
      '✓ Gym 2026-11-20T07:00:00',
      '✓ Gym 2026-11-22T07:00:00',
    ]);
    // The moved day keeps its own id, so moving it again changes the same event.
    expect(events.get(eventId(t.id, '2026-11-23'))!.start).toEqual({ dateTime: '2026-11-24T18:00:00', timeZone: 'Asia/Kolkata' });
  });

  it('completed tasks stay, ticked; archived, deleted, undated and out-of-window tasks are not there', () => {
    const done = makeTask({ title: 'Done', dueDate: '2026-11-22', status: 'completed', completedAt: '2026-11-22T05:00:00Z' });
    const archived = makeTask({ title: 'Archived', dueDate: '2026-11-22', status: 'archived' });
    const inbox = makeTask({ title: 'Someday', status: 'inbox' });
    const far = makeTask({ title: 'Far', dueDate: '2027-06-01' });
    const old = makeTask({ title: 'Old', dueDate: '2026-09-01' });
    const events = desiredEvents(data([done, archived, inbox, far, old]), window);
    expect([...events.values()].map((e) => e.summary)).toEqual(['✓ Done']);
  });

  it('an overdue open task stays on its own day', () => {
    const late = makeTask({ title: 'Late', dueDate: '2026-11-10' });
    expect(desiredEvents(data([late]), window).get(eventId(late.id))!.start).toEqual({ date: '2026-11-10' });
  });

  it('a push adds what is missing, changes what differs and deletes what should not be there', () => {
    const a = makeTask({ title: 'A', dueDate: '2026-11-24' });
    const b = makeTask({ title: 'B', dueDate: '2026-11-24' });
    const c = makeTask({ title: 'C', dueDate: '2026-11-24' });
    const desired = desiredEvents(data([a, b, c]), window);
    const same = desired.get(eventId(b.id))!.extendedProperties.private.tfHash;
    const plan = planCalendar(desired, [
      { id: eventId(b.id), hash: same },
      { id: eventId(c.id), hash: 'old' },
      { id: 'gone1234', hash: 'x' },
    ]);
    expect(plan.insert.map((e) => e.summary)).toEqual(['A']);
    expect(plan.update.map((e) => e.summary)).toEqual(['C']);
    expect(plan.remove).toEqual(['gone1234']);
  });

  it('nothing changed means nothing to send', () => {
    const a = makeTask({ title: 'A', dueDate: '2026-11-24', dueTime: '09:00' });
    const desired = desiredEvents(data([a]), window);
    const existing = [...desired.values()].map((e) => ({ id: e.id, hash: e.extendedProperties.private.tfHash }));
    expect(planCalendar(desiredEvents(data([a]), window), existing)).toEqual({ insert: [], update: [], remove: [] });
  });
});

describe("the person's own events", () => {
  // The phone's clock is India (UTC+05:30).
  const toLocal = (iso: string) => {
    const t = new Date(new Date(iso).getTime() + 330 * 60_000);
    return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
  };

  it('a timed event is placed in the phone time zone', () => {
    const [e] = eventDays({ id: 'e1', summary: 'Stand-up', start: { dateTime: '2026-11-24T04:30:00Z' }, end: { dateTime: '2026-11-24T04:45:00Z' } }, 'Work', toLocal);
    expect(e).toMatchObject({ key: 'e1|2026-11-24', date: '2026-11-24', start: 600, end: 615, title: 'Stand-up', calendarName: 'Work' });
  });

  it('an event past midnight shows on both days; an all-day event on each of its days', () => {
    const late = eventDays({ id: 'e2', summary: 'Flight', start: { dateTime: '2026-11-24T17:30:00Z' }, end: { dateTime: '2026-11-24T20:30:00Z' } }, 'Home', toLocal);
    expect(late.map((d) => [d.date, d.start, d.end])).toEqual([['2026-11-24', 1380, 1440], ['2026-11-25', 0, 120]]);
    const trip = eventDays({ id: 'e3', summary: 'Trip', start: { date: '2026-11-27' }, end: { date: '2026-11-30' } }, 'Home', toLocal);
    expect(trip.map((d) => [d.date, d.start])).toEqual([['2026-11-27', null], ['2026-11-28', null], ['2026-11-29', null]]);
  });

  it('cancelled events are left out; an untitled one is named', () => {
    expect(eventDays({ id: 'x', status: 'cancelled', start: { date: '2026-11-24' } }, 'Work', toLocal)).toEqual([]);
    expect(eventDays({ id: 'y', start: { date: '2026-11-24' } }, 'Work', toLocal)[0].title).toBe('(No title)');
  });
});

describe('Google Tasks', () => {
  const list: GoogleTask[] = [
    { id: 'g2', title: 'Second', position: '0002', due: '2026-11-25T00:00:00.000Z', notes: 'Bring ID' },
    { id: 'g1', title: 'First', position: '0001', status: 'completed', completed: '2026-11-20T08:00:00.000Z' },
    { id: 'g3', title: 'Child', parent: 'g2', position: '0001', status: 'completed' },
    { id: 'g4', title: 'Gone', position: '0003', deleted: true },
    { id: 'g5', title: '  ', position: '0004' },
    { id: 'g6', notes: 'Only notes\nmore', position: '0005' },
  ];

  it('imports top-level tasks in order with their date, notes, completion and subtasks', () => {
    expect(planImport(list, new Set())).toEqual([
      { googleId: 'g1', title: 'First', description: '', dueDate: null, completedAt: '2026-11-20T08:00:00.000Z', subtasks: [] },
      { googleId: 'g2', title: 'Second', description: 'Bring ID', dueDate: '2026-11-25', completedAt: null, subtasks: [{ title: 'Child', done: true }] },
      { googleId: 'g6', title: 'Only notes', description: 'Only notes\nmore', dueDate: null, completedAt: null, subtasks: [] },
    ]);
  });

  it('importing again skips what was already imported', () => {
    expect(planImport(list, new Set(['g1', 'g2', 'g6']))).toEqual([]);
  });

  it('copies open tasks and tasks completed since the last copy, not tasks that came from Google', () => {
    const open = makeTask({ title: 'Open', dueDate: '2026-11-24', description: 'n' });
    const undated = makeTask({ title: 'Undated', status: 'inbox' });
    const doneCopied = makeTask({ title: 'Done copied', status: 'completed', completedAt: '2026-11-22T05:00:00Z' });
    const doneNever = makeTask({ title: 'Done never', status: 'completed', completedAt: '2026-11-22T05:00:00Z' });
    const fromGoogle = makeTask({ title: 'From Google' });
    const items = planExport(data([open, undated, doneCopied, doneNever, fromGoogle]), now, new Set([fromGoogle.id]), new Set([doneCopied.id]));
    expect(items.map((i) => [i.body.title, i.body.status, i.body.due ?? null])).toEqual([
      ['Open', 'needsAction', '2026-11-24T00:00:00.000Z'],
      ['Undated', 'needsAction', null],
      ['Done copied', 'completed', null],
    ]);
  });
});

describe('pictures in Google Calendar', () => {
  it("an event's title starts with the task's emoji, after the tick when done", () => {
    const open = makeTask({ title: 'Birthday', dueDate: '2026-11-24', icon: 'e:🎂' });
    const done = makeTask({ title: 'Gym', dueDate: '2026-11-22', icon: 'c:dumbbell', status: 'completed', completedAt: '2026-11-22T05:00:00Z' });
    const events = desiredEvents(data([open, done]), window);
    expect(events.get(eventId(open.id))!.summary).toBe('🎂 Birthday');
    expect(events.get(eventId(done.id))!.summary).toBe('✓ 🏋️ Gym');
  });
});
