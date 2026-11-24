import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { todayView } from '@/core/agenda';
import { busiestWeekday, completionRate, doneBetween, doneByPriority, doneByProject, doneCounts, donePerDay, total } from '@/core/analytics';
import { titleWithEmoji } from '@/core/appearance';
import { addDays, localDateOf, MONTH_SHORT, parts, WEEKDAY_LONG, WEEKDAY_SHORT, weekday } from '@/core/dates';
import { focusMinutesByDay, focusTotals, minutesWords } from '@/core/focus';
import { completionRate as habitRate, streakOf } from '@/core/habits';
import { PRIORITY_LABEL } from '@/core/types';
import { BarChart, Meter, Stat, StatRow } from '@/components/BarChart';
import { useData } from '@/state/data';
import { useLook } from '@/state/look';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { plural } from '@/ui/format';
import { PageHeader } from '@/ui/PageHeader';
import { SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

type Period = 'week' | 'month';
const PERIODS: readonly { value: Period; label: string }[] = [
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
];

const toLocal = (iso: string) => localDateOf(new Date(iso));

function dayWords(date: string): string {
  const p = parts(date);
  return `${WEEKDAY_SHORT[weekday(date)]} ${p.day} ${MONTH_SHORT[p.month - 1]}`;
}

/** More → Analytics: what got done, how much of what was due, focus time and habit streaks. */
export default function Analytics() {
  const { data } = useData();
  const { now, moment } = useNow();
  const { colors } = useTheme();
  const look = useLook();
  const [period, setPeriod] = useState<Period>('week');
  const today = now.date;
  const days = period === 'week' ? 7 : 30;
  const from = addDays(today, -(days - 1));
  const nowMs = moment.getTime();

  const counts = useMemo(() => doneCounts(data, today, toLocal), [data, today]);
  const overdue = useMemo(() => todayView(data, now, toLocal).stats.overdue, [data, now]);
  const perDay = useMemo(() => donePerDay(data, from, today, toLocal), [data, from, today]);
  const rate = useMemo(() => completionRate(data, from, today), [data, from, today]);
  const items = useMemo(() => doneBetween(data, from, today, toLocal), [data, from, today]);
  const focusByDay = useMemo(() => focusMinutesByDay(data.focusSessions, nowMs, toLocal), [data.focusSessions, nowMs]);
  const focus = useMemo(() => focusTotals(data.focusSessions, from, today, nowMs, toLocal), [data.focusSessions, from, today, nowMs]);

  const projects = new Map(data.projects.map((p) => [p.id, p.name]));
  const byProject = doneByProject(items).slice(0, 6);
  const byPriority = doneByPriority(items);
  const busiest = busiestWeekday(perDay);
  const maxProject = Math.max(1, ...byProject.map((g) => g.count));
  const maxPriority = Math.max(1, ...byPriority.map((g) => g.count));

  const label = (date: string, i: number) => (days === 7 ? WEEKDAY_SHORT[weekday(date)].slice(0, 2) : i % 5 === 0 || i === days - 1 ? String(parts(date).day) : '');
  const doneBars = perDay.map((d, i) => ({ key: d.date, label: label(d.date, i), value: d.count, detail: `${dayWords(d.date)}: ${plural(d.count, 'task')} done` }));
  const focusBars = perDay.map((d, i) => {
    const m = focusByDay.get(d.date) ?? 0;
    return { key: d.date, label: label(d.date, i), value: m, detail: `${dayWords(d.date)}: ${minutesWords(m)} of focus` };
  });

  const habits = data.habits.filter((h) => h.status === 'active');

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Analytics" subtitle="Worked out on this device from your tasks, focus sessions and habits." />

      <StatRow>
        <Stat value={String(counts.today)} label="Done today" />
        <Stat value={String(counts.week)} label="Done this week" />
        <Stat value={String(counts.month)} label="Done this month" />
        <Stat value={String(overdue)} label="Overdue now" tone={overdue > 0 ? 'overdue' : undefined} />
      </StatRow>

      <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />

      <View style={{ gap: space.sm }}>
        <SectionTitle>Completion rate</SectionTitle>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
          <Text variant="heading">{rate.percent == null ? '–' : `${rate.percent}%`}</Text>
          <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
            {rate.due === 0 ? 'Nothing was due in this period.' : `${rate.done} of ${plural(rate.due, 'task')} due in this period ${rate.done === 1 ? 'was' : 'were'} done`}
          </Text>
        </View>
        <Meter percent={rate.percent ?? 0} label="Completion rate" />
        <Text variant="caption" color="textSecondary">
          Each occurrence of a repeating task counts once. Skipped ones are left out. Today counts once its tasks are done.
        </Text>
      </View>

      <BarChart title={`Completed per day · ${total(perDay)}`} bars={doneBars} empty="Nothing completed in this period." />
      {busiest != null ? (
        <Text variant="small" color="textSecondary">
          {`Your busiest day was ${WEEKDAY_LONG[busiest]}.`}
        </Text>
      ) : null}

      <BarChart title={`Focus per day · ${minutesWords(focus.minutes)}`} bars={focusBars} empty={focus.sessions ? 'Less than a minute of focus in this period.' : 'No focus sessions in this period. Start one from More → Focus timer.'} />
      {focus.sessions > 0 ? (
        <Text variant="small" color="textSecondary">
          {`${plural(focus.sessions, 'session')}, ${focus.finished} finished on time.`}
        </Text>
      ) : null}

      {byProject.length ? (
        <View style={{ gap: space.sm }}>
          <SectionTitle>Done by project</SectionTitle>
          {byProject.map((g) => {
            const name = g.key ? projects.get(g.key) ?? 'Deleted project' : 'No project';
            return (
              <View key={g.key ?? 'none'} accessible accessibilityLabel={`${name}: ${g.count}`} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                  <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
                    {name}
                  </Text>
                  <Text variant="smallStrong">{String(g.count)}</Text>
                </View>
                <Meter percent={(g.count / maxProject) * 100} color={look.projectHex(g.key) ?? colors.textSecondary} label={name} />
              </View>
            );
          })}
        </View>
      ) : null}

      {items.length ? (
        <View style={{ gap: space.sm }}>
          <SectionTitle>Done by priority</SectionTitle>
          {byPriority.map((g) => (
            <View key={g.key} accessible accessibilityLabel={`${PRIORITY_LABEL[g.key]}: ${g.count}`} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="small">{PRIORITY_LABEL[g.key]}</Text>
                <Text variant="smallStrong">{String(g.count)}</Text>
              </View>
              <Meter percent={(g.count / maxPriority) * 100} color={look.priorityHex(g.key)} label={PRIORITY_LABEL[g.key]} />
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <SectionTitle>Habits</SectionTitle>
        {habits.length === 0 ? (
          <Text variant="small" color="textSecondary">
            No habits yet. Add one in More → Habits to see streaks here.
          </Text>
        ) : (
          habits.map((h) => {
            const logs = data.habitLogs.get(h.id) ?? [];
            const streak = streakOf(h, logs, today);
            const r = habitRate(h, logs, from, today, today, toLocal(h.createdAt));
            const unit = streak.unit === 'week' ? 'week' : 'day';
            return (
              <View key={h.id} style={{ paddingVertical: space.xs, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {titleWithEmoji(h)}
                </Text>
                <Text variant="small" color="textSecondary">
                  {`Streak ${plural(streak.current, unit)} · Best ${plural(streak.best, unit)}${r.percent == null ? '' : ` · ${r.percent}% of ${unit}s in this period`}`}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}
