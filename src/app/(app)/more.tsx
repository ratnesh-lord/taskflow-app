import Constants from 'expo-constants';
import { useState } from 'react';
import { View } from 'react-native';

import { signOut } from '@/platform/auth';
import { env } from '@/platform/env';
import { runSyncCheck, type SyncCheck } from '@/platform/sync-check';
import { useSession } from '@/state/session';
import { type ThemePreference, useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function host(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export default function More() {
  const { user } = useSession();
  const { colors, preference, setPreference } = useTheme();
  const [check, setCheck] = useState<SyncCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const name = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '';

  async function runCheck() {
    setChecking(true);
    try {
      setCheck(await runSyncCheck());
    } catch (e) {
      setCheck({
        ok: false,
        steps: [{ label: 'Connection', ok: false, detail: e instanceof Error ? e.message : 'Could not reach the server' }],
      });
    }
    setChecking(false);
  }

  async function leave() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
  }

  return (
    <Screen>
      <PageHeader title="More" />
      <Divider />

      <View style={{ gap: space.xs }}>
        <Text variant="label" color="textSecondary">
          Account
        </Text>
        {name ? <Text variant="bodyStrong">{name}</Text> : null}
        <Text variant="body">{user?.email ?? 'Signed in'}</Text>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="label" color="textSecondary">
          Appearance
        </Text>
        <Segmented label="Appearance" value={preference} options={THEMES} onChange={setPreference} />
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="label" color="textSecondary">
          Connection
        </Text>
        <Text variant="small" color="textSecondary">
          Registers this device, pushes one edit and pulls it back from {host(env.supabaseUrl)}.
        </Text>
        <Button variant="secondary" label="Check connection" busyLabel="Checking…" busy={checking} onPress={runCheck} />
        {check ? (
          <View style={{ gap: space.sm }}>
            {check.steps.map((step) => (
              <View key={step.label} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
                <Icon name={step.ok ? 'check' : 'close'} color={step.ok ? colors.completed : colors.overdue} size={18} />
                <View style={{ flex: 1 }}>
                  <Text variant="smallStrong">{step.label}</Text>
                  <Text variant="caption" color="textSecondary">
                    {step.detail}
                  </Text>
                </View>
              </View>
            ))}
            <Notice tone={check.ok ? 'success' : 'error'}>
              {check.ok
                ? 'Sign-in, access rules and sync all work from this device.'
                : 'One step failed. The line marked with a cross says which.'}
            </Notice>
          </View>
        ) : null}
      </View>

      <Divider />

      <Button variant="secondary" label="Sign out" busyLabel="Signing out…" busy={signingOut} onPress={leave} />
      <Text variant="caption" color="textSecondary">
        TaskFlow {Constants.expoConfig?.version ?? ''}
      </Text>
    </Screen>
  );
}
