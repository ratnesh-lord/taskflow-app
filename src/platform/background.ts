/**
 * Work done with the app closed: about every half hour, when Android allows,
 * the app syncs, replans its notifications and updates the widgets. A tap on
 * a widget runs this straight away (WidgetSyncWorker in the widget runtime). So a reminder added on another
 * device reaches this phone's alarms without the app being opened.
 *
 * Android decides the timing (at least 15 minutes apart, often longer while
 * the phone is idle). This file is imported by the root layout so the task is
 * defined whenever the JavaScript starts, including in the background.
 */
import * as Crypto from 'expo-crypto';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { Actions } from '@/data/actions';
import { checkAssignments } from '@/data/assignments';
import { openExpoDb } from '@/data/expo-db';
import { loadSnapshot } from '@/data/snapshot';
import { Store } from '@/data/store';
import { SyncEngine } from '@/data/sync';

import { getDeviceId } from './device';
import { remindersOnDevice, replan, takeNotificationTaps } from './reminders';
import { getSupabase } from './supabase';
import { supabaseTransport } from './sync';

const TASK = 'taskflow-background-sync';

/**
 * When the app's screens are running, they already hold the database open;
 * the background task then asks them to do the work instead of opening a
 * second connection with its own edit clock.
 */
let inApp: (() => Promise<void>) | null = null;
export function setForegroundWorker(worker: (() => Promise<void>) | null): void {
  inApp = worker;
}

export async function backgroundWork(): Promise<'done' | 'signed-out'> {
  if (inApp) {
    await inApp();
    return 'done';
  }
  const { data } = await getSupabase().auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return 'signed-out';
  const deviceId = await getDeviceId();
  const store = await Store.open(await openExpoDb(`taskflow-${userId}.db`), { userId, deviceId });
  try {
    const actions = new Actions(store, { newId: () => Crypto.randomUUID().toLowerCase() });
    const { taken } = await takeNotificationTaps(actions);
    await new SyncEngine(store, supabaseTransport, { deviceId }).run();
    if (remindersOnDevice) {
      const snapshot = await loadSnapshot(store);
      const { notices } = await checkAssignments(store, snapshot, Date.now());
      await replan(snapshot, taken, notices);
    }
  } finally {
    await store.close();
  }
  return 'done';
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask(TASK, async () => {
    try {
      await backgroundWork();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Ask Android to run the background work from now on (once per install; harmless to repeat). */
export async function registerBackgroundWork(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
    if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
  } catch {
    // Not available on this build: the app still syncs and plans whenever it is opened.
  }
}
