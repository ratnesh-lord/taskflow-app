import { useMemo, useState } from 'react';

import { allItems, completedItems } from '@/core/agenda';
import { matchesText, sortItems } from '@/core/filters';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData } from '@/state/data';
import { useNow } from '@/state/now';
import { BackHeader } from '@/ui/BackHeader';
import { Screen } from '@/ui/Screen';
import { TextField } from '@/ui/TextField';

/** Find any task by words in its title, description or notes, open or done. */
export default function Search() {
  const { data } = useData();
  const { now } = useNow();
  const selection = useSelection();
  const [text, setText] = useState('');
  const query = text.trim();

  const { open, done } = useMemo(() => {
    if (!query) return { open: [], done: [] };
    const openItems = sortItems(allItems(data, now).filter((i) => i.open && matchesText(i, query)));
    // Each repeating task appears once among the done items: its latest completion.
    const seen = new Set<string>();
    const doneItems = completedItems(data).filter((i) => {
      if (!matchesText(i, query) || seen.has(i.task.id)) return false;
      seen.add(i.task.id);
      return true;
    });
    return { open: openItems, done: doneItems };
  }, [data, now, query]);

  return (
    <Screen bottomInset overlay={<SelectionBar selection={selection} bottomInset />}>
      <BackHeader title="Search" />
      <TextField label="Search titles, descriptions and notes" value={text} onChangeText={setText} autoFocus autoCapitalize="none" returnKeyType="search" />
      {query ? (
        <TaskList
          lead="date"
          selection={selection}
          sections={[
            { title: 'Open', items: open },
            { title: 'Completed', items: done },
          ]}
          empty={`Nothing matches “${query}”.`}
        />
      ) : null}
    </Screen>
  );
}
