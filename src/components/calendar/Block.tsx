import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { titleWithEmoji } from '@/core/appearance';
import type { CalendarEntry } from '@/core/calendar';
import { minutesToTime } from '@/core/dates';
import { useLook } from '@/state/look';
import { useTheme } from '@/state/theme';
import { shortTime } from '@/ui/format';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

/** What an entry is called, for screen readers and the drag label. */
export function entryTitle(entry: CalendarEntry): string {
  return entry.kind === 'task' ? entry.item.task.title : entry.event.title;
}

export function useOpenEntry() {
  const router = useRouter();
  return (entry: CalendarEntry) => {
    if (entry.kind === 'task') router.push(`/task/${entry.item.task.id}`);
    else if (entry.event.link) void Linking.openURL(entry.event.link);
  };
}

/**
 * One task or event in the calendar. Tasks are filled (blue; red when
 * overdue; grey and struck through when done); Google events are outlined,
 * because TaskFlow only shows them.
 */
export function Block({ entry, compact, dragging, onPress }: { entry: CalendarEntry; compact?: boolean; dragging?: boolean; onPress: () => void }) {
  // Taps and drags come from the Draggable around it; screen readers activate it here.
  const { colors } = useTheme();
  const look = useLook();
  const task = entry.kind === 'task' ? entry : null;
  const done = task?.done ?? false;
  const overdue = task ? task.item.overdue : false;
  // The task's own colour (priority or project), else the accent; overdue tasks get a red edge.
  const own = task ? look.taskHex(task.item.task) : null;
  const fill = !task ? 'transparent' : done ? colors.divider : own ?? colors.accent;
  const ink = !task || done ? colors.text : own ? look.ink : colors.onAccent;
  const edge = !task ? colors.textSecondary : overdue && !done ? colors.overdue : fill;
  const time = entry.start != null ? shortTime(minutesToTime(entry.start)) : null;
  const label = `${entryTitle(entry)}${time ? `, ${time}` : ''}${task ? (done ? ', completed' : overdue ? ', overdue' : '') : `, ${entry.kind === 'event' ? entry.event.calendarName : ''} event`}`;

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={task && !done ? 'Opens the task. Touch and hold, then drag, to move it.' : undefined}
      accessibilityActions={ACTIVATE}
      onAccessibilityAction={onPress}
      style={[styles.block, { backgroundColor: fill, borderColor: edge, borderWidth: overdue && !done ? 2 : 1, opacity: dragging ? 0.35 : 1 }]}>
      <View style={styles.inner}>
        <Text
          variant="caption"
          numberOfLines={compact ? 1 : 2}
          style={[{ color: ink }, styles.title, done && { textDecorationLine: 'line-through', color: colors.textSecondary }]}>
          {entry.kind === 'task' ? titleWithEmoji(entry.item.task) : entryTitle(entry)}
        </Text>
        {!compact && time ? (
          <Text variant="caption" numberOfLines={1} style={{ color: done || !task ? colors.textSecondary : ink }}>
            {time}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const ACTIVATE = [{ name: 'activate' as const }];

const styles = StyleSheet.create({
  block: { flex: 1, borderWidth: 1, overflow: 'hidden' },
  inner: { paddingHorizontal: space.xs, paddingVertical: 2 },
  title: {},
});
