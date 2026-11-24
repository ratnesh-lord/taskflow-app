import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { titleWithEmoji } from '@/core/appearance';
import { daysLeftWords, type GoalRecord, type GoalProgress, goalItems, goalProgress, GOAL_STATUS_LABEL, sortGoals } from '@/core/goals';
import { Meter } from '@/components/BarChart';
import { NameSheet } from '@/components/NameSheet';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { PageHeader } from '@/ui/PageHeader';
import { SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

/** More → Goals: what you are working towards, each made of the tasks linked to it. */
export default function Goals() {
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () => sortGoals(data.goals).map((g) => ({ goal: g, progress: goalProgress(g, goalItems(data, g.id, now), now.date) })),
    [data, now],
  );
  const active = rows.filter((r) => r.goal.status === 'active');
  const closed = rows.filter((r) => r.goal.status !== 'active');

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Goals" subtitle={active.length ? plural(active.length, 'active goal') : undefined} />
      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" label="New goal" onPress={() => setCreating(true)} />
      </View>

      {active.length === 0 ? (
        <Text variant="small" color="textSecondary">
          A goal is something you want to achieve, such as “Run a half marathon”. Link tasks to it, from the goal or from each task, and its progress is the share of those tasks done.
        </Text>
      ) : (
        <View>
          {active.map((r) => (
            <GoalRow key={r.goal.id} goal={r.goal} progress={r.progress} onPress={() => router.push(`/goal/${r.goal.id}`)} />
          ))}
        </View>
      )}

      {closed.length ? (
        <View>
          <SectionTitle>{`Achieved and dropped · ${closed.length}`}</SectionTitle>
          {closed.map((r) => (
            <GoalRow key={r.goal.id} goal={r.goal} progress={r.progress} onPress={() => router.push(`/goal/${r.goal.id}`)} />
          ))}
        </View>
      ) : null}

      <NameSheet
        visible={creating}
        title="New goal"
        label="Goal"
        saveLabel="Create goal"
        onClose={() => setCreating(false)}
        onSave={async (title) => {
          const result = await run(() => actions.createGoal({ title }), `Created ${title}`);
          setCreating(false);
          if (result) router.push(`/goal/${result.id}`);
        }}
      />
    </Screen>
  );
}

function GoalRow({ goal, progress, onPress }: { goal: GoalRecord; progress: GoalProgress; onPress: () => void }) {
  const { colors } = useTheme();
  const closed = goal.status !== 'active';
  const details = [
    progress.total ? `${progress.done} of ${plural(progress.total, 'task')} done` : 'No tasks yet',
    closed ? GOAL_STATUS_LABEL[goal.status] : daysLeftWords(progress.daysLeft),
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${goal.title}, ${progress.percent}%, ${details.join(', ')}`}
      onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="bodyStrong" color={closed ? 'textSecondary' : 'text'} numberOfLines={1} style={{ flex: 1 }}>
          {titleWithEmoji(goal)}
        </Text>
        <Text variant="smallStrong" color={closed ? 'textSecondary' : 'text'}>
          {`${progress.percent}%`}
        </Text>
        <Icon name="chevron" color={colors.textSecondary} size={16} />
      </View>
      <Meter percent={progress.percent} color={closed ? colors.textSecondary : undefined} label={`${goal.title}: ${progress.percent}% done`} />
      <Text variant="caption" color={progress.late ? 'overdue' : 'textSecondary'}>
        {details.join(' · ')}
      </Text>
    </Pressable>
  );
}
