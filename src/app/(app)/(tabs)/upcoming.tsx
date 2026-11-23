import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { upcomingRange, upcomingView } from '@/core/agenda';
import { addDays, shortDate } from '@/core/dates';
import { CalendarView } from '@/components/calendar/CalendarView';
import { HeaderTools } from '@/components/HeaderTools';
import { QuickAddButton } from '@/components/QuickAdd';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { plural } from '@/ui/format';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { calendarGrid, FAB_SPACE, space } from '@/ui/tokens';

type Span = 'tomorrow' | 'week' | 'month' | 'calendar';
const SPANS: readonly { value: Span; label: string }[] = [
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
  { value: 'calendar', label: 'Calendar' },
];

export default function Upcoming() {
  const { data } = useData();
  const { now } = useNow();
  const selection = useSelection();
  const [span, setSpan] = useState<Span>('week');
  const days = useMemo(() => {
    if (span === 'calendar') return [];
    const { from, to } = upcomingRange(now.date, span);
    return upcomingView(data, now, from, to);
  }, [data, now, span]);
  const count = days.reduce((n, d) => n + d.items.length, 0);
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  if (span === 'calendar') {
    // The calendar scrolls inside itself (the hour grid), so it has its own frame.
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View style={{ flex: 1, width: '100%', maxWidth: calendarGrid.maxWidth, alignSelf: 'center', paddingHorizontal: space.lg + space.xs, paddingTop: space.lg + space.xs, gap: space.lg }}>
          <PageHeader right={<HeaderTools />} title="Upcoming" />
          <View>
            <Segmented label="How far ahead" value={span} options={SPANS} onChange={setSpan} />
          </View>
          <CalendarView />
        </View>
        <QuickAddButton defaults={{ dueDate: addDays(now.date, 1) }} />
      </View>
    );
  }

  return (
    <Screen
      bottomSpace={FAB_SPACE}
      overlay={
        <>
          <QuickAddButton defaults={{ dueDate: addDays(now.date, 1) }} />
          <SelectionBar selection={selection} />
        </>
      }>
      <PageHeader right={<HeaderTools />} title="Upcoming" subtitle={count ? `${plural(count, 'task')}, including later repeats` : undefined} />
      <View>
        <Segmented label="How far ahead" value={span} options={SPANS} onChange={setSpan} />
      </View>
      <TaskList
        lead="time"
        selection={selection}
        sections={days.map((d) => ({
          title: d.date === addDays(now.date, 1) ? `Tomorrow, ${shortDate(d.date, now.date)}` : shortDate(d.date, now.date),
          items: d.items,
        }))}
        empty={span === 'tomorrow' ? 'Nothing due tomorrow.' : `Nothing due in the next ${span === 'week' ? '7' : '30'} days.`}
      />
    </Screen>
  );
}
