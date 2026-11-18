import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { TaskItem } from '@/core/agenda';
import { dayLabel, type LocalDate } from '@/core/dates';
import type { Priority } from '@/core/types';
import { useTheme } from '@/state/theme';
import { Checkbox } from '@/ui/Checkbox';
import { shortTime } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

export type RowInfo = {
  projectName?: string | null;
  tagNames?: string[];
  subtasks?: { done: number; total: number };
  hasReminder?: boolean;
};

export type TaskRowProps = {
  item: TaskItem;
  info: RowInfo;
  today: LocalDate;
  /** What the left column shows: the time (lists of one day) or the day. */
  lead: 'time' | 'date';
  selecting?: boolean;
  selected?: boolean;
  onToggle: (item: TaskItem) => void;
  onOpen: (item: TaskItem) => void;
  onSelect: (item: TaskItem) => void;
};

export function PriorityMark({ priority }: { priority: Priority }) {
  const { colors } = useTheme();
  if (priority === 'low') return <View style={styles.markSpace} />;
  const label = `${priority.charAt(0).toUpperCase()}${priority.slice(1)} priority`;
  const style =
    priority === 'critical' ? { backgroundColor: colors.accent }
    : priority === 'high' ? { backgroundColor: colors.text }
    : { borderWidth: 1.5, borderColor: colors.text };
  return <View role="img" accessibilityLabel={label} aria-label={label} style={[styles.mark, style]} />;
}

function leadText(item: TaskItem, today: LocalDate, lead: 'time' | 'date'): string {
  if (lead === 'time') return item.time ? shortTime(item.time) : '';
  if (!item.date) return '';
  const label = dayLabel(item.date, today);
  return label.length > 9 ? label.slice(0, 3) + label.slice(label.indexOf(' ')) : label.slice(0, 9);
}

export const TaskRow = memo(function TaskRow({ item, info, today, lead, selecting, selected, onToggle, onOpen, onSelect }: TaskRowProps) {
  const { colors } = useTheme();
  const done = !item.open;
  const red = item.overdue && !done;
  const meta: string[] = [];
  if (lead === 'time' && item.date && item.date !== today && item.overdue) meta.push(dayLabel(item.date, today));
  if (lead === 'date' && item.time) meta.push(shortTime(item.time));
  if (info.projectName) meta.push(info.projectName);
  if (info.subtasks?.total) meta.push(`${info.subtasks.done}/${info.subtasks.total}`);
  if (info.tagNames?.length) meta.push(info.tagNames.map((t) => `#${t}`).join(' '));
  if (item.task.estimatedMinutes) meta.push(`${item.task.estimatedMinutes} min`);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.task.title}${item.date ? `, ${dayLabel(item.date, today)}` : ''}${item.time ? ` ${shortTime(item.time)}` : ''}${red ? ', overdue' : ''}${done ? ', completed' : ''}`}
      aria-selected={selecting ? !!selected : undefined}
      onPress={() => (selecting && !item.projected ? onSelect(item) : onOpen(item))}
      onLongPress={item.projected ? undefined : () => onSelect(item)}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.divider },
        selected && { backgroundColor: colors.divider },
        pressed && !selecting && { opacity: 0.7 },
      ]}>
      <Text variant="caption" numberOfLines={1} style={[styles.lead, { color: red ? colors.overdue : colors.textSecondary }]}>
        {leadText(item, today, lead)}
      </Text>
      {item.projected ? (
        // A later occurrence: it can be opened, not ticked off before its turn.
        <View style={styles.selectBox} accessibilityLabel="Later repeat">
          <Icon name="repeat" color={colors.textSecondary} size={16} />
        </View>
      ) : selecting ? (
        <View style={styles.selectBox}>
          <View style={[styles.box, { borderColor: colors.text }, selected && { backgroundColor: colors.text }]}>
            {selected ? <Icon name="check" color={colors.background} size={14} /> : null}
          </View>
        </View>
      ) : (
        <Checkbox checked={done} alert={red} label={`${done ? 'Reopen' : 'Complete'}: ${item.task.title}`} onPress={() => onToggle(item)} />
      )}
      <View style={styles.body}>
        <Text
          variant="bodyStrong"
          numberOfLines={2}
          style={done ? { color: colors.textSecondary, textDecorationLine: 'line-through' } : undefined}>
          {item.task.title}
        </Text>
        {meta.length || item.repeating || info.hasReminder ? (
          <View style={styles.meta}>
            {item.repeating ? <Icon name="repeat" color={colors.textSecondary} size={13} /> : null}
            {info.hasReminder && !done ? <Icon name="bell" color={colors.accent} size={13} /> : null}
            <Text variant="caption" numberOfLines={1} style={{ flex: 1, color: red ? colors.overdue : colors.textSecondary }}>
              {meta.join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>
      <PriorityMark priority={item.task.priority} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingRight: space.md,
  },
  lead: { width: 56, paddingLeft: space.xs, fontVariant: ['tabular-nums'] },
  body: { flex: 1, minWidth: 0, gap: 2, paddingVertical: space.sm, paddingRight: space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mark: { width: 8, height: 8 },
  markSpace: { width: 8 },
  selectBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  box: { width: 20, height: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
