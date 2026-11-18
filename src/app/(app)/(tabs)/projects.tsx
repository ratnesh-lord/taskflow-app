import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { allItems, progressOf, type Progress } from '@/core/agenda';
import { ProjectSheet } from '@/components/ProjectSheet';
import { HeaderTools } from '@/components/HeaderTools';
import { QuickAddButton } from '@/components/QuickAdd';
import type { ProjectRecord } from '@/data/snapshot';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { deadlineText, plural } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { PageHeader } from '@/ui/PageHeader';
import { SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { FAB_SPACE, space } from '@/ui/tokens';

export default function Projects() {
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const items = allItems(data, now);
    return data.projects.map((p) => ({ project: p, progress: progressOf(items.filter((i) => i.task.projectId === p.id)) }));
  }, [data, now]);
  const active = rows.filter((r) => r.project.status === 'active');
  const archived = rows.filter((r) => r.project.status === 'archived');

  return (
    <Screen bottomSpace={FAB_SPACE} overlay={<QuickAddButton />}>
      <PageHeader right={<HeaderTools />} title="Projects" subtitle={active.length ? plural(active.length, 'active project') : undefined} />
      <View style={{ alignItems: 'flex-start' }}>
        <Button variant="secondary" label="New project" onPress={() => setCreating(true)} />
      </View>

      {active.length === 0 ? (
        <Text variant="small" color="textSecondary">
          Projects group the tasks for one goal and show how far along it is. Type @name in quick add to put a task in a project.
        </Text>
      ) : (
        <View>
          {active.map((r) => (
            <ProjectRow key={r.project.id} project={r.project} progress={r.progress} onPress={() => router.push(`/project/${r.project.id}`)} />
          ))}
        </View>
      )}

      {archived.length ? (
        <View>
          <SectionTitle>{`Archived · ${archived.length}`}</SectionTitle>
          {archived.map((r) => (
            <ProjectRow key={r.project.id} project={r.project} progress={r.progress} onPress={() => router.push(`/project/${r.project.id}`)} />
          ))}
        </View>
      ) : null}

      <ProjectSheet
        visible={creating}
        title="New project"
        saveLabel="Create project"
        onClose={() => setCreating(false)}
        onSave={async (name, description) => {
          const result = await run(() => actions.createProject({ name, description }), `Created ${name}`);
          setCreating(false);
          if (result) router.push(`/project/${result.id}`);
        }}
      />
    </Screen>
  );
}

function ProjectRow({ project, progress, onPress }: { project: ProjectRecord; progress: Progress; onPress: () => void }) {
  const { colors } = useTheme();
  const { now } = useNow();
  const archived = project.status === 'archived';
  const late = !archived && project.deadline && project.deadline < now.date && progress.open > 0;
  const details = [
    progress.total ? `${progress.done}/${progress.total} done` : 'No tasks yet',
    progress.overdue ? `${progress.overdue} overdue` : null,
    project.deadline ? deadlineText(project.deadline, now.date) : null,
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${project.name}, ${details.join(', ')}`}
      onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="bodyStrong" color={archived ? 'textSecondary' : 'text'} numberOfLines={1} style={{ flex: 1 }}>
          {project.name}
        </Text>
        <Text variant="smallStrong" color={archived ? 'textSecondary' : 'text'}>
          {progress.percent}%
        </Text>
        <Icon name="chevron" color={colors.textSecondary} size={16} />
      </View>
      <View style={{ height: 3, backgroundColor: colors.divider }}>
        <View style={{ width: `${progress.percent}%`, height: 3, backgroundColor: archived ? colors.textSecondary : colors.completed }} />
      </View>
      <Text variant="caption" color={late || progress.overdue ? 'overdue' : 'textSecondary'}>
        {details.join(' · ')}
      </Text>
    </Pressable>
  );
}
