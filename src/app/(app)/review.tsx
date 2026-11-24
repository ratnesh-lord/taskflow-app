import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import type { TaskItem } from '@/core/agenda';
import { completionRate, donePerDay } from '@/core/analytics';
import { titleWithEmoji } from '@/core/appearance';
import { addDays, localDateOf, MONTH_SHORT, parts, shortDate, startOfWeek, WEEKDAY_SHORT, weekday } from '@/core/dates';
import { focusTotals, minutesWords } from '@/core/focus';
import { daysLeftWords, goalItems, goalProgress, sortGoals } from '@/core/goals';
import { completionRate as habitRate, parseSchedule } from '@/core/habits';
import { weekReview } from '@/core/planning';
import { ActionRow } from '@/components/ActionRow';
import { BarChart, Meter, Stat, StatRow } from '@/components/BarChart';
import { DateSheet } from '@/components/DateSheet';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { EditableText } from '@/ui/EditableText';
import { plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { MenuRow, SectionTitle } from '@/ui/Row';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space, TOUCH } from '@/ui/tokens';

const toLocal = (iso: string) => localDateOf(new Date(iso));
const dm = (date: string) => `${parts(date).day} ${MONTH_SHORT[parts(date).month - 1]}`;

/**
 * More → Weekly review: the last seven days (what got done, what slipped),
 * goals and habits, the seven days ahead, and a note for the week.
 */
export default function WeeklyReview() {
  const { data, actions } = useData();
  const { now, moment } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const router = useRouter();
  const selection = useSelection();
  const [moving, setMoving] = useState<TaskItem | null>(null);
  const [allDone, setAllDone] = useState(false);
  const today = now.date;
  const monday = startOfWeek(today);

  const review = useMemo(() => weekReview(data, now, toLocal), [data, now]);
  const perDay = useMemo(() => donePerDay(data, review.from, today, toLocal), [data, review.from, today]);
  const rate = useMemo(() => completionRate(data, review.from, today), [data, review.from, today]);
  const focus = useMemo(() => focusTotals(data.focusSessions, review.from, today, moment.getTime(), toLocal), [data.focusSessions, review.from, today, moment]);
  const goals = sortGoals(data.goals.filter((g) => g.status === 'active'));
  const habits = data.habits.filter((h) => h.status === 'active');
  const note = data.notes.get(`week:${monday}`);
  const reviewed = !!note?.plannedAt;

  const done = allDone ? review.done : review.done.slice(0, 10);
  const move = (item: TaskItem, date: string) => void run(() => actions.reschedule([item.task.id], date, undefined, 'occurrence', item.occurrence?.date), `Moved to ${shortDate(date, today)}`);

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Weekly review" subtitle={`${dm(review.from)} to ${dm(today)}`} />
      {reviewed ? (
        <Text variant="small" color="completed">
          {`This week was reviewed on ${shortDate(toLocal(note!.plannedAt!), today)}.`}
        </Text>
      ) : null}

      <StatRow>
        <Stat value={String(review.done.length)} label="Done" tone={review.done.length ? 'completed' : undefined} />
        <Stat value={rate.percent == null ? '–' : `${rate.percent}%`} label="Of what was due" />
        <Stat value={String(review.slipped.length)} label="Slipped" tone={review.slipped.length ? 'overdue' : undefined} />
        <Stat value={minutesWords(focus.minutes)} label="Focus" />
      </StatRow>
      <BarChart
        title="Completed per day"
        height={72}
        bars={perDay.map((d) => ({ key: d.date, label: WEEKDAY_SHORT[weekday(d.date)].slice(0, 2), value: d.count, detail: `${WEEKDAY_SHORT[weekday(d.date)]} ${dm(d.date)}: ${plural(d.count, 'task')}` }))}
        empty="Nothing completed in the last seven days."
      />

      <View>
        <TaskList lead="date" selection={selection} sections={[{ title: '1 · Done', items: done }]} empty="1 · Nothing completed in the last seven days." />
        {review.done.length > done.length ? <MenuRow label={`Show all ${review.done.length}`} onPress={() => setAllDone(true)} /> : null}
      </View>

      <View>
        <SectionTitle color={review.slipped.length ? 'overdue' : 'textSecondary'}>{`2 · Slipped · ${review.slipped.length}`}</SectionTitle>
        {review.slipped.length === 0 ? (
          <Text variant="small" color="textSecondary">
            Nothing overdue. Well done.
          </Text>
        ) : (
          <>
            <Text variant="small" color="textSecondary" style={{ paddingBottom: space.sm }}>
              Give each one a new day, or open it to drop it.
            </Text>
            {review.slipped.map((item) => (
              <ActionRow
                key={item.key}
                item={item}
                onOpen={() => router.push(`/task/${item.task.id}`)}
                actions={[
                  { label: 'Tomorrow', accessibilityLabel: `Move ${titleWithEmoji(item.task)} to tomorrow`, onPress: () => move(item, addDays(today, 1)) },
                  { label: 'Move', accessibilityLabel: `Choose a new day for ${titleWithEmoji(item.task)}`, onPress: () => setMoving(item) },
                ]}
              />
            ))}
          </>
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle>{`3 · Goals · ${goals.length}`}</SectionTitle>
        {goals.length === 0 ? (
          <MenuRow icon="target" label="Set a goal" detail="Goals collect the tasks that lead to them" onPress={() => router.push('/goals')} />
        ) : (
          goals.map((g) => {
            const p = goalProgress(g, goalItems(data, g.id, now), today);
            return (
              <Pressable key={g.id} accessibilityRole="button" onPress={() => router.push(`/goal/${g.id}`)} style={{ gap: space.xs, paddingVertical: space.xs }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                    {titleWithEmoji(g)}
                  </Text>
                  <Text variant="smallStrong">{`${p.percent}%`}</Text>
                </View>
                <Meter percent={p.percent} label={`${g.title}: ${p.percent}% done`} />
                <Text variant="caption" color={p.late ? 'overdue' : 'textSecondary'}>
                  {[`${p.done} of ${plural(p.total, 'task')}`, daysLeftWords(p.daysLeft)].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>

      {habits.length ? (
        <View style={{ gap: space.xs }}>
          <SectionTitle>4 · Habits</SectionTitle>
          {habits.map((h) => {
            const r = habitRate(h, data.habitLogs.get(h.id) ?? [], review.from, today, today, toLocal(h.createdAt));
            return (
              <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: space.xs }}>
                <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {titleWithEmoji(h)}
                </Text>
                <Text variant="small" color="textSecondary">
                  {r.total === 0 ? 'Not yet due' : `${r.done} of ${plural(r.total, parseSchedule(h.schedule).kind === 'week' ? 'week' : 'day')}`}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <View>
        <SectionTitle>{`${habits.length ? 5 : 4} · The next seven days`}</SectionTitle>
        {review.next.length === 0 ? (
          <Text variant="small" color="textSecondary">
            Nothing planned yet. Plan from Upcoming or Plan my day.
          </Text>
        ) : (
          review.next.map((d) => (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityLabel={`${WEEKDAY_SHORT[weekday(d.date)]} ${dm(d.date)}: ${plural(d.items.length, 'task')}`}
              onPress={() => router.push('/upcoming')}
              style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <Text variant="smallStrong" style={{ width: 96 }}>
                {`${WEEKDAY_SHORT[weekday(d.date)]} ${dm(d.date)}`}
              </Text>
              <Text variant="small" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
                {d.items.slice(0, 3).map((i) => titleWithEmoji(i.task)).join(', ')}
              </Text>
              <Text variant="smallStrong">{String(d.items.length)}</Text>
              <Icon name="chevron" color={colors.textSecondary} size={18} />
            </Pressable>
          ))
        )}
      </View>

      <View style={{ gap: space.sm }}>
        <SectionTitle>{`${habits.length ? 6 : 5} · Notes for the week`}</SectionTitle>
        <EditableText
          key={`week-${monday}`}
          accessibilityLabel="Notes for the week"
          value={note?.body ?? ''}
          multiline
          variant="body"
          placeholder="What went well? What got in the way? What matters most next week?"
          maxLength={20000}
          onSave={(body) => body !== (note?.body ?? '') && void run(() => actions.saveNote('week', monday, body))}
        />
        <Text variant="caption" color="textSecondary">{`Kept with the week starting Monday ${dm(monday)}.`}</Text>
      </View>

      <Button
        label={reviewed ? 'Reviewed' : 'Done reviewing'}
        variant={reviewed ? 'secondary' : 'primary'}
        onPress={() => void run(() => actions.setPlanned('week', monday, !reviewed), reviewed ? 'Marked as not reviewed' : 'Week reviewed')}
      />

      <DateSheet
        visible={moving !== null}
        title="Move to"
        today={today}
        date={addDays(today, 1)}
        time={null}
        withTime={false}
        onClose={() => setMoving(null)}
        onPick={(date) => {
          const item = moving;
          setMoving(null);
          if (item && date) move(item, date);
        }}
      />
    </Screen>
  );
}
