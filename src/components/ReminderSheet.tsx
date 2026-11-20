import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { dayLabel, type LocalDate } from '@/core/dates';
import type { ReminderDraft } from '@/core/quick-add';
import { remindersOnDevice } from '@/platform/reminders';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { offsetLabel, showTime } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space, TOUCH, typography } from '@/ui/tokens';

const OFFSETS = [0, 5, 15, 30, 60, 1440];

export function reminderText(r: ReminderDraft, today: LocalDate): string {
  return r.kind === 'before_due' ? offsetLabel(r.offsetMinutes) : `${dayLabel(r.date, today)}, ${showTime(r.time)}`;
}

/** The reminders of one task: before the due time, or at a fixed moment (from quick add). */
export function ReminderSheet({
  visible, today, reminders, hasDate, hasTime, onClose, onSave,
}: {
  visible: boolean;
  today: LocalDate;
  reminders: ReminderDraft[];
  hasDate: boolean;
  hasTime: boolean;
  onClose: () => void;
  onSave: (reminders: ReminderDraft[]) => void;
}) {
  const { colors } = useTheme();
  const [list, setList] = useState<ReminderDraft[]>(reminders);
  const [minutes, setMinutes] = useState('');
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setList(reminders);
      setMinutes('');
    }
  }

  const has = (offset: number) => list.some((r) => r.kind === 'before_due' && r.offsetMinutes === offset);
  const add = (offset: number) => !has(offset) && setList((cur) => [...cur, { kind: 'before_due', offsetMinutes: offset }]);
  const custom = Number(minutes);
  const customOk = minutes !== '' && Number.isInteger(custom) && custom >= 0 && custom <= 40320;

  return (
    <Sheet visible={visible} title="Reminders" onClose={onClose} footer={<Button label="Save reminders" onPress={() => onSave(list)} />}>
      {!hasDate ? (
        <Text variant="small" color="overdue">
          This task has no due date, so reminders before it cannot go off. Give it a date first.
        </Text>
      ) : !hasTime ? (
        <Text variant="small" color="textSecondary">
          The task has no time, so reminders count back from 9:00 on the day.
        </Text>
      ) : null}

      <View>
        {list.length === 0 ? (
          <Text variant="small" color="textSecondary">
            No reminders.
          </Text>
        ) : (
          list.map((r, i) => (
            <View key={i} style={[styles.row, { borderBottomColor: colors.divider }]}>
              <Icon name="bell" color={colors.accent} size={16} />
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {reminderText(r, today)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove reminder ${reminderText(r, today)}`}
                onPress={() => setList((cur) => cur.filter((_, j) => j !== i))}
                style={styles.remove}>
                <Icon name="close" color={colors.textSecondary} size={18} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="caption" color="textSecondary">
          Add
        </Text>
        <View style={styles.wrap}>
          {OFFSETS.map((o) => (
            <Chip key={o} label={offsetLabel(o)} selected={has(o)} onPress={() => add(o)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <TextInput
            accessibilityLabel="Minutes before"
            value={minutes}
            onChangeText={(t) => setMinutes(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="Minutes"
            placeholderTextColor={colors.textSecondary}
            maxLength={5}
            style={[typography.body, styles.number, { color: colors.text, borderBottomColor: colors.divider }]}
          />
          <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
            before
          </Text>
          <Button variant="secondary" label="Add" disabled={!customOk} onPress={() => { add(custom); setMinutes(''); }} />
        </View>
      </View>

      <Text variant="caption" color="textSecondary">
        {remindersOnDevice
          ? 'Reminders arrive as notifications even with the app closed. If one is late or missing, check More, Reminders and summaries.'
          : 'In a browser, reminders are saved and synced; the TaskFlow app on your phone shows them.'}
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: 1 },
  remove: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  number: { width: 96, minHeight: 44, borderBottomWidth: 1 },
});
