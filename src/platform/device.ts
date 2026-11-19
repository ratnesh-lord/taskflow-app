import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { kv } from './kv';
import { getSupabase } from './supabase';

const DEVICE_ID_KEY = 'taskflow.device_id';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let cached: string | null = null;

/** This installation's id: made once, then kept for as long as the app is installed. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  let id = await kv.getItem(DEVICE_ID_KEY);
  if (!id || !UUID.test(id)) {
    id = Crypto.randomUUID().toLowerCase();
    await kv.setItem(DEVICE_ID_KEY, id);
  }
  cached = id;
  return id;
}

/** This device's time zone name, such as Asia/Kolkata. */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function devicePlatform(): 'android' | 'ios' | 'web' {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'web' ? 'web' : 'android';
}

/** Tell the server this device belongs to the signed-in user. Safe to repeat. */
export async function registerDevice(): Promise<void> {
  const { error } = await getSupabase().rpc('register_device', {
    p_device_id: await getDeviceId(),
    p_platform: devicePlatform(),
    p_name: Constants.deviceName ?? '',
    p_app_version: Constants.expoConfig?.version ?? '',
  });
  if (error) throw new Error(error.message);
}

/** Forget this device on the server, so it stops receiving pushes for the account. */
export async function unregisterDevice(): Promise<void> {
  await getSupabase().from('devices').delete().eq('id', await getDeviceId());
}
