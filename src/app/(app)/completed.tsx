import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { completedByDay } from '@/core/agenda';
import { dayLabel, localDateOf } from '@/core/dates';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData } from '@/state/data';
import { useNow } from '@/state/now';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';

const toLocal = (iso: string) => localDateOf(new Date(iso));
const PAGE = 14;

/** What was done, by the day it was done. Tick a box to reopen. */
export default function Completed() {
  const { data } = useData();
  const { now } = useNow();
  const selection = useSelection();
  const [days, setDays] = useState(PAGE);
  const groups = useMemo(() => completedByDay(data, toLocal), [data]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <Screen bottomInset overlay={<SelectionBar selection={selection} bottomInset />}>
      <BackHeader />
      <PageHeader title="Completed" subtitle={total ? `${plural(total, 'task')} done. Untick one to reopen it.` : undefined} />
      <TaskList
        lead="date"
        selection={selection}
        sections={groups.slice(0, days).map((g) => ({ title: dayLabel(g.date, now.date), items: g.items }))}
        empty="Nothing completed yet."
      />
      {groups.length > days ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button variant="secondary" label="Show earlier days" onPress={() => setDays((d) => d + PAGE)} />
        </View>
      ) : null}
    </Screen>
  );
}
