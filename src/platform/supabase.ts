import './polyfills';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env, isConfigured } from './env';
import { sessionStorage } from './session-storage';

let client: SupabaseClient | null = null;

/**
 * The one Supabase client for the app. Call only when isConfigured is true.
 *
 * - The session lives in encrypted storage on the phone.
 * - Sign-in redirects are handled by the app itself (see auth.ts), so the
 *   client is told not to look at the page URL.
 */
export function getSupabase(): SupabaseClient {
  if (!isConfigured) {
    throw new Error('Supabase is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY.');
  }
  client ??= createClient(env.supabaseUrl, env.supabaseKey, {
    auth: {
      storage: sessionStorage,
      storageKey: 'taskflow.auth',
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
