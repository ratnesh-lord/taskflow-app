/**
 * Build-time settings. Expo replaces process.env.EXPO_PUBLIC_* with the
 * values from .env (or the CI environment) when it bundles the app.
 *
 * The Supabase key here is the public one (publishable / anon). It is safe to
 * ship: row-level security decides what a signed-in user can touch. The
 * service-role key must never appear in the app.
 */
const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const supabaseKey = (process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '').trim();

export const env = { supabaseUrl, supabaseKey } as const;

/** A real project is always https. Plain http is accepted only for a database running on this machine. */
export function checkConfig(url: string, key: string): boolean {
  const remote = /^https:\/\/[^\s/]+$/.test(url);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url);
  return (remote || local) && key.length >= 20 && !/\s/.test(key);
}

/** False until both values are present; the app then shows a setup screen instead of crashing. */
export const isConfigured = checkConfig(supabaseUrl, supabaseKey);
