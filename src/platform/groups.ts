/**
 * The group functions, called on Supabase as the signed-in user. They need a
 * connection; their messages are written for people and shown as they are.
 */
import { GroupService } from '@/data/groups';

import { getSupabase } from './supabase';

function plain(message: string | undefined): Error {
  const m = message ?? '';
  if (/fetch|network|timed? ?out|connection|offline/i.test(m)) return new Error('No connection: groups need the internet');
  if (/jwt|token|not signed in|401/i.test(m)) return new Error('Your sign-in has expired; sign in again');
  return new Error(m || 'The server did not answer');
}

export const groupService = new GroupService(async (fn, args) => {
  let result: { data: unknown; error: { message: string } | null };
  try {
    result = await getSupabase().rpc(fn, args);
  } catch (e) {
    throw plain(e instanceof Error ? e.message : String(e));
  }
  if (result.error) throw plain(result.error.message);
  return result.data;
});
