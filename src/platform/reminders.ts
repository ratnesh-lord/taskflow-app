/**
 * The bridge between the app's data and the Android alarm runtime:
 *
 *   1. take in "Mark completed" taps made on notifications while the app was
 *      away, and save them (they then sync like any other edit);
 *   2. plan every notification for the next 30 days from the current data;
 *   3. hand the plan to the runtime, which fires it with the app closed.
 *
 * In a browser there is no runtime: reminders are saved and synced, but only
 * the Android app shows them.
 */
import { minutesToTime } from '@/core/dates';
import { closedSnoozes, planAlarms, readSummarySettings, type Snooze } from '@/core/alarms';
import type { Actions } from '@/data/actions';
import type { DataSnapshot } from '@/data/snapshot';
import { usesHour12 } from '@/ui/format';

import { alarms, type AlarmStatus } from '../../modules/taskflow-alarms';
import { pushWidgets } from './widgets';

export { type AlarmStatus } from '../../modules/taskflow-alarms';

export const remindersOnDevice = alarms !== null;

type Tap = { type: 'complete' | 'snooze'; taskId?: string | null; occurrenceDate?: string | null; at?: number };

/** Save the notification taps the runtime has queued. Returns the moment they were taken. */
export async function takeNotificationTaps(actions: Actions): Promise<{ taken: number; applied: number }> {
  if (!alarms) return { taken: Date.now(), applied: 0 };
  const taken = Date.now();
  let list: Tap[] = [];
  try {
    list = JSON.parse(await alarms.takeActions()) as Tap[];
  } catch {
    list = [];
  }
  let applied = 0;
  for (const tap of list) {
    // A snooze is handled entirely by the runtime; only completions change data.
    if (tap.type !== 'complete' || !tap.taskId) continue;
    try {
      if (await actions.completeFromNotification(tap.taskId, tap.occurrenceDate ?? null, new Date(tap.at ?? taken))) applied += 1;
    } catch {
      // A task that no longer exists: nothing to save.
    }
  }
  return { taken, applied };
}

let askedThisRun = false;

/**
 * Plan and hand over every notification, and the widgets' data.
 * Returns how many are planned and when the next one is.
 */
export async function replan(data: DataSnapshot, takenAt: number): Promise<{ alarms: number; next: number | null } | null> {
  if (!alarms) return null;
  const nowDate = new Date();
  const now = {
    date: `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`,
    minutes: nowDate.getHours() * 60 + nowDate.getMinutes(),
  };
  const projects = new Map(data.projects.map((p) => [p.id, p.name]));
  const plan = planAlarms(data, {
    now,
    nowMs: nowDate.getTime(),
    summaries: readSummarySettings(data.profile?.settings ?? {}),
    hour12: usesHour12(),
    projectName: (id) => projects.get(id),
  });
  // Widget data first: the plan below forgets taps older than [takenAt], and the
  // widgets hide rows ticked off on them until data reflecting the tap arrives.
  await pushWidgets(data, takenAt).catch(() => {});

  // A snooze outlives the plan, so one for a task completed or deleted since is cancelled here.
  let snoozes: Snooze[] = [];
  try {
    snoozes = JSON.parse(await alarms.snoozes()) as Snooze[];
  } catch {
    snoozes = [];
  }
  const closed = closedSnoozes(data, snoozes);
  const result = await alarms.setPlan(JSON.stringify({ version: 1, generatedAt: takenAt, alarms: plan, closedSnoozes: closed }));

  // Android 13 and later ask before showing any notification: ask when the first reminder is set.
  if (!askedThisRun && plan.some((a) => a.kind === 'reminder')) {
    askedThisRun = true;
    const status = await alarms.status();
    if (!status.notifications) await alarms.requestNotificationPermission().catch(() => null);
  }
  return result;
}

/** After signing out: no reminders or snoozes from the account go off, and its taps are dropped. */
export async function forgetAccountOnDevice(): Promise<void> {
  if (!alarms) return;
  let snoozes: Snooze[] = [];
  try {
    snoozes = JSON.parse(await alarms.snoozes()) as Snooze[];
  } catch {
    snoozes = [];
  }
  const closed = snoozes.filter((s) => s.taskId).map((s) => s.key);
  await alarms.setPlan(JSON.stringify({ version: 1, generatedAt: Date.now(), alarms: [], closedSnoozes: closed }));
  await alarms.takeActions();
}

export function alarmStatus(): Promise<AlarmStatus> | null {
  return alarms ? alarms.status() : null;
}

export function openAlarmSettings(kind: 'notifications' | 'exactAlarms' | 'battery' | 'app'): void {
  alarms?.openSettings(kind);
}

export async function askNotificationPermission(): Promise<boolean> {
  if (!alarms) return false;
  const r = await alarms.requestNotificationPermission();
  return r.granted === true || r.status === 'granted';
}

/** A real reminder through the whole path, a few seconds from now. */
export function sendTestReminder(seconds: number): Promise<number> | null {
  return alarms ? alarms.test(seconds) : null;
}

/** Called when a notification button is tapped while the app is running. */
export function onNotificationTap(listener: () => void): () => void {
  if (!alarms) return () => {};
  const sub = alarms.addListener('onAction', listener);
  return () => sub.remove();
}

export function describeNext(ms: number | null): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${minutesToTime(d.getHours() * 60 + d.getMinutes())}`;
}
