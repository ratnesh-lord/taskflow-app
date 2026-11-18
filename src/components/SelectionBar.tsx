import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRIORITIES, PRIORITY_LABEL, type Priority } from '@/core/types';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { plural } from '@/ui/format';
import { IconButton } from '@/ui/IconButton';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

import { DateSheet } from './DateSheet';
import { OptionSheet } from './OptionSheet';
import type { Selection } from './useTaskActions';

const NO_PROJECT = '__none__';

/** The actions for several chosen tasks: complete, reschedule, priority, project, delete. */
/** On screens without the tab bar, pass `bottomInset` to keep clear of the system navigation bar. */
export function SelectionBar({ selection, bottomInset }: { selection: Selection; bottomInset?: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const [sheet, setSheet] = useState<'date' | 'priority' | 'project' | null>(null);
  if (!selection.selecting) return null;

  const ids = selection.ids;
  const n = plural(ids.length, 'task');
  const finish = () => {
    setSheet(null);
    selection.clear();
  };

  return (
    <>
      <View
        accessibilityRole="toolbar"
        accessibilityLabel={`${n} selected`}
        style={[styles.bar, { backgroundColor: colors.text, bottom: bottomInset ? insets.bottom : 0 }]}>
        <Text variant="smallStrong" style={{ color: colors.background, flex: 1, paddingLeft: space.lg }}>
          {ids.length} selected
        </Text>
        <IconButton icon="check" label={`Complete ${n}`} color="background" onPress={() => { void run(() => actions.complete(ids), `Completed ${n}`); finish(); }} />
        <IconButton icon="calendar" label={`Reschedule ${n}`} color="background" onPress={() => setSheet('date')} />
        <IconButton icon="flag" label={`Set priority of ${n}`} color="background" onPress={() => setSheet('priority')} />
        <IconButton icon="projects" label={`Move ${n} to a project`} color="background" onPress={() => setSheet('project')} />
        <IconButton icon="trash" label={`Delete ${n}`} color="background" onPress={() => { void run(() => actions.deleteTasks(ids), `Deleted ${n}`); finish(); }} />
        <IconButton icon="close" label="Stop selecting" color="background" onPress={selection.clear} />
      </View>

      <DateSheet
        visible={sheet === 'date'}
        title={`Reschedule ${n}`}
        today={now.date}
        date={now.date}
        time={null}
        withTime={false}
        onClose={() => setSheet(null)}
        onPick={(date) => {
          void run(() => actions.reschedule(ids, date, undefined, 'occurrence'), `Rescheduled ${n}`);
          finish();
        }}
      />
      <OptionSheet<Priority>
        visible={sheet === 'priority'}
        title={`Priority of ${n}`}
        value={null}
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        onClose={() => setSheet(null)}
        onPick={(priority) => {
          void run(() => actions.updateTasks(ids, { priority }), `Priority set for ${n}`);
          finish();
        }}
      />
      <OptionSheet<string>
        visible={sheet === 'project'}
        title={`Move ${n}`}
        value={null}
        options={[{ value: NO_PROJECT, label: 'No project' }, ...data.projects.filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name }))]}
        onClose={() => setSheet(null)}
        onPick={(projectId) => {
          void run(() => actions.updateTasks(ids, { projectId: projectId === NO_PROJECT ? null : projectId }), `Moved ${n}`);
          finish();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', minHeight: 56 },
});
