import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { TaskList } from '@/data/google';
import { useNotice, useRun } from '@/state/data';
import { useGoogle } from '@/state/google';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { plural } from '@/ui/format';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space, TOUCH } from '@/ui/tokens';

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** A labelled on/off row. */
function Toggle({ label, detail, on, busy, onChange }: { label: string; detail: string; on: boolean; busy?: boolean; onChange: (on: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.divider, opacity: busy ? 0.5 : 1 }]}>
      <Checkbox checked={on} label={label} onPress={() => !busy && onChange(!on)} />
      <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={() => !busy && onChange(!on)} style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="small" color="textSecondary">
          {detail}
        </Text>
      </Pressable>
    </View>
  );
}

/** More → Google: Calendar, Tasks and Drive. */
export default function GoogleScreen() {
  const google = useGoogle();
  const run = useRun();
  const { notify } = useNotice();
  const { colors } = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const work = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(name);
    try {
      return await run(fn);
    } finally {
      setBusy(null);
    }
  };

  const { settings, push } = google;

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader
        title="Google"
        subtitle={google.account ? `Connected on this device as ${google.account}.` : 'Not connected on this device. Each feature asks Google for permission the first time.'}
      />

      {!google.available ? (
        <Notice tone="info">{google.unavailableReason ?? 'Google is not available here.'}</Notice>
      ) : (
        <>
          <View>
            <SectionTitle>Google Calendar</SectionTitle>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
              <Toggle
                label="Tasks in Google Calendar"
                detail="Tasks with a date appear in a calendar named TaskFlow and stay up to date. Edit them in TaskFlow; changes made in Google Calendar are replaced."
                on={settings.calendarPush}
                busy={busy === 'push'}
                onChange={(on) => void work('push', () => google.setCalendarPush(on))}
              />
              <Toggle
                label="Show my Google events"
                detail="Your Google Calendar events appear, read-only, in Upcoming → Calendar."
                on={settings.showEvents}
                busy={busy === 'events'}
                onChange={(on) => void work('events', () => google.setShowEvents(on))}
              />
            </View>
            {settings.calendarPush ? (
              <View style={{ paddingTop: space.sm, gap: space.sm }}>
                <Text variant="small" color={push.state === 'error' ? 'overdue' : 'textSecondary'}>
                  {push.state === 'running' ? 'Updating the TaskFlow calendar…'
                    : push.state === 'error' ? (push.message ?? 'The last update failed.')
                    : push.state === 'done' && push.at && push.last
                      ? `Updated at ${time(push.at)}: ${push.last.added} added, ${push.last.changed} changed, ${push.last.removed} removed.`
                      : 'The TaskFlow calendar updates about 15 seconds after your tasks change.'}
                </Text>
                <View style={{ alignItems: 'flex-start' }}>
                  <Button variant="secondary" label="Update now" busy={push.state === 'running'} busyLabel="Updating…" onPress={() => void google.pushNow()} />
                </View>
              </View>
            ) : null}
          </View>

          <View>
            <SectionTitle>Google Tasks</SectionTitle>
            <View style={{ gap: space.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.md }}>
              {lists === null ? (
                <>
                  <Text variant="small" color="textSecondary">
                    Bring your Google Tasks lists into TaskFlow. Your first list goes to the Inbox; each other list becomes a project. Importing again adds only new tasks.
                  </Text>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Button
                      variant="secondary"
                      label="Import from Google Tasks…"
                      busy={busy === 'lists'}
                      busyLabel="Opening…"
                      onPress={() => void work('lists', google.taskLists).then((l) => {
                        if (!l) return;
                        setLists(l);
                        setChosen(new Set(l.map((x) => x.id)));
                      })}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text variant="small" color="textSecondary">
                    {lists.length ? 'Choose the lists to import.' : 'Your Google Tasks has no lists.'}
                  </Text>
                  {lists.map((l) => (
                    <View key={l.id} style={[styles.row, { borderBottomColor: colors.divider }]}>
                      <Checkbox
                        checked={chosen.has(l.id)}
                        label={l.title}
                        onPress={() => {
                          const next = new Set(chosen);
                          if (next.has(l.id)) next.delete(l.id);
                          else next.add(l.id);
                          setChosen(next);
                        }}
                      />
                      <Text variant="body" style={{ flex: 1 }}>
                        {l.title}
                      </Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button
                      label="Import"
                      disabled={chosen.size === 0}
                      busy={busy === 'import'}
                      busyLabel="Importing…"
                      onPress={() => void work('import', () => google.importLists(lists.filter((l) => chosen.has(l.id)), lists)).then((r) => {
                        if (!r) return;
                        setLists(null);
                        notify(r.tasks ? `Imported ${plural(r.tasks, 'task')} from Google Tasks.` : 'Nothing new to import.');
                      })}
                    />
                    <Button variant="secondary" label="Cancel" onPress={() => setLists(null)} />
                  </View>
                </>
              )}
              <Text variant="small" color="textSecondary" style={{ paddingTop: space.sm }}>
                Copy your open tasks to a list named TaskFlow in Google Tasks. Copying again updates that list: new tasks are added, completed ones ticked, deleted ones removed.
              </Text>
              <View style={{ alignItems: 'flex-start' }}>
                <Button
                  variant="secondary"
                  label="Copy my tasks to Google Tasks"
                  busy={busy === 'export'}
                  busyLabel="Copying…"
                  onPress={() => void work('export', google.exportTasks).then((r) => {
                    if (r) notify(`Google Tasks updated: ${r.added} added, ${r.changed} changed, ${r.removed} removed.`);
                  })}
                />
              </View>
            </View>
          </View>

          <View>
            <SectionTitle>Google Drive</SectionTitle>
            <Text variant="small" color="textSecondary" style={{ borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.md }}>
              On a task, tap “Attach a file” to upload a file from this device. It goes into a folder named TaskFlow attachments in your Drive, and the task links to it. TaskFlow can see only the files it uploaded.
            </Text>
          </View>

          {google.account ? (
            <View style={{ gap: space.sm }}>
              <SectionTitle>Access</SectionTitle>
              <Text variant="small" color="textSecondary">
                Disconnecting takes back TaskFlow&apos;s access to your Google account on every device and turns the calendar features off. What TaskFlow already put in Google stays there.
              </Text>
              <View style={{ alignItems: 'flex-start' }}>
                <Button variant="secondary" label="Disconnect Google" busy={busy === 'disconnect'} busyLabel="Disconnecting…" onPress={() => void work('disconnect', google.disconnect).then(() => notify('Google disconnected.'))} />
              </View>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, borderBottomWidth: 1, paddingVertical: space.sm },
});
