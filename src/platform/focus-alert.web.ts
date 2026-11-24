/**
 * The end of a focus session in a browser. There is no alarm runtime on the
 * web, so the open page shows a browser notification at the end (when the
 * person allows notifications). With the tab closed nothing rings.
 */
export const focusAlertKind: 'alarm' | 'browser' = 'browser';

/** Ask for permission to notify; call from a tap. True when notifications may be shown. */
export async function prepareFocusAlert(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export function scheduleFocusAlert(atMs: number, title: string, body: string): () => void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return () => {};
  const timer = setTimeout(() => {
    try {
      new Notification(title, { body, tag: 'taskflow-focus' });
    } catch {
      // Some browsers only allow notifications from a service worker; the page itself still shows the end.
    }
  }, Math.max(0, atMs - Date.now()));
  return () => clearTimeout(timer);
}
