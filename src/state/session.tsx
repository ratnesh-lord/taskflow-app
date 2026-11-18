import type { Session, User } from '@supabase/supabase-js';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { registerDevice } from '@/platform/device';
import { isConfigured } from '@/platform/env';
import { getSupabase } from '@/platform/supabase';

/**
 * unconfigured  the build has no Supabase address or key
 * loading       reading the stored session
 * signedOut     no session
 * recovery      arrived through a password-reset link: must set a new password
 * signedIn      normal use
 */
export type SessionStatus = 'unconfigured' | 'loading' | 'signedOut' | 'recovery' | 'signedIn';

type SessionValue = {
  status: SessionStatus;
  session: Session | null;
  user: User | null;
  /** Call when a reset link signed the user in, to ask for a new password. */
  beginRecovery: () => void;
  /** Call after the new password is saved, to leave recovery. */
  finishRecovery: () => void;
};

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  session: null,
  user: null,
  beginRecovery: () => {},
  finishRecovery: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isConfigured);
  const [recovering, setRecovering] = useState(false);
  const beginRecovery = useCallback(() => setRecovering(true), []);
  const finishRecovery = useCallback(() => setRecovering(false), []);

  useEffect(() => {
    if (!isConfigured) return;
    const supabase = getSupabase();
    let alive = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(next);
      setLoading(false);
    });

    // On a phone, refresh the session only while the app is in front.
    let appState: { remove: () => void } | undefined;
    if (Platform.OS !== 'web') {
      supabase.auth.startAutoRefresh();
      appState = AppState.addEventListener('change', (state) => {
        if (state === 'active') supabase.auth.startAutoRefresh();
        else supabase.auth.stopAutoRefresh();
      });
    }

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
      appState?.remove();
    };
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    registerDevice().catch(() => {
      // Offline or the database is not set up yet; the connection check reports it.
    });
  }, [userId]);

  const value = useMemo<SessionValue>(() => {
    const status: SessionStatus = !isConfigured
      ? 'unconfigured'
      : loading
        ? 'loading'
        : !session
          ? 'signedOut'
          : recovering
            ? 'recovery'
            : 'signedIn';
    return {
      status,
      session,
      user: session?.user ?? null,
      beginRecovery,
      finishRecovery,
    };
  }, [loading, session, recovering, beginRecovery, finishRecovery]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
