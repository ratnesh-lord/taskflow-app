/**
 * Small key-value store for this device.
 * Android/iOS: Expo SecureStore (encrypted with a key held in the Android Keystore).
 * Web: see kv.web.ts.
 *
 * Keys may only contain letters, digits, ".", "-" and "_".
 */
import * as SecureStore from 'expo-secure-store';

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export const kv: KeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
