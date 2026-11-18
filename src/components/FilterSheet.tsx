import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { DUE_LABEL, type DueFilter, NONE_ID, type ShowFilter, SORT_LABEL, type SortKey, type TaskFilter } from '@/core/filters';
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES } from '@/core/types';
import type { DataSnapshot } from '@/data/snapshot';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const SHOW: readonly { value: ShowFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'Both' },
];

function toggle<T>(list: readonly T[] | undefined, value: T): T[] {
  const cur = list ?? [];
  return cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
}

/** Every filter condition and the sort order, applied together with "Show tasks". */
export function FilterSheet({
  visible, filter, data, onClose, onApply,
}: { visible: boolean; filter: TaskFilter; data: DataSnapshot; onClose: () => void; onApply: (filter: TaskFilter) => void }) {
  const [draft, setDraft] = useState<TaskFilter>(filter);
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setDraft(filter);
  }
  const set = (patch: Partial<TaskFilter>) => setDraft((cur) => ({ ...cur, ...patch }));

  return (
    <Sheet
      visible={visible}
      title="Filter and sort"
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button label="Show tasks" onPress={() => onApply(draft)} style={{ flex: 1 }} />
          <Button variant="secondary" label="Clear" onPress={() => setDraft({ text: draft.text, sort: draft.sort })} />
        </View>
      }>
      <View style={{ gap: space.sm }}>
        <Text variant="caption" color="textSecondary">
          Show
        </Text>
        <Segmented label="Show" value={draft.show ?? 'open'} options={SHOW} onChange={(show) => set({ show })} />
      </View>

      <Group title="Due">
        {(Object.keys(DUE_LABEL) as DueFilter[]).map((d) => (
          <Chip key={d} label={DUE_LABEL[d]} selected={(draft.due ?? 'any') === d} onPress={() => set({ due: d })} />
        ))}
      </Group>

      <Group title="Priority">
        {[...PRIORITIES].map((p) => (
          <Chip key={p} label={PRIORITY_LABEL[p]} selected={!!draft.priorities?.includes(p)} onPress={() => set({ priorities: toggle(draft.priorities, p) })} />
        ))}
      </Group>

      <Group title="Status">
        {STATUSES.map((s) => (
          <Chip key={s} label={STATUS_LABEL[s]} selected={!!draft.statuses?.includes(s)} onPress={() => set({ statuses: toggle(draft.statuses, s) })} />
        ))}
      </Group>

      <Group title="Project">
        <Chip label="No project" selected={!!draft.projectIds?.includes(NONE_ID)} onPress={() => set({ projectIds: toggle(draft.projectIds, NONE_ID) })} />
        {data.projects.map((p) => (
          <Chip key={p.id} label={p.name} selected={!!draft.projectIds?.includes(p.id)} onPress={() => set({ projectIds: toggle(draft.projectIds, p.id) })} />
        ))}
      </Group>

      <Group title="Category">
        <Chip label="No category" selected={!!draft.categoryIds?.includes(NONE_ID)} onPress={() => set({ categoryIds: toggle(draft.categoryIds, NONE_ID) })} />
        {data.categories.map((c) => (
          <Chip key={c.id} label={c.name} selected={!!draft.categoryIds?.includes(c.id)} onPress={() => set({ categoryIds: toggle(draft.categoryIds, c.id) })} />
        ))}
      </Group>

      {data.tags.length ? (
        <Group title="Tags (any of)">
          {data.tags.map((t) => (
            <Chip key={t.id} label={`#${t.name}`} selected={!!draft.tagIds?.includes(t.id)} onPress={() => set({ tagIds: toggle(draft.tagIds, t.id) })} />
          ))}
        </Group>
      ) : null}

      <Group title="Sort by">
        {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
          <Chip key={k} label={SORT_LABEL[k]} selected={(draft.sort ?? 'due') === k} onPress={() => set({ sort: k })} />
        ))}
      </Group>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="caption" color="textSecondary">
        {title}
      </Text>
      <View style={styles.wrap}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm } });
