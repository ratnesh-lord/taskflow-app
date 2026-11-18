import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { allItems } from '@/core/agenda';
import { activeConditions, describeFilter, type DueFilter, filterItems, readFilter, sameFilter, type TaskFilter } from '@/core/filters';
import { FilterSheet } from '@/components/FilterSheet';
import { NameSheet } from '@/components/NameSheet';
import { QuickAddButton } from '@/components/QuickAdd';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { plural } from '@/ui/format';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { FAB_SPACE, space } from '@/ui/tokens';

/** Every task, with search, filters, sorting and saved filters. */
export default function AllTasks() {
  const params = useLocalSearchParams<{ due?: string; saved?: string; category?: string; project?: string }>();
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const selection = useSelection();
  const [filter, setFilter] = useState<TaskFilter>(() => {
    const saved = params.saved ? data.savedFilters.find((f) => f.id === params.saved) : undefined;
    if (saved) return saved.filter;
    return readFilter({
      due: params.due as DueFilter | undefined,
      categoryIds: params.category ? [params.category] : undefined,
      projectIds: params.project ? [params.project] : undefined,
    });
  });
  const [sheet, setSheet] = useState<'filter' | 'save' | null>(null);

  const tagIdsOf = useMemo(() => (taskId: string) => data.taskTags.get(taskId) ?? [], [data]);
  const items = useMemo(() => filterItems(allItems(data, now), filter, { now, tagIdsOf }), [data, now, filter, tagIdsOf]);
  const names = {
    project: (id: string) => data.projects.find((p) => p.id === id)?.name ?? 'Deleted project',
    category: (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Deleted category',
    tag: (id: string) => data.tags.find((t) => t.id === id)?.name ?? 'deleted',
  };
  const current = data.savedFilters.find((f) => sameFilter(f.filter, filter));
  const conditions = activeConditions(filter);

  return (
    <Screen
      bottomInset
      bottomSpace={FAB_SPACE}
      overlay={
        <>
          <QuickAddButton />
          <SelectionBar selection={selection} bottomInset />
        </>
      }>
      <BackHeader />
      <PageHeader title={current?.name ?? 'All tasks'} subtitle={`${plural(items.length, 'task')} · ${describeFilter({ ...filter, text: undefined }, names)}`} />

      <TextField
        label="Search titles, descriptions and notes"
        value={filter.text ?? ''}
        onChangeText={(text) => setFilter((f) => ({ ...f, text }))}
        autoCapitalize="none"
        returnKeyType="search"
      />

      <View style={styles.wrap}>
        <Chip label="All open" selected={conditions === 0} onPress={() => setFilter({ text: filter.text, sort: filter.sort })} />
        {data.savedFilters.map((f) => (
          <Chip key={f.id} label={f.name} selected={current?.id === f.id} onPress={() => setFilter({ ...f.filter, text: filter.text })} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button variant="secondary" label={conditions ? `Filter and sort (${conditions})` : 'Filter and sort'} onPress={() => setSheet('filter')} />
        {conditions && !current ? <Button variant="secondary" label="Save filter" onPress={() => setSheet('save')} /> : null}
        {current ? (
          <Button
            variant="secondary"
            label="Delete saved filter"
            onPress={() => void run(() => actions.deleteFilter(current.id), `Deleted ${current.name}`)}
          />
        ) : null}
      </View>

      {filter.show !== 'open' && filter.show ? (
        <Text variant="caption" color="textSecondary">
          A repeating task shows once, as its next time. Every completed time is listed under Completed.
        </Text>
      ) : null}

      <TaskList lead="date" selection={selection} sections={[{ items }]} empty={filter.text ? 'No task matches that search.' : 'No tasks match these filters.'} />

      <FilterSheet
        visible={sheet === 'filter'}
        filter={filter}
        data={data}
        onClose={() => setSheet(null)}
        onApply={(next) => {
          setFilter(next);
          setSheet(null);
        }}
      />
      <NameSheet
        visible={sheet === 'save'}
        title="Save filter"
        label="Name"
        saveLabel="Save"
        onClose={() => setSheet(null)}
        onSave={async (name) => {
          setSheet(null);
          await run(() => actions.saveFilter(name, { ...filter, text: undefined }), `Saved ${name}`);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm } });
