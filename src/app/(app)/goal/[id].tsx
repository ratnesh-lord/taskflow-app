import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { compareItems } from '@/core/agenda';
import { titleWithEmoji } from '@/core/appearance';
import { daysLeftWords, goalItems, goalProgress, type GoalStatus } from '@/core/goals';
import { ActionRow } from '@/components/ActionRow';
import { Meter } from '@/components/BarChart';
import { DateSheet } from '@/components/DateSheet';
import { PictureSheet } from '@/components/PictureSheet';
import { QuickAddButton } from '@/components/QuickAdd';
import { TaskList } from '@/components/TaskList';
import { TaskPicture } from '@/components/TaskPicture';
import { TaskPickerSheet } from '@/components/TaskPickerSheet';
import { useSelection } from '@/components/useTaskActions';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { BackHeader } from '@/ui/BackHeader';
import { EditableText } from '@/ui/EditableText';
import { deadlineText, plural } from '@/ui/format';
import { FieldRow, MenuRow, SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { FAB_SPACE, space } from '@/ui/tokens';

const STATUSES: readonly { value: GoalStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'achieved', label: 'Achieved' },
  { value: 'dropped', label: 'Dropped' },
];

/** One goal: its details, progress and the tasks linked to it. */
export default function GoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const router = useRouter();
  const selection = useSelection();
  const [dating, setDating] = useState(false);
  const [picturing, setPicturing] = useState(false);
  const [adding, setAdding] = useState(false);

  const goal = data.goals.find((g) => g.id === id);
  const items = useMemo(() => goalItems(data, id, now), [data, id, now]);
  const linked = useMemo(() => new Set(items.map((i) => i.task.id)), [items]);

  if (!goal) {
    return (
      <Screen bottomInset>
        <BackHeader title="Goal" />
        <Text variant="heading">This goal is not here</Text>
        <Text variant="small" color="textSecondary">
          It may have been deleted. Its tasks are kept.
        </Text>
      </Screen>
    );
  }

  const progress = goalProgress(goal, items, now.date);
  const open = items.filter((i) => i.open).sort(compareItems);
  const done = items.filter((i) => !i.open).sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1));
  const left = daysLeftWords(progress.daysLeft);

  return (
    <Screen bottomInset bottomSpace={FAB_SPACE} overlay={goal.status === 'active' ? <QuickAddButton defaults={{ goalId: id }} /> : null}>
      <BackHeader title="Goal" />

      <View style={{ gap: space.xs }}>
        <EditableText
          key={`title-${id}`}
          accessibilityLabel="Goal name"
          value={goal.title}
          required
          variant="title"
          maxLength={200}
          onSave={(title) => title.trim() !== goal.title && void run(() => actions.updateGoal(id, { title }))}
        />
        <EditableText
          key={`desc-${id}`}
          accessibilityLabel="Why this goal matters"
          value={goal.description}
          multiline
          variant="small"
          placeholder="Why it matters, or what done looks like"
          maxLength={5000}
          onSave={(description) => description !== goal.description && void run(() => actions.updateGoal(id, { description }))}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
          <Text variant="heading">{`${progress.percent}%`}</Text>
          <Text variant="small" color={progress.late ? 'overdue' : 'textSecondary'} style={{ flex: 1 }}>
            {[progress.total ? `${progress.done} of ${plural(progress.total, 'task')} done` : 'No tasks linked yet', goal.status === 'active' ? left : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Meter percent={progress.percent} label={`${progress.percent}% done`} />
      </View>

      <Segmented label="Goal status" value={goal.status} options={STATUSES} onChange={(status) => void run(() => actions.updateGoal(id, { status }), status === 'achieved' ? 'Goal achieved' : undefined)} />

      <View>
        <FieldRow label="Target date" value={goal.targetDate ? deadlineText(goal.targetDate, now.date) : null} placeholder="None" valueColor={progress.late ? 'overdue' : 'text'} onPress={() => setDating(true)} />
        <FieldRow label="Picture" value={goal.icon ? 'Chosen' : null} placeholder="None" onPress={() => setPicturing(true)} last>
          {goal.icon ? (
            <>
              <TaskPicture icon={goal.icon} size={20} />
              <Text variant="smallStrong" color="textSecondary" style={{ flex: 1 }}>
                Change
              </Text>
            </>
          ) : undefined}
        </FieldRow>
      </View>

      <View>
        <SectionTitle>{`To do · ${open.length}`}</SectionTitle>
        <MenuRow icon="plus" label="Link existing tasks" onPress={() => setAdding(true)} />
        {open.map((item) => (
          <ActionRow
            key={item.key}
            item={item}
            onOpen={() => router.push(`/task/${item.task.id}`)}
            actions={[{ label: 'Unlink', accessibilityLabel: `Unlink ${titleWithEmoji(item.task)} from this goal`, onPress: () => void run(() => actions.updateTask(item.task.id, { goalId: null }), 'Unlinked') }]}
          />
        ))}
        {open.length === 0 ? (
          <Text variant="small" color="textSecondary" style={{ paddingTop: space.sm }}>
            {goal.status === 'active' ? 'Tap + to add a task for this goal, or link ones you already have.' : 'Nothing left to do.'}
          </Text>
        ) : null}
      </View>

      <TaskList lead="date" selection={selection} sections={[{ title: 'Done', items: done }]} />

      <View>
        <SectionTitle>Goal</SectionTitle>
        <MenuRow
          icon="trash"
          label="Delete goal"
          detail="Its tasks are kept"
          danger
          onPress={async () => {
            const undo = await run(() => actions.deleteGoal(id), `Deleted ${goal.title}`);
            if (undo) {
              if (router.canGoBack()) router.back();
              else router.replace('/goals');
            }
          }}
        />
      </View>

      <DateSheet
        visible={dating}
        title="Target date"
        today={now.date}
        date={goal.targetDate}
        time={null}
        withTime={false}
        onClose={() => setDating(false)}
        onPick={(date) => {
          setDating(false);
          void run(() => actions.updateGoal(id, { targetDate: date }));
        }}
      />
      <PictureSheet
        visible={picturing}
        value={goal.icon}
        onClose={() => setPicturing(false)}
        onPick={(icon) => {
          setPicturing(false);
          void run(() => actions.updateGoal(id, { icon }));
        }}
      />
      <TaskPickerSheet
        visible={adding}
        title="Link a task"
        exclude={linked}
        onClose={() => setAdding(false)}
        onPick={(taskId) => {
          setAdding(false);
          if (taskId) void run(() => actions.updateTask(taskId, { goalId: id }), 'Linked to this goal');
        }}
      />
    </Screen>
  );
}
