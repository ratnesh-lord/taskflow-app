import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { parseAuthUrl } from '@/core/auth-url';

import { unregisterDevice } from './device';
import { getSupabase } from './supabase';

export type AuthOutcome =
  | { ok: true; note?: string }
  | { ok: false; message: string; cancelled?: boolean };

type SupabaseAuthError = { message: string; code?: string };

/** Turns Supabase's error codes into sentences a person can act on. */
export function describeAuthError(error: SupabaseAuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'That email and password do not match an account.';
    case 'email_not_confirmed':
      return 'Confirm your email first: open the link we sent you, then sign in.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with that email already exists. Sign in instead.';
    case 'weak_password':
      return 'Choose a longer password (at least 8 characters).';
    case 'over_email_send_rate_limit':
      return 'Too many emails were requested. Wait a few minutes and try again.';
    case 'same_password':
      return 'The new password must differ from the old one.';
    default:
      return error.message || 'Something went wrong. Try again.';
  }
}

function fail(error: SupabaseAuthError): AuthOutcome {
  return { ok: false, message: describeAuthError(error) };
}

/** Where Supabase sends the user back to: taskflow://auth-callback on the phone. */
export function getRedirectUrl(): string {
  if (Platform.OS === 'web') {
    return `${window.location.origin}/auth-callback`;
  }
  return Linking.createURL('auth-callback');
}

export async function signInWithEmail(email: string, password: string): Promise<AuthOutcome> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password });
  return error ? fail(error) : { ok: true };
}

export async function signUpWithEmail(name: string, email: string, password: string): Promise<AuthOutcome> {
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: name.trim() }, emailRedirectTo: getRedirectUrl() },
  });
  if (error) return fail(error);
  if (!data.session) {
    return { ok: true, note: 'Check your inbox: open the confirmation link, then sign in.' };
  }
  return { ok: true };
}

export async function sendPasswordReset(email: string): Promise<AuthOutcome> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: getRedirectUrl(),
  });
  return error
    ? fail(error)
    : { ok: true, note: 'If that email has an account, a reset link is on its way.' };
}

export async function updatePassword(password: string): Promise<AuthOutcome> {
  const { error } = await getSupabase().auth.updateUser({ password });
  return error ? fail(error) : { ok: true };
}

/**
 * Google sign-in through the system browser.
 * Phone: opens a browser tab, and Google sends the user back to the app.
 * Web: the page itself goes to Google and returns to /auth-callback.
 */
export async function signInWithGoogle(): Promise<AuthOutcome> {
  const redirectTo = getRedirectUrl();
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: Platform.OS !== 'web',
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) return fail(error);
  if (Platform.OS === 'web') return { ok: true };
  if (!data.url) return { ok: false, message: 'Google sign-in could not be started.' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    return { ok: false, message: 'Google sign-in was cancelled.', cancelled: true };
  }
  return completeAuthFromUrl(result.url);
}

// The same link can reach the app twice (once from the browser tab, once as
// an app link), and a sign-in code only works once. Remember what is in flight.
const inFlight = new Map<string, Promise<AuthOutcome>>();

/** Finish a sign-in from the address Supabase sent the user back to. */
export function completeAuthFromUrl(url: string): Promise<AuthOutcome> {
  const params = parseAuthUrl(url);
  const key = params.code ?? params.accessToken ?? params.error;
  if (!key) {
    return Promise.resolve({ ok: false, message: 'That link did not contain a sign-in code.' });
  }
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<AuthOutcome> => {
    if (params.error) {
      return { ok: false, message: params.errorDescription ?? 'Sign-in was refused.' };
    }
    const auth = getSupabase().auth;
    if (params.code) {
      const { error } = await auth.exchangeCodeForSession(params.code);
      return error ? fail(error) : { ok: true };
    }
    if (params.accessToken && params.refreshToken) {
      const { error } = await auth.setSession({
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
      });
      return error ? fail(error) : { ok: true };
    }
    return { ok: false, message: 'That link did not contain a sign-in code.' };
  })();

  inFlight.set(key, run);
  return run;
}

/** Sign out on this device only; other devices stay signed in. */
export async function signOut(): Promise<void> {
  try {
    await unregisterDevice();
  } catch {
    // Offline: the server row is replaced the next time anyone signs in here.
  }
  await getSupabase().auth.signOut({ scope: 'local' });
}
