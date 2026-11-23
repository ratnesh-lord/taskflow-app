import { useMemo } from 'react';

import { type ColorName, isColorName, type ColorSettings, readColorSettings, taskColor } from '@/core/appearance';
import type { Priority } from '@/core/types';
import { taskColorInk, taskColors } from '@/ui/tokens';

import { useData } from './data';
import { useTheme } from './theme';

export type Look = {
  settings: ColorSettings;
  /** A colour name as it shows in the current light or dark mode. */
  hex: (name: ColorName) => string;
  ink: string;
  /** The colour a task shows (by priority or project, as set), or null. */
  taskHex: (task: { priority: Priority; projectId: string | null }) => string | null;
  projectHex: (projectId: string | null) => string | null;
  priorityHex: (priority: Priority) => string;
};

/** Task, project and priority colours for the current mode. */
export function useLook(): Look {
  const { data } = useData();
  const { scheme } = useTheme();
  return useMemo(() => {
    const settings = readColorSettings(data.profile?.settings);
    const projects = new Map(data.projects.map((p) => [p.id, p.color]));
    const hex = (name: ColorName) => taskColors[name][scheme];
    return {
      settings,
      hex,
      ink: taskColorInk[scheme],
      taskHex: (task) => {
        const c = taskColor(task, projects, settings);
        return c ? hex(c) : null;
      },
      projectHex: (projectId) => {
        const c = projectId ? projects.get(projectId) : null;
        return isColorName(c) ? hex(c) : null;
      },
      priorityHex: (priority) => hex(settings.priority[priority]),
    };
  }, [data.profile?.settings, data.projects, scheme]);
}
