import { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { TaskItem } from '@/core/agenda';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { SectionTitle } from '@/ui/Row';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

import { TaskRow } from './TaskRow';
import { type Selection, useRowHandlers, useRowInfo } from './useTaskActions';

export type TaskSection = { title?: string; tone?: 'overdue'; items: TaskItem[] };

/** Rows drawn at once; the rest follow on the next frame. */
const FIRST_ROWS = 40;

/**
 * How many rows to draw now. A long list (hundreds of tasks in the Inbox or a
 * project) shows its first rows straight away and the rest one frame later,
 * rather than keeping the screen blank until every row is drawn. (One second
 * step, not many small ones: each step redraws the rows before it.)
 */
function useRowsShown(total: number): number {
  const [all, setAll] = useState(false);
  const long = total > FIRST_ROWS;
  useEffect(() => {
    if (all || !long) return;
    const id = requestAnimationFrame(() => setAll(true));
    return () => cancelAnimationFrame(id);
  }, [all, long]);
  return all ? total : Math.min(FIRST_ROWS, total);
}

/** The first `limit` rows across the sections, in order. */
function firstRows(sections: TaskSection[], limit: number): TaskItem[][] {
  let left = limit;
  return sections.map((s) => {
    const rows = s.items.slice(0, Math.max(0, left));
    left -= rows.length;
    return rows;
  });
}

export function TaskList({
  sections, lead, selection, empty,
}: { sections: TaskSection[]; lead: 'time' | 'date'; selection: Selection; empty?: string }) {
  const { colors } = useTheme();
  const { now } = useNow();
  const info = useRowInfo();
  const { toggle, open } = useRowHandlers();
  const visible = sections.filter((s) => s.items.length > 0);
  const shown = firstRows(visible, useRowsShown(visible.reduce((n, s) => n + s.items.length, 0)));

  if (visible.length === 0) {
    return empty ? (
      <View style={{ paddingVertical: space.xl, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Text variant="small" color="textSecondary">
          {empty}
        </Text>
      </View>
    ) : null;
  }

  return (
    <View>
      {visible.map((section, i) => (
        <View key={section.title ?? i}>
          {section.title ? <SectionTitle color={section.tone === 'overdue' ? 'overdue' : 'textSecondary'}>{`${section.title} · ${section.items.length}`}</SectionTitle> : null}
          <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
            {shown[i].map((item) => (
              <TaskRow
                key={item.key}
                item={item}
                info={info(item)}
                today={now.date}
                lead={lead}
                selecting={selection.selecting}
                selected={selection.has(item.task.id)}
                onToggle={toggle}
                onOpen={open}
                onSelect={selection.toggle}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
