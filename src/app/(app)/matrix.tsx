import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import type { TaskItem } from '@/core/agenda';
import { titleWithEmoji } from '@/core/appearance';
import { shortDate } from '@/core/dates';
import { matrixOf, moveTo, type Quadrant, QUADRANTS, URGENT_DAYS, quadrantOf } from '@/core/matrix';
import { PRIORITY_LABEL } from '@/core/types';
import { ActionRow } from '@/components/ActionRow';
import { OptionSheet } from '@/components/OptionSheet';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { MenuRow } from '@/ui/Row';
import { PageHeader } from '@/ui/PageHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space } from '@/ui/tokens';

const SHOWN = 6;

/**
 * More → Eisenhower matrix: open tasks sorted by urgent (overdue or due
 * within two days) and important (critical or high priority). Moving a task
 * changes its priority or date to match its new box.
 */
export default function Matrix() {
  const { data, actions } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [moving, setMoving] = useState<TaskItem | null>(null);
  const [expanded, setExpanded] = useState<Set<Quadrant>>(new Set());
  const boxes = useMemo(() => matrixOf(data, now), [data, now]);
  const twoColumns = width >= 900;

  function describe(item: TaskItem, target: Quadrant): string {
    const m = moveTo(item, target, now.date);
    const parts = [m.priority ? `${PRIORITY_LABEL[m.priority]} priority` : null, m.date ? `due ${shortDate(m.date, now.date)}` : null].filter(Boolean);
    return parts.length ? parts.join(', ') : 'No change';
  }

  const box = (q: (typeof QUADRANTS)[number]) => {
    const items = boxes[q.key];
    const all = expanded.has(q.key);
    const shown = all ? items : items.slice(0, SHOWN);
    return (
      <View key={q.key} style={{ flex: twoColumns ? 1 : undefined, minWidth: 0, gap: space.xs, paddingTop: space.md, borderTopWidth: 2, borderTopColor: q.key === 'do' ? colors.overdue : q.key === 'schedule' ? colors.accent : colors.text }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
          <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            {q.title}
          </Text>
          <Text variant="smallStrong" color="textSecondary">
            {String(items.length)}
          </Text>
        </View>
        <Text variant="caption" color="textSecondary">
          {q.hint}
        </Text>
        <View>
          {items.length === 0 ? (
            <Text variant="small" color="textSecondary" style={{ paddingVertical: space.sm }}>
              Nothing here.
            </Text>
          ) : (
            shown.map((item) => (
              <ActionRow
                key={item.key}
                item={item}
                onOpen={() => router.push(`/task/${item.task.id}`)}
                actions={[{ label: 'Move', accessibilityLabel: `Move ${titleWithEmoji(item.task)} to another box`, onPress: () => setMoving(item) }]}
              />
            ))
          )}
          {items.length > shown.length ? <MenuRow label={`Show all ${items.length}`} onPress={() => setExpanded(new Set([...expanded, q.key]))} /> : null}
        </View>
      </View>
    );
  };

  const from = moving ? quadrantOf(moving, now.date) : null;

  return (
    <Screen bottomInset>
      <BackHeader />
      <PageHeader
        title="Eisenhower matrix"
        subtitle={`Urgent: overdue or due within ${URGENT_DAYS} days. Important: critical or high priority. Moving a task changes its priority or date to fit.`}
      />
      {twoColumns ? (
        <View style={{ gap: space.xl }}>
          <View style={{ flexDirection: 'row', gap: space.xl }}>{QUADRANTS.slice(0, 2).map(box)}</View>
          <View style={{ flexDirection: 'row', gap: space.xl }}>{QUADRANTS.slice(2).map(box)}</View>
        </View>
      ) : (
        QUADRANTS.map(box)
      )}

      <OptionSheet<Quadrant>
        visible={moving !== null}
        title={moving ? `Move “${titleWithEmoji(moving.task)}”` : 'Move'}
        value={from}
        options={QUADRANTS.map((q) => ({ value: q.key, label: q.title, detail: moving && q.key !== from ? `${q.hint} · ${describe(moving, q.key)}` : q.hint }))}
        onClose={() => setMoving(null)}
        onPick={(target) => {
          const item = moving;
          setMoving(null);
          if (!item || target === from) return;
          const box = QUADRANTS.find((q) => q.key === target)!;
          void run(() => actions.applyMove(item.task.id, moveTo(item, target, now.date), item.occurrence?.date), `Moved to ${box.title}`);
        }}
      />
    </Screen>
  );
}
