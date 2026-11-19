import Constants from 'expo-constants';
import { useState } from 'react';
import { View } from 'react-native';

import { type Backup, backupCounts, BackupError, backupFileName, readBackup } from '@/data/backup';
import type { TableName } from '@/data/schema';
import { pickTextFile, saveTextFile } from '@/platform/files';
import { useData, useNotice, useRun } from '@/state/data';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const NAMES: Partial<Record<TableName, [string, string]>> = {
  tasks: ['task', 'tasks'],
  projects: ['project', 'projects'],
  categories: ['category', 'categories'],
  tags: ['tag', 'tags'],
  subtasks: ['subtask', 'subtasks'],
  reminders: ['reminder', 'reminders'],
  task_occurrences: ['repeat record', 'repeat records'],
  attachments: ['link', 'links'],
  saved_filters: ['saved filter', 'saved filters'],
};

/** Export everything to a file, and restore from one. */
export function BackupPanel() {
  const { actions } = useData();
  const { notify } = useNotice();
  const run = useRun();
  const [busy, setBusy] = useState<'export' | 'pick' | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);

  async function exportAll() {
    setBusy('export');
    try {
      const backup = await actions.exportBackup(Constants.expoConfig?.version);
      const name = backupFileName(backup.exported_at);
      const how = await saveTextFile(name, JSON.stringify(backup, null, 1));
      if (how === 'saved') notify(`Saved ${name} to your downloads.`);
    } catch (e) {
      notify(`Could not export: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    }
    setBusy(null);
  }

  async function chooseFile() {
    setBusy('pick');
    try {
      const text = await pickTextFile();
      if (text !== null) setPending(readBackup(text));
    } catch (e) {
      notify(e instanceof BackupError ? e.message : `Could not open the file: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    }
    setBusy(null);
  }

  const counts = pending ? backupCounts(pending) : {};
  const summary = Object.entries(NAMES)
    .filter(([t]) => counts[t as TableName])
    .map(([t, [one, many]]) => plural(counts[t as TableName]!, one, many));

  return (
    <View style={{ gap: space.sm }}>
      <Text variant="label" color="textSecondary">
        Backup
      </Text>
      <Text variant="small" color="textSecondary">
        One file with every task, project, category, tag, subtask, reminder and saved filter. Keep it somewhere safe; restore it here or on any device signed in to your account.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button variant="secondary" label="Export all data" busyLabel="Exporting…" busy={busy === 'export'} disabled={busy !== null} onPress={exportAll} />
        <Button variant="secondary" label="Restore from a backup" busyLabel="Opening…" busy={busy === 'pick'} disabled={busy !== null} onPress={chooseFile} />
      </View>

      <Sheet
        visible={pending !== null}
        title="Restore backup"
        onClose={() => setPending(null)}
        footer={
          <Button
            label="Restore"
            onPress={async () => {
              const b = pending!;
              setPending(null);
              const result = await run(() => actions.restoreBackup(b));
              if (result) notify(result.changed ? 'Backup restored.' : 'Nothing to restore: everything already matches the backup.', { undo: result.changed ? result.undo : undefined });
            }}
          />
        }>
        <Text variant="bodyStrong">
          Backup from {pending?.exported_at ? new Date(pending.exported_at).toLocaleString() : 'an unknown date'}
        </Text>
        <Text variant="small">{summary.length ? `It holds ${summary.join(', ')}.` : 'It holds no items.'}</Text>
        <Text variant="small" color="textSecondary">
          Restoring brings each of these back to how it was in the backup, including ones deleted since. Anything made after the backup stays as it is. You can undo it straight afterwards, and the restored items sync to your other devices.
        </Text>
      </Sheet>
    </View>
  );
}
