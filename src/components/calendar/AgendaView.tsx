import { StyleSheet, View } from 'react-native';

import type { CalendarDay } from '@/core/calendar';
import { dayLabel, type Now } from '@/core/dates';
import { useTheme } from '@/state/theme';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

import { useOpenEntry } from './Block';
import { EntryRow } from './MonthView';

/** Thirty days as a list, only the days with something on them. */
export function AgendaView({ days, now }: { days: CalendarDay[]; now: Now }) {
  const { colors } = useTheme();
  const open = useOpenEntry();
  const busy = days.filter((d) => d.allDay.length + d.timed.length > 0);
  if (busy.length === 0) {
    return (
      <Text variant="small" color="textSecondary" style={{ paddingVertical: space.xl }}>
        Nothing in these 30 days.
      </Text>
    );
  }
  return (
    <View>
      {busy.map((d) => {
        const entries = [...d.allDay, ...d.timed];
        return (
          <View key={d.date} style={styles.day}>
            <Text variant="label" color={d.date === now.date ? 'accent' : 'textSecondary'} style={{ paddingBottom: space.sm }}>
              {`${dayLabel(d.date, now.date)} · ${entries.length}`}
            </Text>
            <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
              {entries.map((entry) => (
                <EntryRow key={entry.key} entry={entry} onPress={() => open(entry)} />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  day: { paddingTop: space.lg },
});
