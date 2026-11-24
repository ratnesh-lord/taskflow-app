import { Pressable, View } from 'react-native';

import type { TaskItem } from '@/core/agenda';
import { titleWithEmoji } from '@/core/appearance';
import { shortDate } from '@/core/dates';
import { PRIORITY_LABEL } from '@/core/types';
import { useLook } from '@/state/look';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { Text } from '@/ui/Text';
import { space, TOUCH } from '@/ui/tokens';

export type RowAction = { label: string; onPress: () => void; /** Spoken name, e.g. "Move Call mum to today". */ accessibilityLabel?: string };

/** A small square button with an outline. */
export function SmallButton({ label, onPress, accessibilityLabel, strong }: RowAction & { strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={{
        minHeight: 36, paddingHorizontal: space.md, justifyContent: 'center', borderWidth: 1,
        borderColor: strong ? colors.text : colors.divider, backgroundColor: strong ? colors.text : 'transparent',
      }}>
      <Text variant="smallStrong" color={strong ? 'background' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A task with a few buttons beside it, for steps such as "bring this to
 * today". Tapping the title opens the task.
 */
export function ActionRow({ item, actions, onOpen, detail }: { item: TaskItem; actions: readonly RowAction[]; onOpen?: () => void; detail?: string }) {
  const { colors } = useTheme();
  const { now } = useNow();
  const look = useLook();
  const bar = look.taskHex(item.task);
  const words = detail ?? [item.date ? shortDate(item.date, now.date) : null, PRIORITY_LABEL[item.task.priority]].filter(Boolean).join(' · ');
  return (
    <View style={{ minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <View style={{ width: 3, alignSelf: 'stretch', marginVertical: space.sm, backgroundColor: bar ?? 'transparent' }} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${titleWithEmoji(item.task)}, ${words}`} onPress={onOpen} style={{ flex: 1, paddingVertical: space.sm, gap: 2 }}>
        <Text variant="body" numberOfLines={2}>
          {titleWithEmoji(item.task)}
        </Text>
        <Text variant="caption" color={item.overdue ? 'overdue' : 'textSecondary'} numberOfLines={1}>
          {words}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        {actions.map((a) => (
          <SmallButton key={a.label} {...a} />
        ))}
      </View>
    </View>
  );
}
