import { useMemo } from 'react';

import { inboxItems } from '@/core/agenda';
import { HeaderTools } from '@/components/HeaderTools';
import { QuickAddButton } from '@/components/QuickAdd';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData } from '@/state/data';
import { useNow } from '@/state/now';
import { plural } from '@/ui/format';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { FAB_SPACE } from '@/ui/tokens';

export default function Inbox() {
  const { data } = useData();
  const { now } = useNow();
  const selection = useSelection();
  const items = useMemo(() => inboxItems(data, now), [data, now]);

  return (
    <Screen
      bottomSpace={FAB_SPACE}
      overlay={
        <>
          <QuickAddButton />
          <SelectionBar selection={selection} />
        </>
      }>
      <PageHeader right={<HeaderTools />}
        title="Inbox"
        subtitle={items.length ? `${plural(items.length, 'task')} to sort. Give each a date, project or category.` : 'Tasks without a date or project land here.'}
      />
      <TaskList lead="date" selection={selection} sections={[{ items }]} empty="Inbox is empty." />
    </Screen>
  );
}
