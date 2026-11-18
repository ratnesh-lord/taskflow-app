import { View } from 'react-native';

import { localDateOf, minutesToTime } from '@/core/dates';
import { env } from '@/platform/env';
import { useData, useSync } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { dayLabelOrTime, plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const TABLE_WORDS: Record<string, string> = {
  tasks: 'a task', projects: 'a project', categories: 'a category', tags: 'a tag', subtasks: 'a subtask',
  reminders: 'a reminder', task_occurrences: 'a repeat', task_tags: 'a tag on a task', attachments: 'a link',
  saved_filters: 'a saved filter', profiles: 'your profile', calendar_links: 'a calendar link',
};

/** Sync status in More: when it last worked, what is waiting, what went wrong, and Sync now. */
export function SyncPanel() {
  const { data } = useData();
  const sync = useSync();
  const { now } = useNow();
  const { colors } = useTheme();
  const when = (iso: string) => dayLabelOrTime(localDateOf(new Date(iso)), timeOf(iso), now.date);

  const waiting = data.pendingEdits;
  let line: string;
  let tone: 'text' | 'overdue' | 'textSecondary' = 'textSecondary';
  if (sync.phase === 'syncing') line = 'Syncing…';
  else if (sync.phase === 'offline') {
    line = `Not synced: ${sync.error ?? 'no connection'}.${sync.retryAt ? ` Trying again at ${when(sync.retryAt)}.` : ''}`;
    tone = 'overdue';
  } else if (sync.lastSyncedAt) line = `Synced with your account ${when(sync.lastSyncedAt)}.`;
  else line = 'Not synced yet on this device.';

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color="textSecondary">
        Sync
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Icon
          name={sync.phase === 'offline' ? 'close' : sync.phase === 'syncing' ? 'repeat' : 'check'}
          color={sync.phase === 'offline' ? colors.overdue : sync.phase === 'syncing' ? colors.textSecondary : colors.completed}
          size={18}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="small" color={tone} accessibilityLiveRegion="polite">
            {line}
          </Text>
          <Text variant="caption" color="textSecondary">
            {waiting ? `${plural(waiting, 'change')} on this device waiting to be sent.` : 'Every change on this device has been sent.'}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" label="Sync now" busyLabel="Syncing…" busy={sync.phase === 'syncing'} onPress={sync.syncNow} />
      </View>

      {sync.problems.length ? (
        <View style={{ gap: space.xs, borderLeftWidth: 3, borderLeftColor: colors.overdue, paddingLeft: space.md }}>
          <Text variant="smallStrong">
            {plural(sync.problems.length, 'change')} could not be saved to your account
          </Text>
          {sync.problems.slice(0, 5).map((p, i) => (
            <Text key={i} variant="caption" color="textSecondary">
              {when(p.at)}: {TABLE_WORDS[p.table] ?? p.table}. {p.error}
            </Text>
          ))}
          <Text variant="caption" color="textSecondary">
            They stay on this device only. This usually means the item they belong to was deleted on another device.
          </Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Button variant="quiet" label="Clear this list" onPress={sync.clearProblems} style={{ paddingHorizontal: 0 }} />
          </View>
        </View>
      ) : null}

      <Text variant="caption" color="textSecondary">
        Changes sync on their own within seconds while you are online, and wait on this device while you are not. Account data is kept at {env.supabaseUrl.replace(/^https?:\/\//, '')}.
      </Text>
    </View>
  );
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return minutesToTime(d.getHours() * 60 + d.getMinutes());
}
