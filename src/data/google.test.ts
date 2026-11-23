import { randomUUID } from 'node:crypto';

import { readGoogleSettings, SCOPES, scopesFor } from '@/core/google';

import { Actions } from './actions';
import { GoogleClient, GoogleService, NotConnected } from './google';
import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { FakeGoogle } from './testing/fake-google';
import { openNodeDb } from './testing/node-db';

const USER = '00000000-0000-4000-8000-000000000001';
const DEVICE = '00000000-0000-4000-8000-0000000000d1';
const moment = new Date('2026-11-23T04:30:00Z'); // 10:00 in India

async function setup(opts: { approve?: boolean } = {}) {
  const now = () => moment;
  const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now });
  await store.applyRemote({ profiles: [{ id: USER, timezone: 'Asia/Kolkata', settings: {}, rev: 1 }] });
  const actions = new Actions(store, { newId: randomUUID, now });
  const google = new FakeGoogle();
  const tokens = google.tokenSource({ approve: opts.approve ?? true });
  const client = new GoogleClient(tokens, google.http, undefined, async () => {});
  const toLocal = (iso: string) => {
    const t = new Date(new Date(iso).getTime() + 330 * 60_000);
    return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
  };
  const service = new GoogleService(client, actions, { userId: USER, timeZone: () => 'Asia/Kolkata', now: () => ({ date: '2026-11-23', minutes: 600 }), toLocal });
  const snap = () => loadSnapshot(store);
  const settings = async () => readGoogleSettings((await snap()).profile?.settings);
  return { store, actions, google, tokens, service, snap, settings };
}

describe('connecting', () => {
  it('asks Google once, then gets tokens without asking; nothing happens without consent', async () => {
    const { service, google, tokens } = await setup();
    await expect(service.connect(['calendarWrite'], false)).rejects.toBeInstanceOf(NotConnected);
    expect(await service.connect(['calendarWrite'], true)).toBe('person@example.com');
    expect([...google.granted].sort()).toEqual(scopesFor('calendarWrite').sort());
    expect(await service.connect(['calendarWrite'], false)).toBe('person@example.com');
    expect(tokens.issued).toBe(1);
  });

  it('a cancelled consent screen leaves TaskFlow without access', async () => {
    const { service } = await setup({ approve: false });
    await expect(service.connect(['tasks'], true)).rejects.toBeInstanceOf(NotConnected);
  });

  it('an expired token is dropped and a fresh one used, once', async () => {
    const { service, google, tokens } = await setup();
    await service.connect(['calendarWrite'], true);
    google.expire('tok-1');
    expect(await service.connect(['calendarWrite'], false)).toBe('person@example.com');
    expect(tokens.forgotten).toEqual(['tok-1']);
    expect(tokens.issued).toBe(2);
  });

  it('when Google is busy it waits and tries once more', async () => {
    const { service, google } = await setup();
    await service.connect(['tasks'], true);
    google.failNext = [503];
    expect(await service.taskLists()).toEqual([]);
    google.failNext = [503, 503];
    await expect(service.taskLists()).rejects.toThrow('Google: The service is currently unavailable.');
  });
});

describe('tasks into the TaskFlow calendar', () => {
  it('creates the calendar once, sends the tasks, then only what changed', async () => {
    const { service, actions, google, snap, settings } = await setup();
    await service.connect(['calendarWrite'], true);
    const bill = (await actions.createTask({ title: 'Pay bill', dueDate: '2026-11-24', dueTime: '13:00' })).id;
    const gym = (await actions.createTask({ title: 'Gym', dueDate: '2026-11-23', dueTime: '07:00', rrule: 'FREQ=DAILY', recurUntil: '2026-11-26' })).id;

    const first = await service.pushCalendar(await snap(), await settings());
    expect(first).toMatchObject({ added: 5, changed: 0, removed: 0 });
    expect((await settings()).calendarId).toBe(first.calendarId);
    const cal = google.calendars.get(first.calendarId)!;
    expect(cal.summary).toBe('TaskFlow');
    expect([...cal.events.values()].map((e) => e.summary).sort()).toEqual(['Gym', 'Gym', 'Gym', 'Gym', 'Pay bill']);

    // Nothing changed: nothing is sent.
    expect(await service.pushCalendar(await snap(), await settings())).toMatchObject({ added: 0, changed: 0, removed: 0 });

    await actions.updateTask(bill, { title: 'Pay electricity bill', dueTime: '14:00' });
    await actions.complete([gym]);
    await actions.skipOccurrence(gym);
    const third = await service.pushCalendar(await snap(), await settings());
    expect(third).toMatchObject({ added: 0, changed: 2, removed: 1 });
    const live = [...cal.events.values()].filter((e) => e.status !== 'cancelled');
    expect(live.map((e) => `${e.summary} ${(e.start as { dateTime: string }).dateTime}`).sort()).toEqual([
      'Gym 2026-11-25T07:00:00', 'Gym 2026-11-26T07:00:00', 'Pay electricity bill 2026-11-24T14:00:00', '✓ Gym 2026-11-23T07:00:00',
    ]);

    await actions.deleteTasks([bill]);
    expect(await service.pushCalendar(await snap(), await settings())).toMatchObject({ removed: 1 });
  });

  it('a deleted task that comes back (Undo) reuses its event, though Google keeps the deleted id', async () => {
    const { service, actions, google, snap, settings } = await setup();
    await service.connect(['calendarWrite'], true);
    const id = (await actions.createTask({ title: 'Dentist', dueDate: '2026-11-25', dueTime: '10:00' })).id;
    const { calendarId } = await service.pushCalendar(await snap(), await settings());
    const undo = await actions.deleteTasks([id]);
    await service.pushCalendar(await snap(), await settings());
    expect(google.calendars.get(calendarId)!.events.size).toBe(1);
    await actions.undo(undo);
    expect(await service.pushCalendar(await snap(), await settings())).toMatchObject({ added: 1 });
    const events = [...google.calendars.get(calendarId)!.events.values()];
    expect(events.map((e) => [e.summary, e.status])).toEqual([['Dentist', 'confirmed']]);
  });

  it('two devices sending the same tasks make one event per task', async () => {
    const a = await setup();
    await a.service.connect(['calendarWrite'], true);
    await a.actions.createTask({ title: 'Report', dueDate: '2026-11-26' });
    const { calendarId } = await a.service.pushCalendar(await a.snap(), await a.settings());
    // The second device has the same task but has not yet seen what the first one sent.
    const desired = await a.snap();
    const b = new GoogleService(new GoogleClient(a.google.tokenSource(), a.google.http, undefined, async () => {}), a.actions, {
      userId: USER, timeZone: () => 'Asia/Kolkata', now: () => ({ date: '2026-11-23', minutes: 600 }), toLocal: () => ({ date: '2026-11-23', minutes: 0 }),
    });
    const cal = a.google.calendars.get(calendarId)!;
    const [only] = [...cal.events.keys()];
    cal.events.get(only)!.extendedProperties = { private: { taskflow: '1', tfTask: 'x', tfHash: 'stale' } };
    await b.pushCalendar(desired, await a.settings());
    expect(cal.events.size).toBe(1);
  });

  it('events older than 30 days are left as they are', async () => {
    const { service, actions, google, snap, settings } = await setup();
    await service.connect(['calendarWrite'], true);
    await actions.createTask({ title: 'Report', dueDate: '2026-11-26' });
    const { calendarId } = await service.pushCalendar(await snap(), await settings());
    const cal = google.calendars.get(calendarId)!;
    cal.events.set('oldevent1', { id: 'oldevent1', summary: '✓ Old', status: 'confirmed', start: { date: '2026-09-01' }, extendedProperties: { private: { taskflow: '1', tfHash: 'h' } } });
    expect(await service.pushCalendar(await snap(), await settings())).toMatchObject({ removed: 0 });
    expect(cal.events.get('oldevent1')!.status).toBe('confirmed');
  });

  it('if the person deleted the TaskFlow calendar, a new one is made', async () => {
    const { service, actions, google, snap, settings } = await setup();
    await service.connect(['calendarWrite'], true);
    await actions.createTask({ title: 'Report', dueDate: '2026-11-26' });
    const first = await service.pushCalendar(await snap(), await settings());
    google.calendars.delete(first.calendarId);
    const second = await service.pushCalendar(await snap(), await settings());
    expect(second.calendarId).not.toBe(first.calendarId);
    expect(second.added).toBe(1);
  });

  it('without access the push stops with a clear message', async () => {
    const { service, snap, settings } = await setup();
    await expect(service.pushCalendar(await snap(), await settings())).rejects.toThrow('Connect it in More → Google');
  });
});

describe('Google events in the calendar views', () => {
  it("lists the person's shown calendars, not hidden ones and not the TaskFlow calendar, in the phone's time zone", async () => {
    const { service, google } = await setup();
    await service.connect(['calendarRead'], true);
    const primary = google.calendars.get('primary@example.com')!;
    primary.events.set('m1', { id: 'm1', summary: 'Stand-up', start: { dateTime: '2026-11-24T04:30:00Z' }, end: { dateTime: '2026-11-24T04:45:00Z' } });
    primary.events.set('m2', { id: 'm2', summary: 'Holiday', start: { date: '2026-11-25' }, end: { date: '2026-11-26' } });
    primary.events.set('m3', { id: 'm3', summary: 'Old', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } });
    google.calendars.set('hidden', { id: 'hidden', summary: 'Hidden', owner: 'person', selected: false, events: new Map([['h1', { id: 'h1', summary: 'Secret', start: { date: '2026-11-24' } }]]) });
    google.calendars.set('tf', { id: 'tf', summary: 'TaskFlow', owner: 'app', events: new Map([['t1', { id: 't1', summary: 'A task', start: { date: '2026-11-24' } }]]) });
    const events = await service.events('2026-11-23', '2026-11-29', { calendarPush: true, calendarId: 'tf', showEvents: true, tasksListId: null, driveFolderId: null });
    expect(events.map((e) => [e.title, e.date, e.start, e.calendarName])).toEqual([
      ['Stand-up', '2026-11-24', 600, 'person@example.com'],
      ['Holiday', '2026-11-25', null, 'person@example.com'],
    ]);
  });

  it('reading events needs its own permission', async () => {
    const { service } = await setup();
    await service.connect(['calendarWrite'], true);
    await expect(service.events('2026-11-23', '2026-11-29', readGoogleSettings(null))).rejects.toBeInstanceOf(NotConnected);
    expect(SCOPES.calendarRead).toHaveLength(2);
  });
});

describe('Google Tasks', () => {
  it('imports the first list into the Inbox and other lists as projects, with subtasks; a second import adds only new tasks', async () => {
    const { service, google, snap } = await setup();
    await service.connect(['tasks'], true);
    google.taskLists = [
      { id: 'L-my', title: 'My Tasks', tasks: [
        { id: 'a', title: 'Renew passport', due: '2026-11-30T00:00:00.000Z', notes: 'Photos', position: '1' },
        { id: 'b', title: 'Old', status: 'completed', completed: '2026-11-01T10:00:00.000Z', position: '2' },
      ] },
      { id: 'L-work', title: 'Work', tasks: [
        { id: 'c', title: 'Quarterly report', position: '1' },
        { id: 'd', title: 'Collect numbers', parent: 'c', position: '1' },
        ...Array.from({ length: 120 }, (_, i) => ({ id: `w${i}`, title: `Item ${i}`, position: String(100 + i) })),
      ] },
    ];
    const lists = await service.taskLists();
    const first = await service.importTasks(lists, lists, await snap());
    expect(first).toEqual({ lists: 2, tasks: 123 });
    const s = await snap();
    const byTitle = (t: string) => s.tasks.find((x) => x.title === t)!;
    expect(byTitle('Renew passport')).toMatchObject({ projectId: null, dueDate: '2026-11-30', description: 'Photos', status: 'not_started' });
    expect(byTitle('Old')).toMatchObject({ status: 'completed', completedAt: '2026-11-01T10:00:00.000Z' });
    const work = s.projects.find((p) => p.name === 'Work')!;
    expect(byTitle('Quarterly report').projectId).toBe(work.id);
    expect(s.subtasks.get(byTitle('Quarterly report').id)!.map((x) => x.title)).toEqual(['Collect numbers']);
    expect(s.tasks.some((t) => t.title === 'Collect numbers')).toBe(false);

    google.taskLists[1].tasks.push({ id: 'e', title: 'New one', position: '999' });
    expect(await service.importTasks(lists, lists, await snap())).toEqual({ lists: 2, tasks: 1 });
    expect((await snap()).projects.filter((p) => p.name === 'Work')).toHaveLength(1);
  });

  it('copies tasks to a TaskFlow list, then updates, completes and removes the copies', async () => {
    const { service, actions, google, snap, settings } = await setup();
    await service.connect(['tasks'], true);
    google.taskLists = [{ id: 'L-my', title: 'My Tasks', tasks: [{ id: 'g1', title: 'From Google', position: '1' }] }];
    await service.importTasks(await service.taskLists(), await service.taskLists(), await snap());
    const a = (await actions.createTask({ title: 'Write report', dueDate: '2026-11-27', description: 'Draft' })).id;
    const b = (await actions.createTask({ title: 'Call bank' })).id;

    const first = await service.exportTasks(await snap(), await settings());
    expect(first).toMatchObject({ added: 2, changed: 0, removed: 0 });
    const list = google.taskLists.find((l) => l.id === first.listId)!;
    expect(list.title).toBe('TaskFlow');
    expect(list.tasks.map((t) => [t.title, t.notes, t.due ?? null, t.status]).sort()).toEqual([
      ['Call bank', '', null, 'needsAction'],
      ['Write report', 'Draft', '2026-11-27T00:00:00.000Z', 'needsAction'],
    ]);
    expect((await settings()).tasksListId).toBe(first.listId);

    expect(await service.exportTasks(await snap(), await settings())).toMatchObject({ added: 0, changed: 0, removed: 0 });

    await actions.complete([a]);
    await actions.deleteTasks([b]);
    expect(await service.exportTasks(await snap(), await settings())).toMatchObject({ added: 0, changed: 1, removed: 1 });
    expect(list.tasks.map((t) => [t.title, t.status])).toEqual([['Write report', 'completed']]);
  });

  it('if a copy was deleted in Google Tasks, the next copy makes a new one', async () => {
    const { service, actions, google, snap, settings } = await setup();
    await service.connect(['tasks'], true);
    await actions.createTask({ title: 'Write report' });
    const { listId } = await service.exportTasks(await snap(), await settings());
    const list = google.taskLists.find((l) => l.id === listId)!;
    list.tasks = [];
    expect(await service.exportTasks(await snap(), await settings())).toMatchObject({ added: 1 });
    expect(list.tasks).toHaveLength(1);
  });
});

describe('Drive attachments', () => {
  it('uploads into a TaskFlow attachments folder made once, and attaches the Drive link', async () => {
    const { service, actions, google, snap, settings } = await setup();
    const id = (await actions.createTask({ title: 'Tax return' })).id;
    const bytes = new TextEncoder().encode('receipt').buffer;
    const file = { name: 'receipt.pdf', mimeType: 'application/pdf', size: 7, bytes: async () => bytes as ArrayBuffer };
    const done = await service.attachFile(id, file, await settings());
    expect(done.name).toBe('receipt.pdf');
    const folderId = (await settings()).driveFolderId!;
    expect(google.files.get(folderId)).toMatchObject({ name: 'TaskFlow attachments', mimeType: 'application/vnd.google-apps.folder' });
    const uploaded = [...google.files.values()].find((f) => f.name === 'receipt.pdf')!;
    expect(uploaded).toMatchObject({ parents: [folderId], mimeType: 'application/pdf', size: '7' });
    expect(new TextDecoder().decode(uploaded.bytes)).toBe('receipt');
    const link = (await snap()).links.get(id)![0];
    expect(link).toMatchObject({ kind: 'drive', name: 'receipt.pdf', url: done.url });

    await service.attachFile(id, { ...file, name: 'second.pdf' }, await settings());
    expect([...google.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder')).toHaveLength(1);
  });

  it('refuses files over 25 MB before uploading anything', async () => {
    const { service, actions, google, settings } = await setup();
    const id = (await actions.createTask({ title: 'Video' })).id;
    await expect(service.attachFile(id, { name: 'big.mp4', mimeType: 'video/mp4', size: 30 * 1024 * 1024, bytes: async () => new ArrayBuffer(0) }, await settings()))
      .rejects.toThrow('larger than 25 MB');
    expect(google.requests).toEqual([]);
  });
});

describe('disconnecting', () => {
  it('takes the access back at Google and switches the calendar features off', async () => {
    const { service, actions, google, settings } = await setup();
    await service.connect(['calendarWrite'], true);
    await actions.setGoogleSettings(USER, { calendarPush: true, showEvents: true, calendarId: 'c1' });
    await service.disconnect('tok-1', google.http);
    expect(google.granted.size).toBe(0);
    expect(await settings()).toMatchObject({ calendarPush: false, showEvents: false, calendarId: 'c1' });
  });
});
