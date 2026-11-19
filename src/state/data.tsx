import * as Crypto from 'expo-crypto';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { Actions, InvalidInput } from '@/data/actions';
import { openExpoDb } from '@/data/expo-db';
import { type DataSnapshot, loadSnapshot } from '@/data/snapshot';
import { type SyncReason, SyncScheduler, type SyncStatus } from '@/data/scheduler';
import { Store, type UndoLog } from '@/data/store';
import { PROBLEMS_KEY, readProblems, SyncEngine, type SyncProblem } from '@/data/sync';
import { deviceTimezone, getDeviceId } from '@/platform/device';
import { supabaseTransport, watchAccount } from '@/platform/sync';

import { useSession } from './session';

type DataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DataSnapshot; actions: Actions };

export type Notice = { id: number; message: string; tone: 'info' | 'error'; undo?: UndoLog };

export type SyncState = SyncStatus & {
  problems: SyncProblem[];
  /** Ask for a sync now (the "Sync now" button). */
  syncNow: () => void;
  /** Forget the list of refused changes. */
  clearProblems: () => void;
};

const IDLE_SYNC: SyncState = {
  phase: 'idle', lastSyncedAt: null, error: null, retryAt: null, lastReport: null, problems: [], syncNow: () => {}, clearProblems: () => {},
};

/** A sync also runs this often while the app is open, in case a live update was missed. */
const SAFETY_SYNC_MS = 5 * 60_000;

type DataValue = {
  state: DataState;
  sync: SyncState;
  notice: Notice | null;
  notify: (message: string, options?: { undo?: UndoLog; tone?: 'info' | 'error' }) => void;
  dismiss: () => void;
};

const DataContext = createContext<DataValue | null>(null);
const LOADING: DataState = { status: 'loading' };

/**
 * Opens this account's database on this device and keeps a fresh snapshot.
 * Each account gets its own database file, so two accounts on one phone never mix.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  // Tagged with the account it belongs to, so a different account shows "loading" until its own data is open.
  const [stored, setStored] = useState<{ userId: string; state: DataState } | null>(null);
  const state: DataState = stored && stored.userId === userId ? stored.state : LOADING;
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncStored, setSyncStored] = useState<{ userId: string; sync: SyncState } | null>(null);
  const sync: SyncState = syncStored && syncStored.userId === userId ? syncStored.sync : IDLE_SYNC;

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let store: Store | null = null;
    let scheduler: SyncScheduler | null = null;
    const cleanups: (() => void)[] = [];
    let unsubscribe: (() => void) | undefined;
    let loading = false;
    let again = false;

    const reload = async (actions: Actions) => {
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      do {
        again = false;
        try {
          const data = await loadSnapshot(store!);
          if (alive) setState({ status: 'ready', data, actions });
        } catch (e) {
          if (alive) setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      } while (again && alive);
      loading = false;
    };

    const setState = (next: DataState) => setStored({ userId, state: next });
    (async () => {
      try {
        const deviceId = await getDeviceId();
        const db = await openExpoDb(`taskflow-${userId}.db`);
        store = await Store.open(db, { userId, deviceId });
        const actions = new Actions(store, { newId: () => Crypto.randomUUID().toLowerCase() });
        if (!alive) return;

        // Sync: edits here go up shortly after they are made; edits elsewhere come
        // down when the server announces them, when the app comes back to the
        // front, and every few minutes as a safety net.
        const engine = new SyncEngine(store, supabaseTransport, { deviceId });
        const sched = new SyncScheduler(() => engine.run());
        scheduler = sched;
        const syncNow = () => sched.request('manual');
        const publish = async (status: SyncStatus) => {
          const problems = store ? await readProblems(store).catch(() => []) : [];
          if (alive) setSyncStored({ userId, sync: { ...status, problems, syncNow, clearProblems } });
        };
        const clearProblems = () => {
          void store?.setMeta(PROBLEMS_KEY, null).then(() => publish(sched.current));
        };
        let timezoneChecked = false;
        cleanups.push(
          sched.subscribe((status) => {
            void publish(status);
            // After the first good sync the profile is here; bring its time zone up to date.
            if (!timezoneChecked && status.phase === 'idle' && status.lastReport) {
              timezoneChecked = true;
              actions.setTimezone(userId, deviceTimezone()).catch(() => {});
            }
          }),
        );
        void publish(sched.current);
        const ask = (reason: SyncReason) => sched.request(reason);

        unsubscribe = store.subscribe((origin) => {
          void reload(actions);
          if (origin === 'local') ask('local');
        });
        cleanups.push(watchAccount(userId, deviceId, () => ask('remote')));
        const appState = AppState.addEventListener('change', (next) => {
          if (next === 'active') ask('foreground');
        });
        cleanups.push(() => appState.remove());
        // In a browser, the connection coming back is announced directly.
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          const online = () => ask('foreground');
          window.addEventListener('online', online);
          cleanups.push(() => window.removeEventListener('online', online));
        }
        const interval = setInterval(() => {
          if (AppState.currentState === 'active') ask('interval');
        }, SAFETY_SYNC_MS);
        cleanups.push(() => clearInterval(interval));

        await reload(actions);
        ask('start');
      } catch (e) {
        if (alive) {
          const message = e instanceof Error ? e.message : String(e);
          setState({ status: 'error', message });
        }
      }
    })();

    return () => {
      alive = false;
      unsubscribe?.();
      scheduler?.stop();
      for (const c of cleanups) c();
      store?.close().catch(() => {});
    };
  }, [userId]);

  const dismiss = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(null);
  }, []);

  const notify = useCallback<DataValue['notify']>((message, options) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), message, tone: options?.tone ?? 'info', undo: options?.undo });
    noticeTimer.current = setTimeout(() => setNotice(null), options?.undo ? 6000 : 4000);
  }, []);

  const value = useMemo(() => ({ state, sync, notice, notify, dismiss }), [state, sync, notice, notify, dismiss]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function useDataContext(): DataValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside DataProvider');
  return value;
}

export function useDataState(): DataState {
  return useDataContext().state;
}

/** The snapshot and actions. Only for screens shown once data is ready. */
export function useData(): { data: DataSnapshot; actions: Actions } {
  const { state } = useDataContext();
  if (state.status !== 'ready') throw new Error('Data is not ready');
  return { data: state.data, actions: state.actions };
}

/** How syncing with the account is going, and a way to sync now. */
export function useSync(): SyncState {
  return useDataContext().sync;
}

export function useNotice() {
  const { notice, notify, dismiss } = useDataContext();
  return { notice, notify, dismiss };
}

/**
 * Runs an action. Problems are shown as a message instead of thrown; when the
 * action returns an undo log and a message is given, the message offers Undo.
 */
export function useRun() {
  const { notify } = useDataContext();
  return useCallback(
    async <T,>(work: () => Promise<T>, message?: string): Promise<T | undefined> => {
      try {
        const result = await work();
        if (message) {
          const undo = result && typeof result === 'object' && 'changes' in (result as object) ? (result as unknown as UndoLog)
            : result && typeof result === 'object' && 'undo' in (result as object) ? (result as unknown as { undo: UndoLog }).undo
            : undefined;
          notify(message, { undo });
        }
        return result;
      } catch (e) {
        notify(e instanceof InvalidInput ? e.message : `Could not save: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
        return undefined;
      }
    },
    [notify],
  );
}
