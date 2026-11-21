/**
 * The app's handle on the Android alarm runtime (android/…/AlarmRuntime.kt)
 * and the home-screen widgets (android/…/Widgets.kt).
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

export type WidgetKind = 'today' | 'pending' | 'productivity' | 'next';

export type WidgetStatus = {
  /** The launcher can add a widget when asked (Android 8 and later, most launchers). */
  pinSupported: boolean;
  /** How many of each widget are on the home screen. */
  installed: Record<WidgetKind, number>;
};

type Native = {
  setPlan(json: string): Promise<{ alarms: number; next: number | null }>;
  takeActions(): Promise<string>;
  /** The waiting snoozes, as a JSON array of planned alarms. */
  snoozes(): Promise<string>;
  status(): Promise<AlarmStatus>;
  test(seconds: number): Promise<number>;
  openSettings(kind: 'notifications' | 'exactAlarms' | 'battery' | 'app'): void;
  requestNotificationPermission(): Promise<{ granted?: boolean; status?: string; canAskAgain?: boolean }>;
  setWidgetData(json: string): Promise<void>;
  setWidgetTheme(theme: 'light' | 'dark' | 'system'): Promise<void>;
  widgets(): Promise<WidgetStatus>;
  pinWidget(kind: WidgetKind): Promise<boolean>;
  addListener(event: 'onAction' | 'onWidgetRefresh', listener: () => void): EventSubscription;
};

export const alarms: Native | null = requireOptionalNativeModule<Native>('TaskflowAlarms');
