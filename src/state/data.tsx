import * as Crypto from 'expo-crypto';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Actions, InvalidInput } from '@/data/actions';
import { openExpoDb } from '@/data/expo-db';
import { type DataSnapshot, loadSnapshot } from '@/data/snapshot';
import { Store, type UndoLog } from '@/data/store';
import { getDeviceId } from '@/platform/device';

import { useSession } from './session';

type DataState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DataSnapshot; actions: Actions };

export type Notice = { id: number; message: string; tone: 'info' | 'error'; undo?: UndoLog };

type DataValue = {
  state: DataState;
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

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let store: Store | null = null;
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
        unsubscribe = store.subscribe(() => void reload(actions));
        await reload(actions);
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

  const value = useMemo(() => ({ state, notice, notify, dismiss }), [state, notice, notify, dismiss]);
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
