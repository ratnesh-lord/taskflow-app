import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { addDays, type LocalDate, shortDate } from '@/core/dates';
import {
  alignStart, describeRule, formatRule, type Freq, MAX_INTERVAL, mondayFirst, occurrencesBetween, parseRule, presetOf, presetRule,
  type RepeatPreset, type Rule, type Weekday,
} from '@/core/recurrence';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space, typography } from '@/ui/tokens';

import { MonthGrid } from './DateSheet';

const PRESETS: { value: RepeatPreset; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'custom', label: 'Custom' },
];

const UNITS: readonly { value: Freq; label: string }[] = [
  { value: 'daily', label: 'Days' },
  { value: 'weekly', label: 'Weeks' },
  { value: 'monthly', label: 'Months' },
  { value: 'yearly', label: 'Years' },
];

const DAYS: { value: Weekday; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

/**
 * Choose how a task repeats: a preset, or every N days, weeks (on chosen
 * weekdays), months or years, with an optional last day.
 */
export function RepeatSheet({
  visible, today, anchor, rrule, until, onClose, onSave,
}: {
  visible: boolean;
  today: LocalDate;
  /** The task's due date; repeats count from it. */
  anchor: LocalDate | null;
  rrule: string | null;
  until: LocalDate | null;
  onClose: () => void;
  onSave: (rrule: string | null, until: LocalDate | null) => void;
}) {
  const { colors } = useTheme();
  const [preset, setPreset] = useState<RepeatPreset>('none');
  const [interval, setInterval] = useState('1');
  const [freq, setFreq] = useState<Freq>('weekly');
  const [byDay, setByDay] = useState<Weekday[]>([]);
  const [end, setEnd] = useState<LocalDate | null>(null);
  const [month, setMonth] = useState<LocalDate>(today.slice(0, 8) + '01');

  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      const rule = parseRule(rrule);
      setPreset(presetOf(rule));
      setInterval(String(rule?.interval ?? 1));
      setFreq(rule?.freq ?? 'weekly');
      setByDay(rule?.byDay ?? []);
      setEnd(until);
      setMonth((until ?? addDays(anchor ?? today, 30)).slice(0, 8) + '01');
    }
  }

  const start = anchor ?? today;
  const n = Number(interval);
  const intervalError = preset === 'custom' && (!Number.isInteger(n) || n < 1 || n > MAX_INTERVAL) ? `Use a whole number from 1 to ${MAX_INTERVAL}.` : null;
  const rule: Rule | null =
    preset === 'none' ? null
    : preset === 'custom' ? (intervalError ? null : { freq, interval: n, byDay: freq === 'weekly' && byDay.length ? mondayFirst(byDay) : undefined })
    : presetRule(preset);
  const endError = rule && end && end < start ? 'The last day is before the first.' : null;
  const first = rule ? alignStart(start, rule) : start;
  const next = rule ? occurrencesBetween(first, rule, first, addDays(first, 3700), end, 3) : [];

  return (
    <Sheet
      visible={visible}
      title="Repeat"
      onClose={onClose}
      footer={
        <Button
          label={rule ? 'Save repeat' : 'Do not repeat'}
          disabled={!!intervalError || !!endError}
          onPress={() => onSave(rule ? formatRule(rule) : null, rule ? end : null)}
        />
      }>
      <View style={styles.wrap}>
        {PRESETS.map((p) => (
          <Chip key={p.value} label={p.label} selected={preset === p.value} onPress={() => setPreset(p.value)} />
        ))}
      </View>

      {preset === 'custom' ? (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Text variant="body">Every</Text>
            <TextInput
              accessibilityLabel="Repeat every how many"
              value={interval}
              onChangeText={(t) => setInterval(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={3}
              style={[typography.bodyStrong, styles.number, { color: colors.text, borderBottomColor: intervalError ? colors.overdue : colors.divider }]}
            />
          </View>
          <Segmented label="Repeat unit" value={freq} options={UNITS} onChange={setFreq} />
          {intervalError ? (
            <Text variant="caption" color="overdue">
              {intervalError}
            </Text>
          ) : null}
          {freq === 'weekly' ? (
            <View style={{ gap: space.sm }}>
              <Text variant="caption" color="textSecondary">
                On these days (none chosen: the due date&apos;s weekday)
              </Text>
              <View style={styles.wrap}>
                {DAYS.map((d) => (
                  <Chip
                    key={d.value}
                    label={d.label}
                    selected={byDay.includes(d.value)}
                    onPress={() => setByDay((cur) => (cur.includes(d.value) ? cur.filter((x) => x !== d.value) : [...cur, d.value]))}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {rule ? (
        <View style={{ gap: space.sm }}>
          <Text variant="caption" color="textSecondary">
            Ends
          </Text>
          <View style={styles.wrap}>
            <Chip label="Never" selected={!end} onPress={() => setEnd(null)} />
            <Chip label={end ? `On ${shortDate(end, today)}` : 'On a date'} selected={!!end} onPress={() => setEnd(end ?? addDays(start, 30))} />
          </View>
          {end ? <MonthGrid today={today} value={end} month={month} onMonth={setMonth} onPick={setEnd} min={start} /> : null}
          {endError ? (
            <Text variant="caption" color="overdue">
              {endError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {rule ? (
        <View style={{ gap: space.xs, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: space.md }}>
          <Text variant="bodyStrong">{describeRule(rule, first)}</Text>
          <Text variant="small" color="textSecondary">
            {anchor ? '' : `Starts today, since the task has no date. `}
            {next.length ? `Next: ${next.map((d) => shortDate(d, today)).join(', ')}` : 'No dates before the end.'}
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  number: { width: 64, minHeight: 44, borderBottomWidth: 1, textAlign: 'center' },
});
