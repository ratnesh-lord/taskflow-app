/**
 * Connection check: proves from this device that sign-in, row-level security
 * and both sync functions work against the real database.
 *
 * It registers the device, pushes one real edit (the profile's timezone, set
 * to this device's), then pulls and looks for the profile coming back.
 * The full sync engine replaces this in Phase 4.
 */
import { HybridClock, type ClockState } from '@/core/hlc';

import { getDeviceId, registerDevice } from './device';
import { kv } from './kv';
import { getSupabase } from './supabase';

const CLOCK_KEY = 'taskflow.clock';

export type CheckStep = { label: string; ok: boolean; detail: string };
export type SyncCheck = { ok: boolean; steps: CheckStep[] };

type PushResponse = { results?: { status?: string; error?: string }[]; rev?: number };
type PullResponse = {
  reset?: boolean;
  rev?: number;
  changes?: { profiles?: { id: string; email?: string | null; timezone?: string; field_ts?: Record<string, string> }[] };
};

async function loadClock(deviceId: string): Promise<HybridClock> {
  let state: ClockState | undefined;
  try {
    const raw = await kv.getItem(CLOCK_KEY);
    if (raw) state = JSON.parse(raw) as ClockState;
  } catch {
    state = undefined;
  }
  return new HybridClock(deviceId, Date.now, state);
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function runSyncCheck(): Promise<SyncCheck> {
  const steps: CheckStep[] = [];
  const add = (label: string, ok: boolean, detail: string) => {
    steps.push({ label, ok, detail });
    return ok;
  };
  const done = (): SyncCheck => ({ ok: steps.every((s) => s.ok), steps });

  const supabase = getSupabase();

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const user = sessionData.session?.user;
  if (!add('Signed in', !sessionError && !!user, user?.email ?? sessionError?.message ?? 'No session')) {
    return done();
  }

  let deviceId = '';
  try {
    deviceId = await getDeviceId();
    await registerDevice();
    add('Device registered', true, deviceId.slice(0, 8));
  } catch (e) {
    add('Device registered', false, e instanceof Error ? e.message : 'Failed');
    return done();
  }

  const clock = await loadClock(deviceId);
  const timezone = deviceTimezone();
  const { data: pushData, error: pushError } = await supabase.rpc('sync_push', {
    p_device_id: deviceId,
    p_ops: [{ table: 'profiles', id: user!.id, patch: { timezone }, ts: clock.now() }],
  });
  await kv.setItem(CLOCK_KEY, JSON.stringify(clock.snapshot()));
  const push = (pushData ?? {}) as PushResponse;
  const pushStatus = push.results?.[0]?.status;
  const pushOk = !pushError && (pushStatus === 'applied' || pushStatus === 'stale');
  if (
    !add(
      'Edit pushed',
      pushOk,
      pushError?.message ?? push.results?.[0]?.error ?? `${pushStatus}, revision ${push.rev ?? '?'}`,
    )
  ) {
    return done();
  }

  const { data: pullData, error: pullError } = await supabase.rpc('sync_pull', { p_since: 0, p_limit: 200 });
  const pull = (pullData ?? {}) as PullResponse;
  const profile = pull.changes?.profiles?.find((p) => p.id === user!.id);
  for (const stamp of Object.values(profile?.field_ts ?? {})) clock.receive(stamp);
  await kv.setItem(CLOCK_KEY, JSON.stringify(clock.snapshot()));
  add(
    'Profile pulled back',
    !pullError && !!profile && profile.timezone === timezone,
    pullError?.message ?? (profile ? `${profile.timezone}, revision ${pull.rev ?? '?'}` : 'Profile missing from the pull'),
  );

  return done();
}
