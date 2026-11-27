import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { signOut } from '@/platform/auth';
import { widgetsOnDevice } from '@/platform/widgets';
import { BackupPanel } from '@/components/BackupPanel';
import { SyncPanel } from '@/components/SyncPanel';
import { cleanUsername, USERNAME_HINT } from '@/core/sharing';
import { NameSheet } from '@/components/NameSheet';
import { useData, useGroupCall } from '@/state/data';
import { useNow } from '@/state/now';
import { useSession } from '@/state/session';
import { type ThemePreference, useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Divider } from '@/ui/Divider';
import { plural } from '@/ui/format';
import { Notice } from '@/ui/Notice';
import { MenuRow } from '@/ui/Row';
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

export default function More() {
  const { data } = useData();
  const router = useRouter();
  const { user } = useSession();
  const { preference, setPreference } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [naming, setNaming] = useState(false);
  const call = useGroupCall();

  const { now } = useNow();
  const today = now.date;
  const activeGoals = data.goals.filter((g) => g.status === 'active').length;
  const activeHabits = data.habits.filter((h) => h.status === 'active').length;
  const name = typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '';

  async function leave() {
    // Unsent changes are kept in this account's database on the device and go up at the next sign-in.
    if (data.pendingEdits && !confirming) {
      setConfirming(true);
      return;
    }
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
        <Text variant="small" color="textSecondary">
          {data.me.username ? `Username: @${data.me.username}` : 'No username yet: choose one to share tasks with other people.'}
        </Text>
        <View style={{ alignItems: 'flex-start', paddingTop: space.xs }}>
          <Button variant="secondary" label={data.me.username ? 'Change username' : 'Choose a username'} onPress={() => setNaming(true)} />
        </View>
      </View>

      <View>
        <Text variant="label" color="textSecondary" style={{ paddingBottom: space.xs }}>
          People
        </Text>
        <MenuRow
          icon="people"
          label="Groups"
          detail={data.invites.length ? plural(data.invites.length, 'invitation') : data.groups.length ? String(data.groups.length) : undefined}
          onPress={() => router.push('/groups')}
        />
      </View>

      <View>
        <Text variant="label" color="textSecondary" style={{ paddingBottom: space.xs }}>
          Plan and review
        </Text>
        <MenuRow icon="sun" label="Plan my day" detail={data.notes.get(`day:${today}`)?.plannedAt ? 'Planned' : undefined} onPress={() => router.push('/plan')} />
        <MenuRow icon="review" label="Weekly review" onPress={() => router.push('/review')} />
        <MenuRow icon="chart" label="Analytics" onPress={() => router.push('/analytics')} />
        <MenuRow icon="grid" label="Eisenhower matrix" onPress={() => router.push('/matrix')} />
        <MenuRow icon="target" label="Goals" detail={activeGoals ? String(activeGoals) : undefined} onPress={() => router.push('/goals')} />
        <MenuRow icon="habit" label="Habits" detail={activeHabits ? String(activeHabits) : undefined} onPress={() => router.push('/habits')} />
        <MenuRow icon="timer" label="Focus timer" onPress={() => router.push('/focus')} />
        <MenuRow icon="note" label="Notes" onPress={() => router.push('/notes')} />
      </View>

      <View>
        <Text variant="label" color="textSecondary" style={{ paddingBottom: space.xs }}>
          Tasks
        </Text>
        <MenuRow icon="filter" label="All tasks and filters" detail={data.savedFilters.length ? plural(data.savedFilters.length, 'saved filter') : undefined} onPress={() => router.push('/all-tasks')} />
        <MenuRow icon="search" label="Search" onPress={() => router.push('/search')} />
        <MenuRow icon="check" label="Completed" onPress={() => router.push('/completed')} />
        <MenuRow icon="bell" label="Reminders and summaries" onPress={() => router.push('/reminders')} />
        {widgetsOnDevice ? <MenuRow icon="today" label="Home-screen widgets" onPress={() => router.push('/widgets')} /> : null}
        <MenuRow icon="tag" label="Colours" onPress={() => router.push('/colours')} />
        <MenuRow icon="calendar" label="Google Calendar, Tasks and Drive" onPress={() => router.push('/google')} />
        <MenuRow icon="tag" label="Categories" detail={data.categories.length ? String(data.categories.length) : undefined} onPress={() => router.push('/categories')} />
        <Text variant="caption" color="textSecondary" style={{ paddingTop: space.sm }}>
          Your tasks are saved on this device, so they work offline, and synced with your account.
        </Text>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="label" color="textSecondary">
          Appearance
        </Text>
        <Segmented label="Appearance" value={preference} options={THEMES} onChange={setPreference} />
      </View>

      <SyncPanel />

      <BackupPanel />

      <Divider />

      {confirming ? (
        <Notice tone="error">
          {`${plural(data.pendingEdits, 'change')} on this device ${data.pendingEdits === 1 ? 'has' : 'have'} not reached your account yet. ${data.pendingEdits === 1 ? 'It stays' : 'They stay'} here and ${data.pendingEdits === 1 ? 'is' : 'are'} sent when you sign in again on this device. Tap Sign out again to continue.`}
        </Notice>
      ) : null}
      <Button variant="secondary" label="Sign out" busyLabel="Signing out…" busy={signingOut} onPress={leave} />
      <Text variant="caption" color="textSecondary">
        TaskFlow {Constants.expoConfig?.version ?? ''}
      </Text>

      <NameSheet
        visible={naming}
        title="Your username"
        label="Username"
        initial={data.me.username ?? ''}
        saveLabel="Save username"
        plain
        maxLength={21}
        hint={USERNAME_HINT}
        onClose={() => setNaming(false)}
        onSave={async (text) => {
          const clean = cleanUsername(text);
          if (!clean) {
            await call(() => Promise.reject(new Error(`“${text}” cannot be a username. ${USERNAME_HINT}`)));
            return;
          }
          if (clean === data.me.username) {
            setNaming(false);
            return;
          }
          const saved = await call((g) => g.claimUsername(clean), `You are now @${clean}`);
          if (saved.ok) setNaming(false);
        }}
      />
    </Screen>
  );
}
