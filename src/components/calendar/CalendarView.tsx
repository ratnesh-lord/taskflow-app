import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { calendarDays, type CalendarMode, rangeOf, step } from '@/core/calendar';
import { type LocalDate, MONTH_LONG, MONTH_SHORT, parts, WEEKDAY_LONG, weekday } from '@/core/dates';
import { useData } from '@/state/data';
import { useGoogleEvents } from '@/state/google';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { IconButton } from '@/ui/IconButton';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

import { AgendaView } from './AgendaView';
import { MonthView } from './MonthView';
import { TimeGrid } from './TimeGrid';

const MODES: readonly { value: CalendarMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Agenda' },
];

function titleOf(mode: CalendarMode, from: LocalDate, to: LocalDate, anchor: LocalDate): string {
  const a = parts(from);
  const b = parts(to);
  switch (mode) {
    case 'day':
      return `${WEEKDAY_LONG[weekday(from)]} ${a.day} ${MONTH_LONG[a.month - 1]}`;
    case 'week':
      return a.month === b.month
        ? `${a.day}–${b.day} ${MONTH_SHORT[a.month - 1]} ${a.year}`
        : `${a.day} ${MONTH_SHORT[a.month - 1]} – ${b.day} ${MONTH_SHORT[b.month - 1]}`;
    case 'month': {
      const m = parts(anchor);
      return `${MONTH_LONG[m.month - 1]} ${m.year}`;
    }
    case 'agenda':
      return `${a.day} ${MONTH_SHORT[a.month - 1]} – ${b.day} ${MONTH_SHORT[b.month - 1]}`;
  }
}

/** Day, week, month and agenda views of tasks (and Google events when connected). */
export function CalendarView() {
  const { colors } = useTheme();
  const { data } = useData();
  const { now } = useNow();
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const [mode, setMode] = useState<CalendarMode>(wide ? 'week' : 'day');
  const [anchor, setAnchor] = useState<LocalDate>(now.date);
  const [selected, setSelected] = useState<LocalDate>(now.date);
  const [locked, setLocked] = useState(false);

  const { from, to } = rangeOf(mode, anchor);
  const events = useGoogleEvents(from, to);
  const days = useMemo(() => calendarDays(data, now, from, to, events.items), [data, now, from, to, events.items]);

  const go = (direction: 1 | -1) => {
    const next = step(mode, anchor, direction);
    setAnchor(next);
    setSelected(next);
  };
  const today = () => {
    setAnchor(now.date);
    setSelected(now.date);
  };
  // Switching view keeps the chosen day in sight.
  const changeMode = (m: CalendarMode) => {
    setMode(m);
    setAnchor(selected);
  };

  const header = (
    <View style={{ gap: space.md }}>
      <Segmented label="Calendar view" value={mode} options={MODES} onChange={changeMode} />
      <View style={styles.nav}>
        <IconButton icon="back" label="Earlier" onPress={() => go(-1)} />
        <Text variant="bodyStrong" accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {titleOf(mode, from, to, anchor)}
        </Text>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <IconButton icon="back" label="Later" onPress={() => go(1)} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Go to today" onPress={today} style={[styles.today, { borderColor: colors.text }]}>
          <Text variant="smallStrong">Today</Text>
        </Pressable>
      </View>
      {events.message ? (
        <Text variant="caption" color="textSecondary">
          {events.message}
        </Text>
      ) : null}
    </View>
  );

  if (mode === 'day' || mode === 'week') {
    return (
      <View style={styles.fill}>
        {header}
        <View style={[styles.fill, { marginTop: space.md }]}>
          <TimeGrid days={days} now={now} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.fill} scrollEnabled={!locked} contentContainerStyle={{ paddingBottom: space.xxxl }}>
      {header}
      <View style={{ marginTop: space.lg }}>
        {mode === 'month' ? (
          <MonthView days={days} anchor={anchor} now={now} selected={selected} onSelect={setSelected} wide={wide} onScrollLock={setLocked} />
        ) : (
          <AgendaView days={days} now={now} />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, textAlign: 'center' },
  today: { borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.sm, marginLeft: space.xs },
});
