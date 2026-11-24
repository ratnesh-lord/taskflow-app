import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { allItems, compareItems } from '@/core/agenda';
import { titleWithEmoji } from '@/core/appearance';
import { shortDate } from '@/core/dates';
import { useData } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space, TOUCH } from '@/ui/tokens';

/**
 * Choose open tasks: one (onPick) or several (multiple, onDone). Typing
 * narrows the list by title. Tasks in `exclude` are left out.
 */
export function TaskPickerSheet({
  visible, title, onClose, onPick, exclude, noneLabel,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onPick: (taskId: string | null) => void;
  exclude?: ReadonlySet<string>;
  /** Offer a "no task" choice with this label. */
  noneLabel?: string;
}) {
  const { data } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setQuery('');
  }

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems(data, now)
      .filter((i) => i.open && !exclude?.has(i.task.id) && (!q || i.task.title.toLowerCase().includes(q)))
      .sort(compareItems)
      .slice(0, 60);
  }, [data, now, query, exclude]);

  const row = (key: string, label: string, detail: string | null, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <Text variant="body" numberOfLines={2} style={{ flex: 1 }}>
        {label}
      </Text>
      {detail ? (
        <Text variant="caption" color="textSecondary">
          {detail}
        </Text>
      ) : null}
      <Icon name="chevron" color={colors.textSecondary} size={18} />
    </Pressable>
  );

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <TextField label="Find a task" value={query} onChangeText={setQuery} autoCapitalize="none" returnKeyType="search" />
      <View>
        {noneLabel ? row('none', noneLabel, null, () => onPick(null)) : null}
        {items.map((i) => row(i.key, titleWithEmoji(i.task), i.date ? shortDate(i.date, now.date) : null, () => onPick(i.task.id)))}
        {items.length === 0 ? (
          <Text variant="small" color="textSecondary" style={{ paddingVertical: space.md }}>
            {query ? 'No open task matches.' : 'No open tasks.'}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}
