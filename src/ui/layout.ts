import { useWindowDimensions } from 'react-native';

import { SIDEBAR_FROM_WIDTH } from './tokens';

/** True on a wide window (desktop browser, tablet): the tabs show as a sidebar on the left. */
export function useSidebar(): boolean {
  return useWindowDimensions().width >= SIDEBAR_FROM_WIDTH;
}
