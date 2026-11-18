import { useRouter } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dayLabel, type LocalDate } from '@/core/dates';
import { normaliseTagName } from '@/core/ids';
import { parseQuickAdd } from '@/core/quick-add';
import { describeRule, parseRule } from '@/core/recurrence';
import { PRIORITY_LABEL } from '@/core/types';
import type { TaskFields } from '@/data/actions';
import { useData, useRun } from '@/state/data';
import { useNow } from '@/state/now';
import { useTheme } from '@/state/theme';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { duration, offsetLabel, showTime } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { FieldRow } from '@/ui/Row';
import { Sheet } from '@/ui/Sheet';
import { Text } from '@/ui/Text';
import { space, typography } from '@/ui/tokens';

type Defaults = Partial<Pick<TaskFields, 'projectId' | 'categoryId' | 'dueDate'>>;

const QuickAddContext = createContext<(defaults?: Defaults) => void>(() => {});

export function useQuickAdd() {
  return useContext(QuickAddContext);
}

/** Holds the quick-add sheet, so every screen can open it. */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const open = useCallback((d: Defaults = {}) => setDefaults(d), []);
  return (
    <QuickAddContext.Provider value={open}>
      {children}
      <QuickAddSheet defaults={defaults} onClose={() => setDefaults(null)} />
    </QuickAddContext.Provider>
  );
}

/** The square "+" button at the bottom right of the main screens. */
export function QuickAddButton({ defaults, bottom = 16 }: { defaults?: Defaults; bottom?: number }) {
  const { colors } = useTheme();
  const open = useQuickAdd();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Quick add"
      onPress={() => open(defaults)}
      style={({ pressed }) => [styles.fab, { backgroundColor: colors.accent, bottom, opacity: pressed ? 0.8 : 1 }]}>
      <Icon name="plus" color={colors.onAccent} size={26} />
    </Pressable>
  );
}

function QuickAddSheet({ defaults, onClose }: { defaults: Defaults | null; onClose: () => void }) {
  const { colors } = useTheme();
  const { data, actions } = useData();
  const { now } = useNow();
  const run = useRun();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [ignore, setIgnore] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const visible = defaults !== null;

  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setText('');
      setIgnore([]);
    }
  }

  const parsed = useMemo(() => parseQuickAdd(text, { today: now.date, nowMinutes: now.minutes, ignore }), [text, now, ignore]);
  const dueDate: LocalDate | null = parsed.dueDate ?? defaults?.dueDate ?? null;
  const project = parsed.project
    ? data.projects.find((p) => normaliseTagName(p.name).replace(/-/g, '') === normaliseTagName(parsed.project!).replace(/-/g, ''))
    : defaults?.projectId ? data.projects.find((p) => p.id === defaults.projectId) : undefined;
  const rule = parseRule(parsed.rrule);

  const add = async (thenOpen: boolean) => {
    if (!parsed.title || busy) return;
    setBusy(true);
    const result = await run(() => actions.createFromQuickAdd(parsed, defaults ?? {}), thenOpen ? undefined : `Added: ${parsed.title}`);
    setBusy(false);
    if (!result) return;
    onClose();
    if (thenOpen) router.push(`/task/${result.id}`);
  };

  return (
    <Sheet
      visible={visible}
      title="Quick add"
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: space.md, paddingBottom: insets.bottom ? 0 : space.xs }}>
          <Button label="Add task" busyLabel="Adding…" busy={busy} disabled={!parsed.title} onPress={() => void add(false)} style={{ flex: 1 }} />
          <Button variant="secondary" label="Add and edit" disabled={!parsed.title || busy} onPress={() => void add(true)} />
        </View>
      }>
      <View style={{ gap: space.xs }}>
        <Text variant="caption" color="textSecondary" nativeID="quick-add-hint">
          Type it the way you would say it
        </Text>
        <TextInput
          accessibilityLabel="New task"
          aria-describedby="quick-add-hint"
          autoFocus
          multiline
          value={text}
          onChangeText={setText}
          placeholder="Call the bank tomorrow at 3pm #admin"
          placeholderTextColor={colors.textSecondary}
          submitBehavior="blurAndSubmit"
          returnKeyType="done"
          onSubmitEditing={() => void add(false)}
          style={[typography.bodyStrong, styles.input, { color: colors.text, borderBottomColor: colors.accent }]}
        />
      </View>

      {parsed.pieces.length || ignore.length ? (
        <View style={{ gap: space.sm }}>
          <Text variant="caption" color="textSecondary">
            Recognised. Tap one to keep it as words.
          </Text>
          <View style={styles.wrap}>
            {parsed.pieces.map((p) => (
              <Chip key={`${p.start}-${p.text}`} label={p.text} removable onPress={() => setIgnore((cur) => [...cur, p.text])} accessibilityLabel={`Keep "${p.text}" as words`} />
            ))}
            {ignore.map((t) => (
              <Chip key={`kept-${t}`} label={`${t} (kept)`} selected onPress={() => setIgnore((cur) => cur.filter((x) => x !== t))} accessibilityLabel={`Recognise "${t}" again`} />
            ))}
          </View>
        </View>
      ) : null}

      {text.trim() ? (
        <View>
          <Text variant="label" color="textSecondary" style={{ paddingBottom: space.xs }}>
            Understood as
          </Text>
          <FieldRow label="Title" value={parsed.title || 'Add a few words for the title'} valueColor={parsed.title ? 'text' : 'overdue'} />
          {dueDate ? <FieldRow label="Due" value={`${dayLabel(dueDate, now.date)}${parsed.dueTime ? `, ${showTime(parsed.dueTime)}` : ''}`} /> : null}
          {rule && dueDate ? <FieldRow label="Repeat" value={describeRule(rule, dueDate)} /> : null}
          {parsed.reminders.map((r, i) => (
            <FieldRow key={i} label="Reminder" value={r.kind === 'before_due' ? offsetLabel(r.offsetMinutes) : `${dayLabel(r.date, now.date)}, ${showTime(r.time)}`} />
          ))}
          {parsed.priority ? <FieldRow label="Priority" value={PRIORITY_LABEL[parsed.priority]} /> : null}
          {parsed.project || project ? <FieldRow label="Project" value={project ? project.name : `New project: ${parsed.project}`} /> : null}
          {parsed.tags.length ? <FieldRow label="Tags" value={parsed.tags.map((t) => `#${t}`).join(' ')} /> : null}
          {parsed.estimatedMinutes ? <FieldRow label="Estimate" value={duration(parsed.estimatedMinutes)} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: space.xl - space.xs, width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 72, borderBottomWidth: 2, paddingHorizontal: 0, paddingVertical: space.sm, textAlignVertical: 'top' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
