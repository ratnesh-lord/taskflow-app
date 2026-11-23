import { useCallback } from 'react';

import type { TaskItem } from '@/core/agenda';
import { type Drop, dropChanges } from '@/core/calendar';
import { shortDate } from '@/core/dates';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { shortTime } from '@/ui/format';

/** Moves a dragged task (only that day, for a repeating task), with Undo. */
export function useMoveTask() {
  const { actions } = useData();
  const run = useRun();
  const { now } = useNow();
  return useCallback(
    (item: TaskItem, drop: Drop) => {
      if (!dropChanges(item, drop)) return;
      const when = `${shortDate(drop.date, now.date)}${drop.time ? `, ${shortTime(drop.time)}` : ''}`;
      const occurrence = item.repeating && item.occurrence ? item.occurrence.date : undefined;
      void run(
        () => actions.reschedule([item.task.id], drop.date, drop.time, 'occurrence', occurrence),
        `Moved to ${when}: ${item.task.title}`,
      );
    },
    [actions, run, now.date],
  );
}
