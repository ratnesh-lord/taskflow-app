/**
 * The bridge between the app's data and the Android home-screen widgets
 * (modules/taskflow-alarms/…/Widgets.kt). The app works out what the widgets
 * show (src/core/widgets.ts) whenever its data changes and hands it over;
 * the widgets draw it with the app closed.
 *
 * In a browser there are no widgets: every function here does nothing.
 */
import { localDateOf, nowFrom } from '@/core/dates';
import { widgetData } from '@/core/widgets';
import type { DataSnapshot } from '@/data/snapshot';
import { usesHour12 } from '@/ui/format';

import { alarms, type WidgetKind, type WidgetStatus } from '../../modules/taskflow-alarms';

export type { WidgetKind, WidgetStatus } from '../../modules/taskflow-alarms';

export const widgetsOnDevice = alarms !== null;

const toLocal = (iso: string) => localDateOf(new Date(iso));

/** Send today's and tomorrow's widget data. [takenAt] is when notification and widget taps were last taken in. */
export async function pushWidgets(data: DataSnapshot, takenAt: number): Promise<void> {
  if (!alarms) return;
  const moment = new Date();
  const payload = widgetData(data, { now: nowFrom(moment), nowMs: takenAt, toLocal, hour12: usesHour12() });
  await alarms.setWidgetData(JSON.stringify(payload));
}

/** After signing out the widgets show nothing from the account. */
export async function clearWidgets(): Promise<void> {
  if (!alarms) return;
  await alarms.setWidgetData(JSON.stringify({ version: 1, generatedAt: Date.now(), signedIn: false }));
}

/** The app's Appearance setting, which the widgets follow too. */
export function setWidgetTheme(theme: 'light' | 'dark' | 'system'): void {
  alarms?.setWidgetTheme(theme).catch(() => {});
}

export function widgetStatus(): Promise<WidgetStatus> | null {
  return alarms ? alarms.widgets() : null;
}

/** Ask the launcher to add a widget; it shows its own confirmation. False when it cannot. */
export async function pinWidget(kind: WidgetKind): Promise<boolean> {
  if (!alarms) return false;
  return alarms.pinWidget(kind).catch(() => false);
}

/** Refresh was tapped on a widget while the app is running. */
export function onWidgetRefresh(listener: () => void): () => void {
  if (!alarms) return () => {};
  const sub = alarms.addListener('onWidgetRefresh', listener);
  return () => sub.remove();
}
