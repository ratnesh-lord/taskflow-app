import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { allItems, compareItems, progressOf } from '@/core/agenda';
import { DateSheet } from '@/components/DateSheet';
import { QuickAddButton } from '@/components/QuickAdd';
import { SelectionBar } from '@/components/SelectionBar';
import { TaskList } from '@/components/TaskList';
import { useSelection } from '@/components/useTaskActions';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { EditableText } from '@/ui/EditableText';
import { deadlineText } from '@/ui/format';
import { FieldRow, MenuRow, SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { FAB_SPACE, space } from '@/ui/tokens';

/** One project: its details, progress and tasks. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, actions } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const router = useRouter();
  const selection = useSelection();
  const [picking, setPicking] = useState(false);

  const project = data.projects.find((p) => p.id === id);
  const items = useMemo(() => allItems(data, now).filter((i) => i.task.projectId === id), [data, now, id]);

  if (!project) {
    return (
      <Screen bottomInset>
        <BackHeader title="Project" />
        <Text variant="heading">This project is not here</Text>
        <Text variant="small" color="textSecondary">
          It may have been deleted. Its tasks are kept, without a project.
        </Text>
      </Screen>
    );
  }

  const progress = progressOf(items);
  const open = items.filter((i) => i.open && i.task.status !== 'archived').sort(compareItems);
  const done = items.filter((i) => !i.open).sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1));
  const archived = project.status === 'archived';
  const late = project.deadline && project.deadline < now.date && progress.open > 0;

  return (
    <Screen
      bottomInset
      bottomSpace={FAB_SPACE}
      overlay={
        <>
          {archived ? null : <QuickAddButton defaults={{ projectId: id }} />}
          <SelectionBar selection={selection} bottomInset />
        </>
      }>
      <BackHeader title={archived ? 'Archived project' : 'Project'} />

      <View style={{ gap: space.xs }}>
        <EditableText
          key={`name-${id}`}
          accessibilityLabel="Project name"
          value={project.name}
          required
          variant="title"
          maxLength={200}
          onSave={(name) => name.trim() !== project.name && void run(() => actions.updateProject(id, { name }))}
        />
        <EditableText
          key={`desc-${id}`}
          accessibilityLabel="Project description"
          value={project.description}
          multiline
          variant="small"
          placeholder="Add a description"
          maxLength={2000}
          onSave={(description) => description !== project.description && void run(() => actions.updateProject(id, { description }))}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
          <Text variant="heading">{progress.percent}%</Text>
          <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
            {progress.total ? `${progress.done} of ${progress.total} done${progress.overdue ? ` · ${progress.overdue} overdue` : ''}` : 'No tasks yet'}
          </Text>
        </View>
        <View style={{ height: 4, backgroundColor: colors.divider }}>
          <View style={{ width: `${progress.percent}%`, height: 4, backgroundColor: colors.completed }} />
        </View>
      </View>

      <FieldRow
        label="Deadline"
        value={project.deadline ? deadlineText(project.deadline, now.date) : null}
        placeholder="None"
        valueColor={late ? 'overdue' : 'text'}
        onPress={() => setPicking(true)}
        last
      />

      <TaskList
        lead="date"
        selection={selection}
        sections={[
          { title: 'To do', items: open },
          { title: 'Done', items: done },
        ]}
        empty={archived ? 'No tasks.' : 'No tasks yet. Tap + to add one to this project.'}
      />

      <View>
        <SectionTitle>Project</SectionTitle>
        <MenuRow
          icon="projects"
          label={archived ? 'Make active again' : 'Archive project'}
          detail={archived ? undefined : 'Hides it from the list'}
          onPress={() => void run(() => actions.updateProject(id, { status: archived ? 'active' : 'archived' }), archived ? 'Project is active' : 'Project archived')}
        />
        <MenuRow
          icon="trash"
          label="Delete project"
          detail="Tasks are kept"
          danger
          onPress={async () => {
            const undo = await run(() => actions.deleteProject(id), `Deleted ${project.name}`);
            if (undo) {
              if (router.canGoBack()) router.back();
              else router.replace('/projects');
            }
          }}
        />
      </View>

      <DateSheet
        visible={picking}
        title="Deadline"
        today={now.date}
        date={project.deadline}
        time={null}
        withTime={false}
        onClose={() => setPicking(false)}
        onPick={(date) => {
          setPicking(false);
          void run(() => actions.updateProject(id, { deadline: date }));
        }}
      />
    </Screen>
  );
}
