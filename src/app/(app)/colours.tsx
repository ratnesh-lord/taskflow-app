import { useState } from 'react';
import { View } from 'react-native';

import type { ColorBy, ColorName } from '@/core/appearance';
import { PRIORITIES, PRIORITY_LABEL, type Priority } from '@/core/types';
import { ColorSheet, Swatch } from '@/components/ColorSheet';
import { useData, useRun } from '@/state/data';
import { useLook } from '@/state/look';
import { useSession } from '@/state/session';
import { BackHeader } from '@/ui/BackHeader';
import { PageHeader } from '@/ui/PageHeader';
import { FieldRow, SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Text } from '@/ui/Text';
import { space, taskColors } from '@/ui/tokens';

const BY: readonly { value: ColorBy; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'project', label: 'Project' },
  { value: 'none', label: 'No colour' },
];

/** More → Colours: what a task's colour bar follows, and each priority's colour. Saved to the account. */
export default function Colours() {
  const { actions } = useData();
  const { user } = useSession();
  const run = useRun();
  const { settings } = useLook();
  const [editing, setEditing] = useState<Priority | null>(null);
  const userId = user?.id ?? '';

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader title="Colours" subtitle="Each task shows a colour bar on its left, in lists, the calendar and the widgets. Your choices apply on every device." />

      <View style={{ gap: space.sm }}>
        <SectionTitle>Colour tasks by</SectionTitle>
        <Segmented label="Colour tasks by" value={settings.by} options={BY} onChange={(by) => void run(() => actions.setColorSettings(userId, { by }))} />
        <Text variant="small" color="textSecondary">
          {settings.by === 'priority'
            ? 'Each task takes its priority’s colour.'
            : settings.by === 'project'
              ? 'Each task takes its project’s colour. Choose a project’s colour on its page; tasks without one have no bar.'
              : 'Tasks have no colour bar. Priorities still show as small squares.'}
        </Text>
      </View>

      <View>
        <SectionTitle>Priority colours</SectionTitle>
        {PRIORITIES.map((p, i) => (
          <FieldRow key={p} label={PRIORITY_LABEL[p]} value={taskColors[settings.priority[p]].label} onPress={() => setEditing(p)} last={i === PRIORITIES.length - 1}>
            <Swatch name={settings.priority[p]} size={14} />
            <Text variant="smallStrong" style={{ flex: 1 }}>
              {taskColors[settings.priority[p]].label}
            </Text>
          </FieldRow>
        ))}
      </View>

      <ColorSheet
        visible={editing !== null}
        title={editing ? `${PRIORITY_LABEL[editing]} priority colour` : ''}
        value={editing ? settings.priority[editing] : null}
        onClose={() => setEditing(null)}
        onPick={(color: ColorName | null) => {
          const p = editing;
          setEditing(null);
          if (p && color) void run(() => actions.setColorSettings(userId, { priority: { ...settings.priority, [p]: color } }));
        }}
      />
    </Screen>
  );
}
