import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { nextReminder, type TodayFocus, todaySections, todayView } from '@/core/agenda';
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
  const [focus, setFocus] = useState<TodayFocus | null>(null);
  const pick = (f: TodayFocus) => setFocus((cur) => (cur === f ? null : f));

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

      <View>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.divider }}>
          <Stat label="Scheduled" value={stats.scheduled} selected={focus === 'scheduled'} onPress={() => pick('scheduled')} />
          <Stat label="Done" value={stats.done} color={stats.done ? 'completed' : undefined} selected={focus === 'done'} onPress={() => pick('done')} />
          <Stat label="Pending" value={stats.pending} selected={focus === 'pending'} onPress={() => pick('pending')} />
          <Stat
            label="Overdue"
            value={stats.overdue}
            color={stats.overdue ? 'overdue' : undefined}
            selected={focus === 'overdue'}
            onPress={() => pick('overdue')}
            last
          />
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

      {focus ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
            Showing {FOCUS_LABEL[focus]} only
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setFocus(null)} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text variant="smallStrong" color="accent">
              Show all
            </Text>
          </Pressable>
        </View>
      ) : null}

      <TaskList lead="time" selection={selection} sections={todaySections(view, focus)} empty={focus ? FOCUS_EMPTY[focus] : 'Nothing due today. Tap + to add a task.'} />
    </Screen>
  );
}

const FOCUS_LABEL: Record<TodayFocus, string> = {
  scheduled: "today's scheduled tasks",
  done: 'tasks done today',
  pending: "today's pending tasks",
  overdue: 'overdue tasks',
};

const FOCUS_EMPTY: Record<TodayFocus, string> = {
  scheduled: 'Nothing scheduled for today.',
  done: 'Nothing done yet today.',
  pending: 'Nothing left to do today.',
  overdue: 'Nothing overdue.',
};

/** One count. Tapping it shows only the tasks behind it; tapping again shows everything. */
function Stat({
  label, value, color, last, selected, onPress,
}: { label: string; value: number; color?: 'completed' | 'overdue'; last?: boolean; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${selected ? 'Showing only these; tap to show all.' : 'Tap to show only these.'}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        paddingVertical: space.md,
        paddingHorizontal: space.sm,
        borderRightWidth: last ? 0 : 1,
        borderRightColor: colors.divider,
        gap: 2,
        backgroundColor: selected ? colors.text : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text variant="heading" color={selected ? 'background' : (color ?? 'text')}>
        {value}
      </Text>
      <Text variant="caption" color={selected ? 'background' : 'textSecondary'}>
        {label}
      </Text>
    </Pressable>
  );
}
