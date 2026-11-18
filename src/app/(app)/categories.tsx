import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { allItems } from '@/core/agenda';
import { NameSheet } from '@/components/NameSheet';
import type { CategoryRecord } from '@/data/snapshot';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { IconButton } from '@/ui/IconButton';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space, TOUCH } from '@/ui/tokens';

/** Categories cut across projects (Work, Health, Study…). Add, rename, delete. */
export default function Categories() {
  const { data, actions } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const router = useRouter();
  const [editing, setEditing] = useState<CategoryRecord | 'new' | null>(null);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const i of allItems(data, now)) if (i.open && i.task.categoryId) out.set(i.task.categoryId, (out.get(i.task.categoryId) ?? 0) + 1);
    return out;
  }, [data, now]);

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Categories" subtitle="Group tasks by area of life, across projects." />
      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" label="New category" onPress={() => setEditing('new')} />
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
        {data.categories.length === 0 ? (
          <Text variant="small" color="textSecondary" style={{ paddingVertical: space.lg }}>
            No categories yet.
          </Text>
        ) : (
          data.categories.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${plural(counts.get(c.id) ?? 0, 'open task')}`}
                onPress={() => router.push({ pathname: '/all-tasks', params: { category: c.id } })}
                style={({ pressed }) => ({ flex: 1, minHeight: TOUCH + 4, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                <Text variant="bodyStrong">{c.name}</Text>
                <Text variant="caption" color="textSecondary">
                  {plural(counts.get(c.id) ?? 0, 'open task')}
                </Text>
              </Pressable>
              <IconButton icon="more" label={`Rename ${c.name}`} onPress={() => setEditing(c)} />
              <IconButton icon="trash" label={`Delete ${c.name}`} onPress={() => void run(() => actions.deleteCategory(c.id), `Deleted ${c.name}. Its tasks are kept.`)} />
            </View>
          ))
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Icon name="tag" color={colors.textSecondary} size={14} />
        <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
          Deleting a category keeps its tasks; they just lose the category.
        </Text>
      </View>

      <NameSheet
        visible={editing !== null}
        title={editing === 'new' ? 'New category' : 'Rename category'}
        label="Name"
        initial={editing && editing !== 'new' ? editing.name : ''}
        saveLabel={editing === 'new' ? 'Create' : 'Rename'}
        onClose={() => setEditing(null)}
        onSave={(name) => {
          const target = editing;
          setEditing(null);
          if (target === 'new') void run(() => actions.createCategory(name), `Created ${name}`);
          else if (target) void run(() => actions.updateCategory(target.id, { name }), 'Renamed');
        }}
      />
    </Screen>
  );
}
