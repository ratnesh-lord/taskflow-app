import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import type { TaskItem } from '@/core/agenda';
import { titleWithEmoji } from '@/core/appearance';
import { addDays, localDateOf, longDate } from '@/core/dates';
import { dayPlan, plannedWords } from '@/core/planning';
import { ActionRow } from '@/components/ActionRow';
import { DateSheet } from '@/components/DateSheet';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { EditableText } from '@/ui/EditableText';
import { plural, showTime } from '@/ui/format';
import { MenuRow, SectionTitle } from '@/ui/Row';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const toLocal = (iso: string) => localDateOf(new Date(iso));
const timeOf = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * More → Plan my day (and the morning summary notification): deal with what
 * is overdue, see today's load, add more from the undated and the coming
 * week, and write a note for the day.
 */
export default function PlanMyDay() {
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const router = useRouter();
  const selection = useSelection();
  const [moving, setMoving] = useState<TaskItem | null>(null);
  const [showAll, setShowAll] = useState(false);
  const today = now.date;

  const plan = useMemo(() => dayPlan(data, now, toLocal), [data, now]);
  const note = data.notes.get(`day:${today}`);
  const planned = note?.plannedAt ? toLocal(note.plannedAt) === today : false;

  const move = (item: TaskItem, date: string, message: string) =>
    void run(() => actions.reschedule([item.task.id], date, undefined, 'occurrence', item.occurrence?.date), message);

  const toToday = (item: TaskItem): { label: string; onPress: () => void; accessibilityLabel: string } => ({
    label: 'Today',
    accessibilityLabel: `Move ${titleWithEmoji(item.task)} to today`,
    onPress: () => move(item, today, 'Moved to today'),
  });

  const candidates = [...plan.undated, ...plan.soon];
  const shown = showAll ? candidates : candidates.slice(0, 8);
  const load = plannedWords(plan.minutes);

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Plan my day" subtitle={longDate(today)} />

      {planned ? (
        <Text variant="small" color="completed">
          {`Planned at ${showTime(timeOf(note!.plannedAt!))}.`}
        </Text>
      ) : null}

      {plan.overdue.length ? (
        <View>
          <SectionTitle color="overdue">{`1 · Overdue · ${plan.overdue.length}`}</SectionTitle>
          <Text variant="small" color="textSecondary" style={{ paddingBottom: space.sm }}>
            Bring each one to today, or give it a new day.
          </Text>
          {plan.overdue.map((item) => (
            <ActionRow
              key={item.key}
              item={item}
              onOpen={() => router.push(`/task/${item.task.id}`)}
              actions={[
                toToday(item),
                { label: 'Move', accessibilityLabel: `Choose a new day for ${titleWithEmoji(item.task)}`, onPress: () => setMoving(item) },
              ]}
            />
          ))}
        </View>
      ) : (
        <View>
          <SectionTitle>1 · Overdue</SectionTitle>
          <Text variant="small" color="textSecondary">
            Nothing overdue.
          </Text>
        </View>
      )}

      <View style={{ gap: space.xs }}>
        <SectionTitle>{`2 · Today · ${plan.today.length}`}</SectionTitle>
        <Text variant="small" color="textSecondary">
          {plan.today.length === 0
            ? 'Nothing on today yet. Add some below.'
            : load
              ? `About ${load} of work${plan.unestimated ? `, plus ${plural(plan.unestimated, 'task')} without an estimate` : ''}.`
              : 'None of these has a time estimate yet. Add one on a task to see how full the day is.'}
        </Text>
      </View>
      <TaskList lead="time" selection={selection} sections={[{ items: plan.today }]} />

      <View>
        <SectionTitle>{`3 · Add to today · ${candidates.length}`}</SectionTitle>
        {candidates.length === 0 ? (
          <Text variant="small" color="textSecondary">
            No tasks without a date, and nothing in the next seven days.
          </Text>
        ) : (
          <>
            <Text variant="small" color="textSecondary" style={{ paddingBottom: space.sm }}>
              Tasks without a date first, by priority, then the next seven days.
            </Text>
            {shown.map((item) => (
              <ActionRow key={item.key} item={item} onOpen={() => router.push(`/task/${item.task.id}`)} actions={[toToday(item)]} />
            ))}
            {candidates.length > shown.length ? (
              <MenuRow label={`Show all ${candidates.length}`} onPress={() => setShowAll(true)} />
            ) : null}
          </>
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle>4 · Note for today</SectionTitle>
        <EditableText
          key={`note-${today}`}
          accessibilityLabel="Note for today"
          value={note?.body ?? ''}
          multiline
          variant="body"
          placeholder="What matters most today? Anything to remember?"
          maxLength={20000}
          onSave={(body) => body !== (note?.body ?? '') && void run(() => actions.saveNote('day', today, body))}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Button
          label={planned ? 'Planned' : 'Done planning'}
          variant={planned ? 'secondary' : 'primary'}
          onPress={() => void run(() => actions.setPlanned('day', today, !planned), planned ? 'Marked as not planned' : 'Day planned')}
        />
        <MenuRow icon="timer" label="Start a focus session" onPress={() => router.push('/focus')} />
        <MenuRow icon="note" label="All notes" onPress={() => router.push('/notes')} />
      </View>

      <DateSheet
        visible={moving !== null}
        title="Move to"
        today={today}
        date={moving?.date ?? addDays(today, 1)}
        time={moving?.time ?? null}
        withTime={false}
        onClose={() => setMoving(null)}
        onPick={(date) => {
          const item = moving;
          setMoving(null);
          if (item && date) move(item, date, 'Moved');
        }}
      />
    </Screen>
  );
}
