import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { kv } from '@/platform/kv';
import { type Colors, palette, type Scheme } from '@/ui/tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

type ThemeValue = {
  scheme: Scheme;
  colors: Colors;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const PREFERENCE_KEY = 'taskflow.theme';

const ThemeContext = createContext<ThemeValue>({
  scheme: 'light',
  colors: palette.light,
  preference: 'system',
  setPreference: () => {},
});

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Light or dark, following the phone unless the user chose otherwise. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let alive = true;
    kv.getItem(PREFERENCE_KEY)
      .then((stored) => {
        if (alive && isPreference(stored)) setPreferenceState(stored);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    kv.setItem(PREFERENCE_KEY, next).catch(() => {});
  }, []);

  const scheme: Scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeValue>(
    () => ({ scheme, colors: palette[scheme], preference, setPreference }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
