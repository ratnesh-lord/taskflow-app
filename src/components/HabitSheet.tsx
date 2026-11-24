import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { emojiOf, formatIcon } from '@/core/appearance';
import { WEEKDAY_SHORT } from '@/core/dates';
import { describeSchedule, formatSchedule, HABIT_EMOJI, type HabitRecord, MAX_TARGET, parseSchedule, type Schedule } from '@/core/habits';
import type { HabitInput } from '@/data/actions';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Segmented } from '@/ui/Segmented';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';
import { space } from '@/ui/tokens';

type Kind = Schedule['kind'];
const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'days', label: 'Some days' },
  { value: 'week', label: 'Days a week' },
];
/** Monday first, as weeks are shown. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const TIMES = [
  { label: '08:00', time: '08:00' },
  { label: '12:00', time: '12:00' },
  { label: '18:00', time: '18:00' },
  { label: '21:00', time: '21:00' },
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Draft = { title: string; emoji: string | null; kind: Kind; days: number[]; times: number; target: string; unit: string; reminder: string };

function draftOf(habit: HabitRecord | null): Draft {
  const s = parseSchedule(habit?.schedule);
  return {
    title: habit?.title ?? '',
    emoji: emojiOf(habit?.icon),
    kind: s.kind,
    days: s.kind === 'days' ? s.days : [1, 3, 5],
    times: s.kind === 'week' ? s.times : 3,
    target: String(habit?.target ?? 1),
    unit: habit?.unit ?? '',
    reminder: habit?.reminderTime ?? '',
  };
}

/** Create or change a habit: name, picture, when, how many times a day, and a reminder. */
export function HabitSheet({
  visible, habit, onClose, onSave, onArchive, onDelete,
}: {
  visible: boolean;
  /** The habit being changed, or null for a new one. */
  habit: HabitRecord | null;
  onClose: () => void;
  onSave: (input: HabitInput) => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const { colors } = useTheme();
  const [d, setD] = useState<Draft>(() => draftOf(habit));
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) setD(draftOf(habit));
  }
  const set = (patch: Partial<Draft>) => setD((old) => ({ ...old, ...patch }));

  const target = Number(d.target);
  const targetOk = Number.isInteger(target) && target >= 1 && target <= MAX_TARGET;
  const reminderOk = d.reminder === '' || TIME_RE.test(d.reminder);
  const schedule: Schedule = d.kind === 'daily' ? { kind: 'daily' } : d.kind === 'days' ? { kind: 'days', days: d.days } : { kind: 'week', times: d.times };
  const daysOk = d.kind !== 'days' || d.days.length > 0;
  const ok = d.title.trim().length > 0 && targetOk && reminderOk && daysOk;

  const save = () =>
    onSave({
      title: d.title.trim(),
      icon: d.emoji ? formatIcon({ kind: 'emoji', emoji: d.emoji }) : null,
      schedule: formatSchedule(schedule),
      target,
      unit: d.unit.trim(),
      reminderTime: d.reminder || null,
    });

  return (
    <Sheet
      visible={visible}
      title={habit ? 'Change habit' : 'New habit'}
      onClose={onClose}
      footer={<Button label={habit ? 'Save' : 'Create habit'} disabled={!ok} onPress={save} />}>
      <TextField label="Habit" value={d.title} onChangeText={(title) => set({ title })} placeholder="e.g. Drink water" maxLength={200} autoFocus={!habit} />

      <View style={{ gap: space.sm }}>
        <Text variant="caption" color="textSecondary">
          Picture
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {HABIT_EMOJI.map((e) => {
            const on = d.emoji === e;
            return (
              <Pressable
                key={e}
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityLabel={e}
                onPress={() => set({ emoji: on ? null : e })}
                style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 2 : 1, borderColor: on ? colors.text : colors.divider }}>
                <Text variant="heading">{e}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="caption" color="textSecondary">
          When
        </Text>
        <Segmented label="When" value={d.kind} options={KINDS} onChange={(kind) => set({ kind })} />
        {d.kind === 'days' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
            {WEEK.map((day) => (
              <Chip
                key={day}
                label={WEEKDAY_SHORT[day]}
                selected={d.days.includes(day)}
                onPress={() => set({ days: d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day] })}
              />
            ))}
          </View>
        ) : null}
        {d.kind === 'week' ? (
          <Segmented
            label="Days a week"
            value={String(d.times)}
            options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(v) => set({ times: Number(v) })}
          />
        ) : null}
        <Text variant="small" color={daysOk ? 'textSecondary' : 'overdue'}>
          {daysOk ? describeSchedule(parseSchedule(formatSchedule(schedule))) : 'Choose at least one day.'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <TextField
            label="Times a day"
            value={d.target}
            onChangeText={(target) => set({ target: target.replace(/[^0-9]/g, '') })}
            keyboardType="number-pad"
            maxLength={4}
            error={targetOk ? null : `1 to ${MAX_TARGET}`}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label="Unit (optional)" value={d.unit} onChangeText={(unit) => set({ unit })} placeholder="glasses" maxLength={30} />
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <TextField
          label="Reminder (HH:MM, optional)"
          value={d.reminder}
          onChangeText={(reminder) => set({ reminder: reminder.replace(/[^0-9:]/g, '') })}
          placeholder="Off"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          error={reminderOk ? null : 'Use a 24-hour time such as 08:30'}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {TIMES.map((t) => (
            <Chip key={t.time} label={t.label} selected={d.reminder === t.time} onPress={() => set({ reminder: d.reminder === t.time ? '' : t.time })} />
          ))}
          {d.reminder ? <Chip label="Off" onPress={() => set({ reminder: '' })} /> : null}
        </View>
        <Text variant="caption" color="textSecondary">
          The reminder rings on the Android app on each day the habit still needs doing.
        </Text>
      </View>

      {habit && (onArchive || onDelete) ? (
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {onArchive ? <Button variant="secondary" label={habit.status === 'archived' ? 'Make active again' : 'Archive'} onPress={onArchive} /> : null}
          {onDelete ? <Button variant="quiet" label="Delete habit and its history" onPress={onDelete} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}
