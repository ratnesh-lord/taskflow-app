/**
 * The phone's side of the line to Supabase for syncing:
 *
 *   transport       sync_push and sync_pull, called as the signed-in user, so
 *                   row-level security applies to every row.
 *   watchAccount    a Realtime subscription to this account's sync_state row.
 *                   Its revision goes up whenever any device saves a change;
 *                   when another device did it, this one pulls.
 */
import type { PullReply, PushOp, PushReply, SyncTransport } from '@/data/sync';

import { getSupabase } from './supabase';

/** A problem reaching the server, put in plain words. */
function failure(message: string | undefined): Error {
  const m = message ?? '';
  if (/fetch|network|timed? ?out|connection|offline/i.test(m)) return new Error('No connection');
  if (/jwt|token|not signed in|401/i.test(m)) return new Error('Your sign-in has expired; sign in again');
  return new Error(m || 'The server did not answer');
}

export const supabaseTransport: SyncTransport = {
  async push(deviceId: string, ops: PushOp[]): Promise<PushReply> {
    try {
      const { data, error } = await getSupabase().rpc('sync_push', { p_device_id: deviceId, p_ops: ops });
      if (error) throw failure(error.message);
      return data as PushReply;
    } catch (e) {
      throw e instanceof Error && e.message === 'No connection' ? e : failure(e instanceof Error ? e.message : String(e));
    }
  },
  async pull(since: number, limit: number): Promise<PullReply> {
    try {
      const { data, error } = await getSupabase().rpc('sync_pull', { p_since: since, p_limit: limit });
      if (error) throw failure(error.message);
      return data as PullReply;
    } catch (e) {
      throw e instanceof Error && e.message === 'No connection' ? e : failure(e instanceof Error ? e.message : String(e));
    }
  },
};

/**
 * Calls `onRemoteChange` when another device saves a change to this account.
 * Returns a function that stops listening.
 */
export function watchAccount(userId: string, deviceId: string, onRemoteChange: () => void): () => void {
  const supabase = getSupabase();
  const channel = supabase
    .channel(`sync-state-${userId}-${deviceId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sync_state', filter: `user_id=eq.${userId}` },
      (payload: { new?: { origin_device?: string | null } }) => {
        if (payload.new?.origin_device !== deviceId) onRemoteChange();
      },
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
