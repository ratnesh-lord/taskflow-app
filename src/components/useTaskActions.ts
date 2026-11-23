import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import type { TaskItem } from '@/core/agenda';
import { dayLabel } from '@/core/dates';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';

import { useLook } from '@/state/look';

import type { RowInfo } from './TaskRow';

/** Project name, tags, subtask counts and reminders for each row, from the snapshot. */
export function useRowInfo(): (item: TaskItem) => RowInfo {
  const { data } = useData();
  const look = useLook();
  return useMemo(() => {
    const projects = new Map(data.projects.map((p) => [p.id, p.name]));
    const tags = new Map(data.tags.map((t) => [t.id, t.name]));
    const reminded = new Set(data.reminders.filter((r) => r.isActive).map((r) => r.taskId));
    return (item: TaskItem): RowInfo => {
      const id = item.task.id;
      const subs = data.subtasks.get(id) ?? [];
      return {
        projectName: item.task.projectId ? projects.get(item.task.projectId) ?? null : null,
        tagNames: (data.taskTags.get(id) ?? []).map((t) => tags.get(t) ?? '').filter(Boolean),
        subtasks: { done: subs.filter((s) => s.isCompleted).length, total: subs.length },
        hasReminder: reminded.has(id),
        color: look.taskHex(item.task),
      };
    };
  }, [data, look]);
}

/** Complete or reopen from a list, with Undo; open the editor. */
export function useRowHandlers() {
  const { actions } = useData();
  const run = useRun();
  const router = useRouter();
  const { now } = useNow();

  const toggle = useCallback(
    (item: TaskItem) => {
      if (item.open) {
        const label = item.repeating && item.occurrence ? `Done for ${dayLabel(item.occurrence.date, now.date).toLowerCase()}` : 'Completed';
        void run(() => actions.complete([item.task.id]), `${label}: ${item.task.title}`);
      } else {
        void run(() => actions.reopen(item.task.id, item.repeating ? item.occurrence?.date : undefined), `Reopened: ${item.task.title}`);
      }
    },
    [actions, run, now.date],
  );

  const open = useCallback((item: TaskItem) => router.push(`/task/${item.task.id}`), [router]);
  return { toggle, open };
}

export type Selection = {
  selecting: boolean;
  ids: string[];
  has: (id: string) => boolean;
  toggle: (item: TaskItem) => void;
  clear: () => void;
};

/** Long-press a row to start choosing several tasks; tap to add or remove more. */
export function useSelection(): Selection {
  const [ids, setIds] = useState<string[]>([]);
  return useMemo(
    () => ({
      selecting: ids.length > 0,
      ids,
      has: (id: string) => ids.includes(id),
      toggle: (item: TaskItem) => setIds((cur) => (cur.includes(item.task.id) ? cur.filter((x) => x !== item.task.id) : [...cur, item.task.id])),
      clear: () => setIds([]),
    }),
    [ids],
  );
}
