/**
 * An in-memory stand-in for the parts of Google's APIs TaskFlow uses, for
 * tests. It follows the documented behaviour that matters to TaskFlow:
 *
 *   Calendar  creating an event with an id that exists (even a deleted one)
 *             answers 409; event ids must be 5–1024 characters a–v and 0–9;
 *             deleting a deleted event answers 410; private extended
 *             properties can be searched; deleted events are not listed.
 *   Tasks     lists and tasks, paged 100 at a time; a deleted task is gone.
 *   Drive     folders, and resumable uploads: the first request answers with
 *             an upload address in the Location header, the second sends the bytes.
 *   Tokens    each request needs a valid token with the right permissions,
 *             or gets 401 (expired) or 403 (permission missing).
 */
import type { Http, HttpResponse, TokenSource } from '../google';

type Json = Record<string, unknown>;

function response(status: number, body?: unknown, headers: Record<string, string> = {}): HttpResponse {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

const err = (status: number, message: string) => response(status, { error: { code: status, message } });

export class FakeGoogle {
  /** Tokens Google accepts, with the permissions each carries. */
  tokens = new Map<string, Set<string>>();
  /** Permissions the person has granted TaskFlow so far. */
  granted = new Set<string>();
  private serial = 0;
  calendars = new Map<string, { id: string; summary: string; owner: 'app' | 'person'; selected?: boolean; events: Map<string, Json> }>();
  taskLists: { id: string; title: string; tasks: Json[] }[] = [];
  files = new Map<string, Json & { bytes?: Uint8Array }>();
  private uploads = new Map<string, Json>();
  /** Answers queued for the next requests (to simulate a busy Google). */
  failNext: number[] = [];
  requests: string[] = [];
  email = 'person@example.com';

  constructor() {
    this.calendars.set('primary@example.com', { id: 'primary@example.com', summary: 'person@example.com', owner: 'person', events: new Map() });
  }

  private id(prefix: string) {
    this.serial += 1;
    return `${prefix}${this.serial}`;
  }

  /**
   * A TokenSource as Google's screens give: a cached token until it is
   * dropped or more permissions are granted; [interactive] grants more.
   */
  tokenSource(opts: { approve: boolean } = { approve: true }): TokenSource & { issued: number; forgotten: string[] } {
    let current: string | null = null;
    const source = {
      issued: 0,
      forgotten: [] as string[],
      token: async (scopes: string[], interactive: boolean) => {
        const missing = scopes.filter((s) => !this.granted.has(s));
        if (missing.length) {
          if (!interactive || !opts.approve) return null;
          for (const s of missing) this.granted.add(s);
          current = null;
        }
        if (current) return current;
        source.issued += 1;
        current = `tok-${source.issued}`;
        this.tokens.set(current, new Set(this.granted));
        return current;
      },
      forget: async (token: string) => {
        source.forgotten.push(token);
        if (current === token) current = null;
      },
    };
    return source;
  }

  /** Makes a token expire, as after an hour. */
  expire(token: string) {
    this.tokens.delete(token);
  }

  http: Http = async (url, init) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    this.requests.push(`${init.method} ${path}`);
    const token = (init.headers.Authorization ?? '').replace(/^Bearer /, '');
    if (u.hostname === 'oauth2.googleapis.com' && path === '/revoke') {
      this.tokens.clear();
      this.granted.clear();
      return response(200, {});
    }
    const scopes = this.tokens.get(token);
    if (!scopes) return err(401, 'Request had invalid authentication credentials.');
    const fail = this.failNext.shift();
    if (fail) return err(fail, 'The service is currently unavailable.');
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Json) : undefined;
    const q = u.searchParams;
    const need = (scope: string) => scopes.has(`https://www.googleapis.com/auth/${scope}`);
    let m: RegExpMatchArray | null;

    if (path === '/oauth2/v3/userinfo') return need('userinfo.email') ? response(200, { email: this.email }) : err(403, 'Insufficient Permission');

    // ---- Calendar ----
    if (path.startsWith('/calendar/')) {
      const write = need('calendar.app.created');
      const read = need('calendar.events.readonly');
      if (path === '/calendar/v3/calendars' && init.method === 'POST') {
        if (!write) return err(403, 'Insufficient Permission');
        const id = `${this.id('c')}@group.calendar.google.com`;
        this.calendars.set(id, { id, summary: String(body!.summary), owner: 'app', events: new Map() });
        return response(200, { id, summary: body!.summary });
      }
      if (path === '/calendar/v3/users/me/calendarList') {
        if (!need('calendar.calendarlist.readonly')) return err(403, 'Insufficient Permission');
        return response(200, { items: [...this.calendars.values()].map((c) => ({ id: c.id, summary: c.summary, selected: c.selected ?? true, accessRole: 'owner' })) });
      }
      if ((m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)$/))) {
        const c = this.calendars.get(m[1]);
        if (!c) return err(404, 'Not Found');
        if (c.owner !== 'app' && !read) return err(403, 'Insufficient Permission');
        return response(200, { id: c.id });
      }
      if ((m = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/))) {
        const c = this.calendars.get(m[1]);
        if (!c) return err(404, 'Not Found');
        const canWrite = write && c.owner === 'app';
        const eventId = m[2];
        if (init.method === 'GET' && !eventId) {
          if (!(canWrite || read)) return err(403, 'Insufficient Permission');
          let items = [...c.events.values()];
          if (q.get('showDeleted') !== 'true') items = items.filter((e) => e.status !== 'cancelled');
          const prop = q.get('privateExtendedProperty');
          if (prop) {
            const [k, v] = prop.split('=');
            items = items.filter((e) => ((e.extendedProperties as { private?: Json } | undefined)?.private ?? {})[k] === v);
          }
          return response(200, { items });
        }
        if (!canWrite) return err(403, 'Insufficient Permission');
        if (init.method === 'POST') {
          const id = String(body!.id ?? this.id('ev'));
          if (!/^[a-v0-9]{5,1024}$/.test(id)) return err(400, 'Invalid resource id value.');
          if (c.events.has(id)) return err(409, 'The requested identifier already exists.');
          c.events.set(id, { ...body, id, status: body!.status ?? 'confirmed' });
          return response(200, c.events.get(id));
        }
        const existing = c.events.get(eventId!);
        if (init.method === 'PUT') {
          if (!existing) return err(404, 'Not Found');
          c.events.set(eventId!, { ...body, id: eventId, status: body!.status ?? 'confirmed' });
          return response(200, c.events.get(eventId!));
        }
        if (init.method === 'DELETE') {
          if (!existing) return err(404, 'Not Found');
          if (existing.status === 'cancelled') return err(410, 'Resource has been deleted');
          existing.status = 'cancelled';
          return response(204);
        }
      }
    }

    // ---- Tasks ----
    if (path.startsWith('/tasks/')) {
      if (!need('tasks')) return err(403, 'Insufficient Permission');
      if (path === '/tasks/v1/users/@me/lists') {
        if (init.method === 'POST') {
          const list = { id: this.id('L'), title: String(body!.title), tasks: [] };
          this.taskLists.push(list);
          return response(200, { id: list.id, title: list.title });
        }
        return response(200, { items: this.taskLists.map((l) => ({ id: l.id, title: l.title })) });
      }
      if ((m = path.match(/^\/tasks\/v1\/users\/@me\/lists\/([^/]+)$/))) {
        const list = this.taskLists.find((l) => l.id === m![1]);
        return list ? response(200, { id: list.id, title: list.title }) : err(404, 'Not Found');
      }
      if ((m = path.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/))) {
        const list = this.taskLists.find((l) => l.id === m![1]);
        if (!list) return err(404, 'Not Found');
        const taskId = m[2];
        if (init.method === 'GET') {
          const size = Math.min(100, Number(q.get('maxResults') ?? 20));
          const start = Number(q.get('pageToken') ?? 0);
          const all = list.tasks.filter((t) => q.get('showCompleted') === 'true' || t.status !== 'completed');
          const items = all.slice(start, start + size);
          return response(200, { items, ...(start + size < all.length ? { nextPageToken: String(start + size) } : {}) });
        }
        if (init.method === 'POST') {
          const t = { ...body, id: this.id('T'), status: body!.status ?? 'needsAction' };
          list.tasks.push(t);
          return response(200, t);
        }
        const t = list.tasks.find((x) => x.id === taskId);
        if (!t) return err(404, 'Not Found');
        if (init.method === 'PATCH') {
          for (const [k, v] of Object.entries(body!)) {
            if (v === null) delete t[k];
            else t[k] = v;
          }
          return response(200, t);
        }
        if (init.method === 'DELETE') {
          list.tasks = list.tasks.filter((x) => x !== t);
          return response(204);
        }
      }
    }

    // ---- Drive ----
    if (path.startsWith('/drive/') || path.startsWith('/upload/drive/')) {
      if (!need('drive.file')) return err(403, 'Insufficient Permission');
      if (path === '/drive/v3/files' && init.method === 'POST') {
        const id = this.id('F');
        this.files.set(id, { id, name: body!.name, mimeType: body!.mimeType, trashed: false });
        return response(200, { id });
      }
      if ((m = path.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
        const f = this.files.get(m[1]);
        return f ? response(200, { id: f.id, trashed: f.trashed }) : err(404, 'File not found');
      }
      if (path === '/upload/drive/v3/files' && init.method === 'POST' && q.get('uploadType') === 'resumable') {
        const parent = (body!.parents as string[])[0];
        if (!this.files.has(parent)) return err(404, 'File not found');
        const uploadId = this.id('U');
        this.uploads.set(uploadId, { ...body, length: Number(init.headers['X-Upload-Content-Length']) });
        return response(200, undefined, { location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}` });
      }
      if (path === '/upload/drive/v3/files' && init.method === 'PUT') {
        const meta = this.uploads.get(q.get('upload_id') ?? '');
        if (!meta) return err(404, 'Upload not found');
        const bytes = init.body as Uint8Array;
        if (bytes.byteLength !== meta.length) return err(400, 'Wrong length');
        const id = this.id('F');
        const file = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, size: String(bytes.byteLength), webViewLink: `https://drive.google.com/file/d/${id}/view`, bytes };
        this.files.set(id, file);
        return response(200, { id, name: file.name, mimeType: file.mimeType, size: file.size, webViewLink: file.webViewLink });
      }
    }
    return err(404, `No such endpoint: ${init.method} ${path}`);
  };
}
