import { useMemo } from 'react';
import { View } from 'react-native';

import { nextReminder, todayView } from '@/core/agenda';
import { dayLabel, localDateOf, longDate, minutesToTime } from '@/core/dates';
import { HeaderTools } from '@/components/HeaderTools';
import { QuickAddButton } from '@/components/QuickAdd';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { showTime } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { FAB_SPACE, space } from '@/ui/tokens';

const toLocal = (iso: string) => localDateOf(new Date(iso));

export default function Today() {
  const { data } = useData();
  const { now, moment } = useNow();
  const { colors } = useTheme();
  const selection = useSelection();
  const view = useMemo(() => todayView(data, now, toLocal), [data, now]);
  const next = useMemo(() => nextReminder(data, data.reminders, now, moment), [data, now, moment]);
  const { stats } = view;

  let nextLine: string | null = null;
  if (next) {
    const day = localDateOf(next.at);
    const time = showTime(minutesToTime(next.at.getHours() * 60 + next.at.getMinutes()));
    nextLine = `${day === now.date ? time : `${dayLabel(day, now.date)}, ${time}`} · ${next.item.task.title}`;
  }

  return (
    <Screen
      bottomSpace={FAB_SPACE}
      overlay={
        <>
          <QuickAddButton defaults={{ dueDate: now.date }} />
          <SelectionBar selection={selection} />
        </>
      }>
      <PageHeader right={<HeaderTools />} title="Today" subtitle={longDate(now.date)} />

      <View accessibilityLabel={`${stats.done} of ${stats.scheduled} done today, ${stats.pending} pending, ${stats.overdue} overdue`}>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider }}>
          <Stat label="Scheduled" value={stats.scheduled} />
          <Stat label="Done" value={stats.done} color={stats.done ? 'completed' : undefined} />
          <Stat label="Pending" value={stats.pending} />
          <Stat label="Overdue" value={stats.overdue} color={stats.overdue ? 'overdue' : undefined} last />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.md }}>
          <View style={{ flex: 1, height: 4, backgroundColor: colors.divider }}>
            <View style={{ width: `${stats.percent}%`, height: 4, backgroundColor: colors.completed }} />
          </View>
          <Text variant="smallStrong">{stats.percent}%</Text>
        </View>
      </View>

      {nextLine ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name="bell" color={colors.accent} size={16} />
          <Text variant="small" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
            Next reminder {nextLine}
          </Text>
        </View>
      ) : null}

      <TaskList
        lead="time"
        selection={selection}
        sections={[
          { title: 'Overdue', tone: 'overdue', items: view.overdue },
          { title: 'Today', items: view.today },
          { title: 'Done today', items: view.doneToday },
        ]}
        empty="Nothing due today. Tap + to add a task."
      />
    </Screen>
  );
}

function Stat({ label, value, color, last }: { label: string; value: number; color?: 'completed' | 'overdue'; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, paddingVertical: space.md, paddingHorizontal: space.sm, borderRightWidth: last ? 0 : 1, borderRightColor: colors.divider, gap: 2 }}>
      <Text variant="heading" color={color ?? 'text'}>
        {value}
      </Text>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
    </View>
  );
}
