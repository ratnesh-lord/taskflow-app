/**
 * Google access in the browser, with Google Identity Services' token client:
 * a Google pop-up asks for consent, and the token (valid for an hour) is kept
 * in memory only, so a reload asks again. Needs the web OAuth client id in
 * EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and the site's address among its
 * authorised JavaScript origins (SETUP.md).
 */
import type { TokenSource } from '@/data/google';

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

export const googleOnDevice = CLIENT_ID !== '';

export const googleUnavailable: string | null = CLIENT_ID
  ? null
  : 'Google is not set up for the web version of this build (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing).';

type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
type TokenClient = { requestAccessToken(overrides?: { prompt?: string; scope?: string }): void };
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string; scope: string; include_granted_scopes?: boolean;
        callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void;
      }): TokenClient;
    };
  };
};

let cached: { token: string; scopes: Set<string>; expires: number } | null = null;
let loading: Promise<Gis> | null = null;

/** Loads Google's script once; started early so a tap opens the pop-up at once. */
export function preloadGoogle(): Promise<Gis> {
  if (!CLIENT_ID) return Promise.reject(new Error(googleUnavailable ?? 'Google is not set up.'));
  if (loading) return loading;
  loading = new Promise<Gis>((resolve, reject) => {
    const existing = (window as unknown as { google?: Gis }).google;
    if (existing?.accounts?.oauth2) return resolve(existing);
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve((window as unknown as { google: Gis }).google);
    script.onerror = () => {
      loading = null;
      reject(new Error('Could not load Google sign-in. Check the connection.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export const tokenSource: TokenSource = {
  async token(scopes, interactive) {
    if (!CLIENT_ID) return null;
    if (cached && cached.expires > Date.now() + 60_000 && scopes.every((s) => cached!.scopes.has(s))) return cached.token;
    if (!interactive) return null;
    const gis = await preloadGoogle();
    return new Promise<string | null>((resolve, reject) => {
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: scopes.join(' '),
        include_granted_scopes: true,
        callback: (r) => {
          if (!r.access_token) return r.error === 'access_denied' ? resolve(null) : reject(new Error(`Google: ${r.error_description ?? r.error ?? 'no access'}`));
          cached = { token: r.access_token, scopes: new Set((r.scope ?? '').split(' ')), expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => (e.type === 'popup_closed' ? resolve(null) : reject(new Error(`Google: ${e.message ?? e.type ?? 'the pop-up failed'}`))),
      });
      client.requestAccessToken({ prompt: '' });
    });
  },
  async forget(token) {
    if (cached?.token === token) cached = null;
  },
};
