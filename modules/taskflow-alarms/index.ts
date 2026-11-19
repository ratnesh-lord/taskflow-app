/**
 * The app's handle on the Android alarm runtime (android/…/AlarmRuntime.kt).
 * In a browser, or a build without the module, `alarms` is null and the app
 * says reminders are not delivered there.
 */
import { type EventSubscription, requireOptionalNativeModule } from 'expo';

export type AlarmStatus = {
  notifications: boolean;
  exactAlarms: boolean;
  batteryUnrestricted: boolean;
  sdk: number;
  manufacturer: string;
  planned: number;
  /** When the next notification is due (ms), or null. */
  next: number | null;
};

type Native = {
  setPlan(json: string): Promise<{ alarms: number; next: number | null }>;
  takeActions(): Promise<string>;
  status(): Promise<AlarmStatus>;
  test(seconds: number): Promise<number>;
  openSettings(kind: 'notifications' | 'exactAlarms' | 'battery' | 'app'): void;
  requestNotificationPermission(): Promise<{ granted?: boolean; status?: string; canAskAgain?: boolean }>;
  addListener(event: 'onAction', listener: () => void): EventSubscription;
};

export const alarms: Native | null = requireOptionalNativeModule<Native>('TaskflowAlarms');
