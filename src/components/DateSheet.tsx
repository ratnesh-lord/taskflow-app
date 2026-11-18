import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  addDays, addMonths, daysInMonth, type LocalDate, type LocalTime, makeDate, MONTH_LONG, normaliseTime, parts, shortDate,
  startOfWeek, weekday,
} from '@/core/dates';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { showTime } from '@/ui/format';
import { IconButton } from '@/ui/IconButton';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space, typography } from '@/ui/tokens';

export type DateScope = 'occurrence' | 'series';

export type DateSheetProps = {
  visible: boolean;
  title?: string;
  today: LocalDate;
  date: LocalDate | null;
  time: LocalTime | null;
  /** Repeating task: ask whether to move this time only or the whole series. */
  repeating?: boolean;
  withTime?: boolean;
  onClose: () => void;
  onPick: (date: LocalDate | null, time: LocalTime | null, scope: DateScope) => void;
};

const TIME_PRESETS: { label: string; time: LocalTime }[] = [
  { label: 'Morning', time: '09:00' },
  { label: 'Afternoon', time: '14:00' },
  { label: 'Evening', time: '18:00' },
];

/** Pick a day (quick choices or a month grid) and optionally a time. */
export function DateSheet({ visible, title = 'Due', today, date, time, repeating, withTime = true, onClose, onPick }: DateSheetProps) {
  const { colors } = useTheme();
  const [day, setDay] = useState<LocalDate | null>(date);
  const [clock, setClock] = useState<string>(time ?? '');
  const [month, setMonth] = useState<LocalDate>(() => (date ?? today).slice(0, 8) + '01');
  const [scope, setScope] = useState<DateScope>('occurrence');

  // Start from the current value each time the sheet opens.
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setDay(date);
      setClock(time ?? '');
      setMonth((date ?? today).slice(0, 8) + '01');
      setScope('occurrence');
    }
  }

  const parsedTime = clock.trim() === '' ? null : normaliseTime(clock.trim().replace('.', ':'));
  const timeError = clock.trim() !== '' && !parsedTime ? 'Use 24-hour time, like 18:30.' : null;

  const quick: { label: string; date: LocalDate | null }[] = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next week', date: addDays(startOfWeek(today), 7) },
    { label: 'No date', date: null },
  ];

  const save = () => {
    if (timeError) return;
    onPick(day, day && withTime ? parsedTime : null, scope);
  };

  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={onClose}
      footer={<Button label={day ? `Set ${shortDate(day, today)}${parsedTime ? `, ${showTime(parsedTime)}` : ''}` : 'Remove the date'} onPress={save} disabled={!!timeError} />}>
      <View style={styles.wrap}>
        {quick.map((q) => (
          <Chip key={q.label} label={q.label} selected={day === q.date} onPress={() => {
              setDay(q.date);
              if (q.date) setMonth(q.date.slice(0, 8) + '01');
            }}
          />
        ))}
      </View>

      <MonthGrid today={today} value={day} month={month} onMonth={setMonth} onPick={setDay} />

      {withTime && day ? (
        <View style={{ gap: space.sm }}>
          <Text variant="caption" color="textSecondary">
            Time (optional)
          </Text>
          <View style={styles.wrap}>
            {TIME_PRESETS.map((p) => (
              <Chip key={p.label} label={`${p.label} ${showTime(p.time)}`} selected={parsedTime === p.time} onPress={() => setClock(p.time)} />
            ))}
            <Chip label="No time" selected={clock.trim() === ''} onPress={() => setClock('')} />
          </View>
          <TextInput
            accessibilityLabel="Time, 24-hour"
            value={clock}
            onChangeText={setClock}
            placeholder="HH:MM"
            placeholderTextColor={colors.textSecondary}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            style={[typography.body, styles.timeInput, { color: colors.text, borderBottomColor: timeError ? colors.overdue : colors.divider }]}
          />
          {timeError ? (
            <Text variant="caption" color="overdue">
              {timeError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {repeating && day ? (
        <Segmented
          label="Which occurrences"
          value={scope}
          options={[
            { value: 'occurrence', label: 'This time only' },
            { value: 'series', label: 'Whole series' },
          ]}
          onChange={setScope}
        />
      ) : null}
    </Sheet>
  );
}

/** A Monday-first month of days with previous and next buttons. */
export function MonthGrid({
  today, value, month, onMonth, onPick, min,
}: { today: LocalDate; value: LocalDate | null; month: LocalDate; onMonth: (month: LocalDate) => void; onPick: (date: LocalDate) => void; min?: LocalDate }) {
  const { colors } = useTheme();
  const m = parts(month);
  const first = makeDate(m.year, m.month, 1);
  const lead = (weekday(first) + 6) % 7;
  const cells: (LocalDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth(m.year, m.month) }, (_, i) => makeDate(m.year, m.month, i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  const day = value;

  return (
    <View>
      <View style={styles.monthHead}>
        <IconButton icon="back" label="Previous month" onPress={() => onMonth(addMonths(month, -1))} />
        <Text variant="bodyStrong" accessibilityRole="header">
          {MONTH_LONG[m.month - 1]} {m.year}
        </Text>
        <View style={{ transform: [{ scaleX: -1 }] }}>
          <IconButton icon="back" label="Next month" onPress={() => onMonth(addMonths(month, 1))} />
        </View>
      </View>
      <View style={styles.grid}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={`h${i}`} variant="caption" color="textSecondary" style={styles.headCell}>
            {d}
          </Text>
        ))}
        {cells.map((d, i) =>
          d ? (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityLabel={shortDate(d, today)}
              aria-selected={d === day}
              disabled={!!min && d < min}
              onPress={() => onPick(d)}
              style={[
                styles.cell,
                d === day && { backgroundColor: colors.text },
                d === today && d !== day && { borderWidth: 1, borderColor: colors.accent },
                !!min && d < min && { opacity: 0.3 },
              ]}>
              <Text variant="small" style={{ color: d === day ? colors.background : d < today ? colors.textSecondary : colors.text }}>
                {parts(d).day}
              </Text>
            </Pressable>
          ) : (
            <View key={`e${i}`} style={styles.cell} />
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  monthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  headCell: { width: `${100 / 7}%`, textAlign: 'center', paddingVertical: space.xs },
  cell: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' },
  timeInput: { minHeight: 44, borderBottomWidth: 1, paddingHorizontal: 0, width: 120 },
});
