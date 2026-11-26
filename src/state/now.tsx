import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { type Now, nowFrom } from '@/core/dates';

type NowValue = { moment: Date; now: Now };

const NowContext = createContext<NowValue>({ moment: new Date(), now: nowFrom(new Date()) });

/**
 * The current minute, refreshed at each new minute while the app is on
 * screen, and at once when it comes back to the front. In the background the
 * clock stops, so the screens are not redrawn every minute for nobody.
 */
export function NowProvider({ children }: { children: ReactNode }) {
  const [moment, setMoment] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const current = new Date();
      timer = setTimeout(tick, 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 50);
    };
    const tick = () => {
      setMoment(new Date());
      schedule();
    };
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    if (AppState.currentState !== 'background') schedule();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        stop();
        tick();
      } else if (state === 'background') {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, []);

  const value = useMemo(() => ({ moment, now: nowFrom(moment) }), [moment]);
  return <NowContext.Provider value={value}>{children}</NowContext.Provider>;
}

export function useNow(): NowValue {
  return useContext(NowContext);
}
