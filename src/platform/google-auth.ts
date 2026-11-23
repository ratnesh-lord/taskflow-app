/**
 * Google access on the phone: Google Play services shows Google's own account
 * picker and consent screen (modules/taskflow-google). It keeps the token;
 * TaskFlow asks for it before each use and stores nothing. The web version
 * is google-auth.web.ts.
 */
import type { TokenSource } from '@/data/google';

import { googleNative } from '../../modules/taskflow-google';

export const googleOnDevice = googleNative !== null;

/** Why Google cannot be used here, or null. */
export const googleUnavailable: string | null = googleNative ? null : 'This build of TaskFlow does not include Google access.';

/** Google's answer when the Android client is missing in Google Cloud, or its fingerprint does not match. */
function friendly(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (/\b10:|DEVELOPER_ERROR/.test(message)) {
    return new Error('Google does not recognise this app yet. Add its Android client in Google Cloud (SETUP.md, "Google integrations").');
  }
  if (/\b7:|NETWORK_ERROR/.test(message)) return new Error('Could not reach Google. Check the connection and try again.');
  return new Error(`Google: ${message}`);
}

export const tokenSource: TokenSource = {
  async token(scopes, interactive) {
    if (!googleNative) return null;
    try {
      const grant = await googleNative.authorize(scopes, interactive);
      return grant?.accessToken ?? null;
    } catch (e) {
      throw friendly(e);
    }
  },
  async forget(token) {
    await googleNative?.clearToken(token).catch(() => undefined);
  },
};

/** Nothing to load on the phone. */
export function preloadGoogle(): Promise<void> {
  return Promise.resolve();
}
