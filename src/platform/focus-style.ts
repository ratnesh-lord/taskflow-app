import { Platform } from 'react-native';

/**
 * Browsers draw the keyboard focus ring with rounded corners. On the web this
 * replaces it with a square ring in the accent colour, so focus stays visible
 * without breaking the square-corner rule. Text fields draw their own focus line.
 */
export function setWebFocusStyle(accent: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  let el = document.getElementById('taskflow-focus') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'taskflow-focus';
    document.head.appendChild(el);
  }
  el.textContent =
    `*:focus { outline: none; }\n` +
    `*:focus-visible { outline: 2px solid ${accent}; outline-offset: 2px; }\n` +
    `input:focus-visible, textarea:focus-visible { outline: none; }`;
}
