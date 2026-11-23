/**
 * Google in the app: whether this device has access, the account's Google
 * settings, keeping the TaskFlow calendar up to date, and the person's
 * events for the calendar views.
 *
 * Access belongs to the device (Google's screens grant it per phone or
 * browser); the settings belong to the account, so turning on "Tasks in
 * Google Calendar" on the phone also makes a signed-in, connected computer
 * keep the calendar up to date. Either device's push gives the same result.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { ExternalEvent } from '@/core/calendar';
import { type LocalDate, localDateOf, nowFrom } from '@/core/dates';
import { type GoogleFeature, type GoogleSettings, readGoogleSettings } from '@/core/google';
import {
  type ExportResult, GoogleClient, GoogleService, type Http, type ImportResult, NotConnected, type PushResult, type TaskList,
} from '@/data/google';
import { pickAnyFile } from '@/platform/files';
import { googleOnDevice, googleUnavailable, preloadGoogle, tokenSource } from '@/platform/google-auth';
import { kv } from '@/platform/kv';
import { useSession } from '@/state/session';

import { useData } from './data';

/** Wait this long after the last change before updating the TaskFlow calendar. */
const PUSH_DELAY_MS = 15_000;
/** Google events are fetched again after this long. */
const EVENTS_TTL_MS = 5 * 60_000;

const http: Http = (url, init) => fetch(url, { method: init.method, headers: init.headers, body: init.body as BodyInit | undefined });

function toLocal(iso: string) {
  const d = new Date(iso);
  return { date: localDateOf(d), minutes: d.getHours() * 60 + d.getMinutes() };
}

export type PushStatus = { state: 'idle' | 'running' | 'done' | 'error'; at: number | null; message: string | null; last: PushResult | null };

type GoogleValue = {
  available: boolean;
  unavailableReason: string | null;
  settings: GoogleSettings;
  /** The Google account this device connected, or null. */
  account: string | null;
  push: PushStatus;
  /** Shows Google's consent screen for these features if needed. False when the person declined. */
  connect(features: GoogleFeature[]): Promise<boolean>;
  setCalendarPush(on: boolean): Promise<void>;
  setShowEvents(on: boolean): Promise<void>;
  pushNow(): Promise<void>;
  taskLists(): Promise<TaskList[]>;
  importLists(lists: TaskList[], all: TaskList[]): Promise<ImportResult>;
  exportTasks(): Promise<ExportResult>;
  /** Picks a file and uploads it to Drive; null when the person cancelled. */
  attachFile(taskId: string): Promise<{ name: string } | null>;
  disconnect(): Promise<void>;
  events(from: LocalDate, to: LocalDate): Promise<ExternalEvent[]>;
  eventsVersion: number;
};

const GoogleContext = createContext<GoogleValue | null>(null);

export function GoogleProvider({ children }: { children: ReactNode }) {
  const { data, actions } = useData();
  const { user } = useSession();
  const userId = user?.id ?? '';
  const settings = useMemo(() => readGoogleSettings(data.profile?.settings), [data.profile?.settings]);
  const accountKey = `taskflow.google.account.${userId}`;
  const [account, setAccount] = useState<string | null>(null);
  const [push, setPush] = useState<PushStatus>({ state: 'idle', at: null, message: null, last: null });
  const [eventsVersion, setEventsVersion] = useState(0);
  const eventCache = useRef(new Map<string, { at: number; items: ExternalEvent[] }>());
  const latest = useRef({ data, settings });
  useEffect(() => {
    latest.current = { data, settings };
  });

  const timeZone = data.profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const service = useMemo(
    () => new GoogleService(new GoogleClient(tokenSource, http), actions, {
      userId,
      timeZone: () => timeZone,
      now: () => nowFrom(new Date()),
      toLocal,
    }),
    [actions, userId, timeZone],
  );

  useEffect(() => {
    let live = true;
    void kv.getItem(accountKey).then((v) => live && setAccount(v));
    void preloadGoogle().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountKey]);

  const connect = useCallback(
    async (features: GoogleFeature[]) => {
      try {
        const email = await service.connect(features, true);
        const name = email ?? 'your Google account';
        setAccount(name);
        await kv.setItem(accountKey, name);
        return true;
      } catch (e) {
        if (e instanceof NotConnected) return false;
        throw e;
      }
    },
    [service, accountKey],
  );

  const pushNow = useCallback(async () => {
    const { data: d, settings: s } = latest.current;
    if (!s.calendarPush) return;
    setPush((p) => ({ ...p, state: 'running' }));
    try {
      const last = await service.pushCalendar(d, s);
      setPush({ state: 'done', at: Date.now(), message: null, last });
    } catch (e) {
      const message = e instanceof NotConnected
        ? 'This device has no access to Google Calendar. Connect it here to keep the TaskFlow calendar up to date.'
        : e instanceof Error ? e.message : String(e);
      setPush((p) => ({ state: 'error', at: Date.now(), message, last: p.last }));
    }
  }, [service]);

  // Keep the TaskFlow calendar up to date: a while after the tasks change.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!settings.calendarPush || !googleOnDevice || !account) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void pushNow(), PUSH_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, settings.calendarPush, account, pushNow]);

  const value: GoogleValue = {
    available: googleOnDevice,
    unavailableReason: googleUnavailable,
    settings,
    account,
    push,
    connect,
    setCalendarPush: async (on) => {
      if (on && !(await connect(['calendarWrite']))) return;
      await actions.setGoogleSettings(userId, { calendarPush: on });
      latest.current = { ...latest.current, settings: { ...latest.current.settings, calendarPush: on } };
      if (on) await pushNow();
    },
    setShowEvents: async (on) => {
      if (on && !(await connect(['calendarRead']))) return;
      await actions.setGoogleSettings(userId, { showEvents: on });
      eventCache.current.clear();
      setEventsVersion((v) => v + 1);
    },
    pushNow,
    taskLists: async () => {
      if (!(await connect(['tasks']))) throw new NotConnected('Google Tasks was not connected.');
      return service.taskLists();
    },
    importLists: (lists, all) => service.importTasks(lists, all, latest.current.data),
    exportTasks: async () => {
      if (!(await connect(['tasks']))) throw new NotConnected('Google Tasks was not connected.');
      return service.exportTasks(latest.current.data, latest.current.settings);
    },
    attachFile: async (taskId) => {
      const file = await pickAnyFile();
      if (!file) return null;
      if (!(await connect(['drive']))) throw new NotConnected('Google Drive was not connected.');
      return service.attachFile(taskId, file, latest.current.settings);
    },
    disconnect: async () => {
      const token = await tokenSource.token([], false).catch(() => null);
      await service.disconnect(token, http);
      if (token) await tokenSource.forget(token);
      setAccount(null);
      await kv.removeItem(accountKey);
      eventCache.current.clear();
      setEventsVersion((v) => v + 1);
      setPush({ state: 'idle', at: null, message: null, last: null });
    },
    events: async (from, to) => {
      const key = `${from}|${to}`;
      const hit = eventCache.current.get(key);
      if (hit && Date.now() - hit.at < EVENTS_TTL_MS) return hit.items;
      const items = await service.events(from, to, latest.current.settings);
      eventCache.current.set(key, { at: Date.now(), items });
      return items;
    },
    eventsVersion,
  };

  return <GoogleContext.Provider value={value}>{children}</GoogleContext.Provider>;
}

export function useGoogle(): GoogleValue {
  const value = useContext(GoogleContext);
  if (!value) throw new Error('useGoogle must be used inside GoogleProvider');
  return value;
}

const NONE: ExternalEvent[] = [];

/** Google Calendar events between two days, for the calendar views; empty when not shown. */
export function useGoogleEvents(from: LocalDate, to: LocalDate): { items: ExternalEvent[]; message: string | null } {
  const google = useContext(GoogleContext);
  const [result, setResult] = useState<{ key: string; items: ExternalEvent[]; message: string | null } | null>(null);
  const on = !!google && google.settings.showEvents && google.available && !!google.account;
  const key = `${from}|${to}|${google?.eventsVersion ?? 0}`;
  const events = google?.events;
  useEffect(() => {
    if (!on || !events) return;
    let live = true;
    events(from, to).then(
      (items) => live && setResult({ key, items, message: null }),
      (e: unknown) => live && setResult({
        key, items: NONE,
        message: e instanceof NotConnected ? 'Google events are hidden: this device is not connected to Google Calendar (More → Google).'
          : `Google events could not be loaded. ${e instanceof Error ? e.message : ''}`.trim(),
      }),
    );
    return () => {
      live = false;
    };
    // `events` changes every render; the key says when to fetch again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);
  if (!on || !result || result.key !== key) return { items: NONE, message: null };
  return { items: result.items, message: result.message };
}
