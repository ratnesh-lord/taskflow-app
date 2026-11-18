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

export function TaskList({
  sections, lead, selection, empty,
}: { sections: TaskSection[]; lead: 'time' | 'date'; selection: Selection; empty?: string }) {
  const { colors } = useTheme();
  const { now } = useNow();
  const info = useRowInfo();
  const { toggle, open } = useRowHandlers();
  const visible = sections.filter((s) => s.items.length > 0);

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
            {section.items.map((item) => (
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
