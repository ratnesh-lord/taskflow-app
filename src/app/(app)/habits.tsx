import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { titleWithEmoji } from '@/core/appearance';
import { localDateOf, longDate, WEEKDAY_SHORT, weekday } from '@/core/dates';
import {
  type DayState, describeSchedule, habitToday, type HabitRecord, lastLoggedAt, lastSevenDays, parseSchedule, progressWords, sinceWords, streakOf,
} from '@/core/habits';
import { SmallButton } from '@/components/ActionRow';
import { HabitSheet } from '@/components/HabitSheet';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { PageHeader } from '@/ui/PageHeader';
import { SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const STATE_WORDS: Record<DayState, string> = {
  done: 'done', partial: 'partly done', missed: 'missed', open: 'not yet', rest: 'not needed', before: 'before it started', future: '',
};

/** More → Habits: today's count for each habit, the last seven days and streaks. */
export default function Habits() {
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const [editing, setEditing] = useState<HabitRecord | 'new' | null>(null);
  const active = data.habits.filter((h) => h.status === 'active');
  const archived = data.habits.filter((h) => h.status === 'archived');
  const current = editing && editing !== 'new' ? data.habits.find((h) => h.id === editing.id) ?? null : null;

  const dueLeft = active.filter((h) => habitToday(h, data.habitLogs.get(h.id) ?? [], now.date).due).length;

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Habits" subtitle={`${longDate(now.date)}${active.length ? ` · ${dueLeft ? `${plural(dueLeft, 'habit')} to do` : 'all done for today'}` : ''}`} />
      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" label="New habit" onPress={() => setEditing('new')} />
      </View>

      {active.length === 0 ? (
        <Text variant="small" color="textSecondary">
          A habit is something you do regularly: drink 8 glasses of water a day, run three days a week, take medicine each morning. Tap + each time you do it; a day counts once you reach its target.
        </Text>
      ) : (
        <View>
          {active.map((h) => (
            <HabitRow key={h.id} habit={h} onEdit={() => setEditing(h)} />
          ))}
        </View>
      )}

      {archived.length ? (
        <View>
          <SectionTitle>{`Archived · ${archived.length}`}</SectionTitle>
          {archived.map((h) => (
            <Pressable key={h.id} accessibilityRole="button" onPress={() => setEditing(h)} style={{ paddingVertical: space.sm }}>
              <Text variant="body" color="textSecondary">
                {titleWithEmoji(h)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <HabitSheet
        visible={editing !== null}
        habit={current}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          const result = current ? await run(() => actions.updateHabit(current.id, input)) : await run(() => actions.createHabit(input), `Added ${input.title}`);
          if (result) setEditing(null);
        }}
        onArchive={
          current
            ? () => {
                setEditing(null);
                const archive = current.status === 'active';
                void run(() => actions.updateHabit(current.id, { status: archive ? 'archived' : 'active' }), archive ? `Archived ${current.title}` : `${current.title} is active`);
              }
            : undefined
        }
        onDelete={
          current
            ? () => {
                setEditing(null);
                void run(() => actions.deleteHabit(current.id), `Deleted ${current.title}`);
              }
            : undefined
        }
      />
    </Screen>
  );
}

function HabitRow({ habit, onEdit }: { habit: HabitRecord; onEdit: () => void }) {
  const { data, actions } = useData();
  const { now, moment } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const logs = data.habitLogs.get(habit.id) ?? [];
  const today = habitToday(habit, logs, now.date);
  const streak = streakOf(habit, logs, now.date);
  const week = lastSevenDays(habit, logs, now.date, localDateOf(new Date(habit.createdAt)));
  const since = sinceWords(lastLoggedAt(logs), moment.getTime());
  const title = titleWithEmoji(habit);

  const details = [
    describeSchedule(parseSchedule(habit.schedule)),
    today.week ? `${today.week.done} of ${today.week.wanted} days this week` : null,
    streak.current ? `Streak ${plural(streak.current, streak.unit)}` : null,
    since ? `Last ${since.toLowerCase()}` : null,
  ].filter(Boolean);

  return (
    <View style={{ paddingVertical: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${progressWords(today, habit.unit)}. Change habit`} onPress={onEdit} style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="small" color={today.done ? 'completed' : 'text'}>
            {progressWords(today, habit.unit)}
          </Text>
        </Pressable>
        {today.count > 0 ? (
          <SmallButton label="−" accessibilityLabel={`Take back one for ${habit.title}`} onPress={() => void run(() => actions.unlogHabit(habit.id, now.date).then((u) => u ?? undefined))} />
        ) : null}
        <SmallButton
          strong={!today.done}
          label={habit.target === 1 ? (today.done ? '+1' : 'Done') : '+1'}
          accessibilityLabel={habit.target === 1 && !today.done ? `Mark ${habit.title} done today` : `Add one to ${habit.title}`}
          onPress={() => void run(() => actions.logHabit(habit.id, now.date), today.count + 1 === habit.target ? `${habit.title}: done for today` : undefined)}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: space.xs }} accessible accessibilityLabel={`Last seven days: ${week.map((d) => `${WEEKDAY_SHORT[weekday(d.date)]} ${STATE_WORDS[d.state]}`).join(', ')}`}>
        {week.map((d) => (
          <View key={d.date} style={{ flex: 1, gap: 2, alignItems: 'center' }}>
            <DaySquare state={d.state} />
            <Text variant="caption" color={d.date === now.date ? 'text' : 'textSecondary'}>
              {WEEKDAY_SHORT[weekday(d.date)].slice(0, 2)}
            </Text>
          </View>
        ))}
      </View>
      <Text variant="caption" color="textSecondary">
        {details.join(' · ')}
      </Text>
    </View>
  );
}

/** Filled when done, half when partly, outlined in red when missed, dashed on a rest day. */
function DaySquare({ state }: { state: DayState }) {
  const { colors } = useTheme();
  const size = 18;
  const base = { width: size, height: size, borderWidth: 1, alignItems: 'center' as const, justifyContent: 'flex-end' as const };
  switch (state) {
    case 'done':
      return <View style={{ ...base, borderColor: colors.completed, backgroundColor: colors.completed }} />;
    case 'partial':
      return (
        <View style={{ ...base, borderColor: colors.completed }}>
          <View style={{ width: size - 2, height: (size - 2) / 2, backgroundColor: colors.completed }} />
        </View>
      );
    case 'missed':
      return <View style={{ ...base, borderColor: colors.overdue }} />;
    case 'open':
      return <View style={{ ...base, borderColor: colors.text }} />;
    case 'rest':
      return <View style={{ ...base, borderColor: colors.divider, borderStyle: 'dashed' }} />;
    default:
      return <View style={{ ...base, borderColor: 'transparent' }} />;
  }
}
