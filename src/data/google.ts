/**
 * TaskFlow's calls to Google: Calendar, Tasks and Drive, from the device with
 * the person's own Google access (no server in between, no token stored by
 * the app). The rules (what goes where) are in src/core/google.ts; this file
 * talks HTTP and writes the results through Actions.
 *
 * Every call goes through GoogleClient, which adds the access token, asks for
 * a fresh one once when Google says it expired (401), and waits and tries
 * once more when Google is busy (429, 5xx).
 */
import { addDays, type LocalDate, type Now } from '@/core/dates';
import {
  desiredEvents, eventDays, type ExistingEvent, type GoogleEvent, type GoogleFeature, type GoogleSettings, type GoogleTask,
  type GoogleTaskBody, LINK_EXPORTED, LINK_IMPORTED, planCalendar, planExport, planImport, PUSH_DAYS_AHEAD, PUSH_DAYS_BACK, scopesFor,
} from '@/core/google';
import type { ExternalEvent } from '@/core/calendar';

import type { Actions } from './actions';
import type { DataSnapshot } from './snapshot';

export type HttpResponse = { status: number; ok: boolean; headers: { get(name: string): string | null }; json(): Promise<unknown>; text(): Promise<string> };
export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string | ArrayBuffer | Uint8Array }) => Promise<HttpResponse>;

/** Where access tokens come from: Google's own screens on the phone or in the browser. */
export type TokenSource = {
  /** A token for [scopes]; null when the person has not given access and [interactive] is false (or they cancelled). */
  token(scopes: string[], interactive: boolean): Promise<string | null>;
  /** Drop a token Google rejected, so the next request gets a fresh one. */
  forget(token: string): Promise<void>;
};

export const GOOGLE_HOSTS = {
  api: 'https://www.googleapis.com',
  oauth: 'https://oauth2.googleapis.com',
};

/** The person has not given TaskFlow access to this (or took it back). */
export class NotConnected extends Error {
  constructor(message = 'TaskFlow has no access to your Google account for this. Connect it in More → Google.') {
    super(message);
  }
}

export class GoogleError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Call = { query?: Record<string, string | number | boolean | undefined>; body?: unknown; raw?: ArrayBuffer | Uint8Array; headers?: Record<string, string>; interactive?: boolean };

export class GoogleClient {
  constructor(
    private readonly tokens: TokenSource,
    private readonly http: Http,
    private readonly hosts = GOOGLE_HOSTS,
    private readonly wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  ) {}

  url(path: string, query?: Call['query']): string {
    const base = path.startsWith('http') ? path : `${this.hosts.api}${path}`;
    const q = Object.entries(query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return q.length ? `${base}${base.includes('?') ? '&' : '?'}${q.join('&')}` : base;
  }

  /** The raw response (for uploads, which read a header). */
  async send(features: GoogleFeature[], method: string, path: string, call: Call = {}): Promise<HttpResponse> {
    const scopes = scopesFor(...features);
    let token = await this.tokens.token(scopes, call.interactive ?? false);
    if (!token) throw new NotConnected();
    let refreshed = false;
    let retried = false;
    for (;;) {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...call.headers };
      let body: string | ArrayBuffer | Uint8Array | undefined;
      if (call.raw !== undefined) body = call.raw;
      else if (call.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(call.body);
      }
      const res = await this.http(this.url(path, call.query), { method, headers, body });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.tokens.forget(token);
        token = await this.tokens.token(scopes, false);
        if (!token) throw new NotConnected();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && !retried) {
        retried = true;
        await this.wait(1500);
        continue;
      }
      if (res.status === 401) throw new NotConnected();
      return res;
    }
  }

  async json<T>(features: GoogleFeature[], method: string, path: string, call: Call = {}): Promise<T> {
    const res = await this.send(features, method, path, call);
    if (!res.ok) throw await errorOf(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function errorOf(res: HttpResponse): Promise<GoogleError> {
  let message = `Google answered ${res.status}.`;
  try {
    const body = JSON.parse(await res.text()) as { error?: { message?: string } | string; error_description?: string };
    const m = typeof body.error === 'object' ? body.error?.message : body.error_description ?? body.error;
    if (m) message = `Google: ${m}`;
  } catch {
    // Not JSON: keep the status.
  }
  if (res.status === 403) message += ' Check that the API is turned on in your Google Cloud project (see SETUP.md).';
  return new GoogleError(message, res.status);
}

export type PushResult = { calendarId: string; added: number; changed: number; removed: number };
export type TaskList = { id: string; title: string };
export type ImportResult = { lists: number; tasks: number };
export type ExportResult = { listId: string; added: number; changed: number; removed: number };
export type PickedFile = { name: string; mimeType: string | null; size: number | null; bytes: () => Promise<ArrayBuffer> };

/** The largest file TaskFlow uploads in one go. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class GoogleService {
  constructor(
    private readonly client: GoogleClient,
    private readonly actions: Actions,
    private readonly opts: { userId: string; timeZone: () => string; now: () => Now; toLocal: (iso: string) => { date: LocalDate; minutes: number } },
  ) {}

  /** The Google account's address. Asking for it also shows Google's consent screen when [interactive]. */
  async connect(features: GoogleFeature[], interactive: boolean): Promise<string | null> {
    const me = await this.client.json<{ email?: string }>(features, 'GET', '/oauth2/v3/userinfo', { interactive });
    return me?.email ?? null;
  }

  // ---- Calendar: tasks into the TaskFlow calendar ------------------------------------------

  private async calendarId(settings: GoogleSettings): Promise<string> {
    if (settings.calendarId) {
      const res = await this.client.send(['calendarWrite'], 'GET', `/calendar/v3/calendars/${encodeURIComponent(settings.calendarId)}`, { query: { fields: 'id' } });
      if (res.ok) return settings.calendarId;
      if (res.status !== 404 && res.status !== 403) throw await errorOf(res);
    }
    // None yet, or the person deleted it: make one.
    const made = await this.client.json<{ id: string }>(['calendarWrite'], 'POST', '/calendar/v3/calendars', {
      body: { summary: 'TaskFlow', description: 'Tasks from TaskFlow. Edit them in TaskFlow; changes made here are replaced.', timeZone: this.opts.timeZone() },
    });
    await this.actions.setGoogleSettings(this.opts.userId, { calendarId: made.id });
    return made.id;
  }

  /** Makes the TaskFlow calendar match the tasks: adds, changes and deletes only what differs. */
  async pushCalendar(data: DataSnapshot, settings: GoogleSettings): Promise<PushResult> {
    const calendarId = await this.calendarId(settings);
    const now = this.opts.now();
    const from = addDays(now.date, -PUSH_DAYS_BACK);
    const to = addDays(now.date, PUSH_DAYS_AHEAD);
    const desired = desiredEvents(data, { from, to, timeZone: this.opts.timeZone(), now });
    const base = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const existing: ExistingEvent[] = [];
    let page: string | undefined;
    do {
      const list = await this.client.json<{ items?: { id: string; start?: { date?: string; dateTime?: string }; extendedProperties?: { private?: Record<string, string> } }[]; nextPageToken?: string }>(
        ['calendarWrite'], 'GET', base,
        { query: { privateExtendedProperty: 'taskflow=1', showDeleted: false, maxResults: 2500, pageToken: page, fields: 'items(id,start,extendedProperties),nextPageToken' } },
      );
      for (const e of list.items ?? []) {
        // Only events inside the window are compared; older ones stay as they are.
        const day = (e.start?.date ?? e.start?.dateTime ?? '').slice(0, 10);
        if (day && (day < from || day > to)) continue;
        existing.push({ id: e.id, hash: e.extendedProperties?.private?.tfHash ?? null });
      }
      page = list.nextPageToken;
    } while (page);

    const plan = planCalendar(desired, existing);
    for (const body of plan.insert) {
      const res = await this.client.send(['calendarWrite'], 'POST', base, { body });
      // 409: the id exists (sent by another device, or an event deleted earlier): replace it.
      if (res.status === 409) await this.client.json(['calendarWrite'], 'PUT', `${base}/${body.id}`, { body });
      else if (!res.ok) throw await errorOf(res);
    }
    for (const body of plan.update) {
      const res = await this.client.send(['calendarWrite'], 'PUT', `${base}/${body.id}`, { body });
      if (res.status === 404) await this.client.json(['calendarWrite'], 'POST', base, { body });
      else if (!res.ok) throw await errorOf(res);
    }
    for (const id of plan.remove) {
      const res = await this.client.send(['calendarWrite'], 'DELETE', `${base}/${id}`);
      if (!res.ok && res.status !== 404 && res.status !== 410) throw await errorOf(res);
    }
    return { calendarId, added: plan.insert.length, changed: plan.update.length, removed: plan.remove.length };
  }

  // ---- Calendar: the person's own events ---------------------------------------------------

  /** Events from the calendars the person shows in Google Calendar, between two days (inclusive). */
  async events(from: LocalDate, to: LocalDate, settings: GoogleSettings): Promise<ExternalEvent[]> {
    const calendars = await this.client.json<{ items?: { id: string; summary?: string; summaryOverride?: string; selected?: boolean; hidden?: boolean; accessRole?: string }[] }>(
      ['calendarRead'], 'GET', '/calendar/v3/users/me/calendarList', { query: { minAccessRole: 'reader', fields: 'items(id,summary,summaryOverride,selected,hidden,accessRole)' } },
    );
    const shown = (calendars.items ?? []).filter((c) => c.selected !== false && !c.hidden && c.id !== settings.calendarId);
    // A day earlier and later than asked, so the phone's time zone cannot cut events off.
    const timeMin = `${addDays(from, -1)}T00:00:00Z`;
    const timeMax = `${addDays(to, 2)}T00:00:00Z`;
    const out: ExternalEvent[] = [];
    for (const c of shown) {
      const list = await this.client.json<{ items?: GoogleEvent[] }>(['calendarRead'], 'GET', `/calendar/v3/calendars/${encodeURIComponent(c.id)}/events`, {
        query: { singleEvents: true, orderBy: 'startTime', timeMin, timeMax, maxResults: 2500, fields: 'items(id,status,summary,htmlLink,start,end)' },
      });
      for (const e of list.items ?? []) {
        for (const day of eventDays(e, c.summaryOverride ?? c.summary ?? 'Google Calendar', this.opts.toLocal)) {
          if (day.date >= from && day.date <= to) out.push({ ...day, key: `${c.id}|${day.key}` });
        }
      }
    }
    return out;
  }

  // ---- Google Tasks ------------------------------------------------------------------------

  async taskLists(): Promise<TaskList[]> {
    const lists = await this.client.json<{ items?: { id: string; title?: string }[] }>(['tasks'], 'GET', '/tasks/v1/users/@me/lists', { query: { maxResults: 100 } });
    return (lists.items ?? []).map((l) => ({ id: l.id, title: l.title?.trim() || 'Untitled list' }));
  }

  private async allTasks(listId: string): Promise<GoogleTask[]> {
    const out: GoogleTask[] = [];
    let page: string | undefined;
    do {
      const res = await this.client.json<{ items?: GoogleTask[]; nextPageToken?: string }>(['tasks'], 'GET', `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, {
        query: { showCompleted: true, showHidden: true, maxResults: 100, pageToken: page },
      });
      out.push(...(res.items ?? []));
      page = res.nextPageToken;
    } while (page);
    return out;
  }

  /**
   * Brings the chosen lists into TaskFlow. The person's first list (Google's
   * default, usually "My Tasks") goes to the Inbox; each other list becomes a
   * project of the same name. Importing again adds only new tasks.
   */
  async importTasks(lists: TaskList[], all: TaskList[], data: DataSnapshot): Promise<ImportResult> {
    let count = 0;
    for (const list of lists) {
      const known = new Set(data.externalLinks.filter((l) => l.provider === LINK_IMPORTED && l.listId === list.id).map((l) => l.externalId));
      const planned = planImport(await this.allTasks(list.id), known);
      if (planned.length === 0) continue;
      const projectId = all[0]?.id === list.id ? null : await this.actions.projectNamed(list.title);
      for (const t of planned) {
        await this.actions.importTask({ ...t, projectId, provider: LINK_IMPORTED, listId: list.id, googleId: t.googleId });
        count += 1;
      }
    }
    return { lists: lists.length, tasks: count };
  }

  private async exportListId(settings: GoogleSettings): Promise<string> {
    if (settings.tasksListId) {
      const res = await this.client.send(['tasks'], 'GET', `/tasks/v1/users/@me/lists/${encodeURIComponent(settings.tasksListId)}`);
      if (res.ok) return settings.tasksListId;
      if (res.status !== 404 && res.status !== 400) throw await errorOf(res);
    }
    const made = await this.client.json<{ id: string }>(['tasks'], 'POST', '/tasks/v1/users/@me/lists', { body: { title: 'TaskFlow' } });
    await this.actions.setGoogleSettings(this.opts.userId, { tasksListId: made.id });
    return made.id;
  }

  /**
   * Copies TaskFlow's tasks to the "TaskFlow" list in Google Tasks: new ones
   * are added, changed ones updated, and copies of deleted tasks removed.
   * Tasks imported from Google Tasks are not copied back.
   */
  async exportTasks(data: DataSnapshot, settings: GoogleSettings): Promise<ExportResult> {
    const listId = await this.exportListId(settings);
    const imported = new Set(data.externalLinks.filter((l) => l.provider === LINK_IMPORTED).map((l) => l.taskId));
    const links = new Map(data.externalLinks.filter((l) => l.provider === LINK_EXPORTED && l.listId === listId).map((l) => [l.taskId, l.externalId]));
    const inGoogle = new Map((await this.allTasks(listId)).filter((t) => !t.deleted).map((t) => [t.id, t]));
    const base = `/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`;
    const items = planExport(data, this.opts.now(), imported, new Set(links.keys()));
    const kept = new Set<string>();
    let added = 0;
    let changed = 0;
    for (const { taskId, body } of items) {
      const gid = links.get(taskId);
      const copy = gid ? inGoogle.get(gid) : undefined;
      if (gid && copy) {
        kept.add(gid);
        if (sameTask(copy, body)) continue;
        await this.client.json(['tasks'], 'PATCH', `${base}/${encodeURIComponent(gid)}`, { body: { ...body, due: body.due ?? null } });
        changed += 1;
        continue;
      }
      const made = await this.client.json<{ id: string }>(['tasks'], 'POST', base, { body });
      kept.add(made.id);
      await this.actions.linkExternal(taskId, LINK_EXPORTED, listId, made.id);
      added += 1;
    }
    let removed = 0;
    for (const gid of inGoogle.keys()) {
      if (kept.has(gid)) continue;
      const res = await this.client.send(['tasks'], 'DELETE', `${base}/${encodeURIComponent(gid)}`);
      if (!res.ok && res.status !== 404) throw await errorOf(res);
      removed += 1;
    }
    return { listId, added, changed, removed };
  }

  // ---- Drive ---------------------------------------------------------------------------

  private async folderId(settings: GoogleSettings): Promise<string> {
    if (settings.driveFolderId) {
      const res = await this.client.send(['drive'], 'GET', `/drive/v3/files/${encodeURIComponent(settings.driveFolderId)}`, { query: { fields: 'id,trashed' }, interactive: true });
      if (res.ok && !((await res.json()) as { trashed?: boolean }).trashed) return settings.driveFolderId;
      if (!res.ok && res.status !== 404) throw await errorOf(res);
    }
    const made = await this.client.json<{ id: string }>(['drive'], 'POST', '/drive/v3/files', {
      query: { fields: 'id' }, body: { name: 'TaskFlow attachments', mimeType: 'application/vnd.google-apps.folder' }, interactive: true,
    });
    await this.actions.setGoogleSettings(this.opts.userId, { driveFolderId: made.id });
    return made.id;
  }

  /** Uploads a file to the "TaskFlow attachments" folder in Drive and attaches it to the task. */
  async attachFile(taskId: string, file: PickedFile, settings: GoogleSettings): Promise<{ name: string; url: string }> {
    if (file.size != null && file.size > MAX_UPLOAD_BYTES) throw new GoogleError('This file is larger than 25 MB. Upload it to Drive yourself and paste its link.', 413);
    const folder = await this.folderId(settings);
    const bytes = new Uint8Array(await file.bytes());
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new GoogleError('This file is larger than 25 MB. Upload it to Drive yourself and paste its link.', 413);
    const mimeType = file.mimeType || 'application/octet-stream';
    // A resumable upload: first the file's details, then its bytes to the address Google gives back.
    const start = await this.client.send(['drive'], 'POST', '/upload/drive/v3/files', {
      query: { uploadType: 'resumable', fields: 'id,name,mimeType,size,webViewLink' },
      body: { name: file.name, parents: [folder], mimeType },
      headers: { 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(bytes.byteLength) },
    });
    if (!start.ok) throw await errorOf(start);
    const location = start.headers.get('location');
    if (!location) throw new GoogleError('Google did not give an upload address.', 0);
    const made = await this.client.json<{ id: string; name: string; mimeType?: string; size?: string; webViewLink?: string }>(['drive'], 'PUT', location, {
      raw: bytes, headers: { 'Content-Type': mimeType },
    });
    const url = made.webViewLink ?? `https://drive.google.com/file/d/${made.id}/view`;
    await this.actions.addDriveFile(taskId, { url, name: made.name, mimeType: made.mimeType ?? mimeType, size: made.size ? Number(made.size) : bytes.byteLength });
    return { name: made.name, url };
  }

  // ---- Disconnect ---------------------------------------------------------------------------

  /** Takes back TaskFlow's access at Google (for every device) and switches the calendar features off. */
  async disconnect(token: string | null, http: Http): Promise<void> {
    if (token) {
      await http(`${GOOGLE_HOSTS.oauth}/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => undefined);
    }
    await this.actions.setGoogleSettings(this.opts.userId, { calendarPush: false, showEvents: false });
  }
}

function sameTask(copy: GoogleTask, body: GoogleTaskBody): boolean {
  return (copy.title ?? '') === body.title && (copy.notes ?? '') === body.notes && (copy.status ?? 'needsAction') === body.status
    && (copy.due ?? '').slice(0, 10) === (body.due ?? '').slice(0, 10);
}
