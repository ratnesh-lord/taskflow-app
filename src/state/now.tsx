import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { type Now, nowFrom } from '@/core/dates';

type NowValue = { moment: Date; now: Now };

const NowContext = createContext<NowValue>({ moment: new Date(), now: nowFrom(new Date()) });

/** The current minute, refreshed every minute and when the app comes back to the front. */
export function NowProvider({ children }: { children: ReactNode }) {
  const [moment, setMoment] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = new Date();
      setMoment(current);
      timer = setTimeout(tick, 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 50);
    };
    timer = setTimeout(tick, 60_000 - (new Date().getSeconds() * 1000) + 50);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setMoment(new Date());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);

  const value = useMemo(() => ({ moment, now: nowFrom(moment) }), [moment]);
  return <NowContext.Provider value={value}>{children}</NowContext.Provider>;
}

export function useNow(): NowValue {
  return useContext(NowContext);
}
