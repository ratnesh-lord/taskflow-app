/**
 * The end of a focus session on Android: the alarm runtime rings it from the
 * notification plan (src/core/alarms.ts), with the app open or closed, so
 * nothing is needed here.
 */
export const focusAlertKind: 'alarm' | 'browser' = 'alarm';

export async function prepareFocusAlert(): Promise<boolean> {
  return true;
}

/** Returns a function that cancels it. */
export function scheduleFocusAlert(_atMs: number, _title: string, _body: string): () => void {
  return () => {};
}
