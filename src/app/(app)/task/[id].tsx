import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { itemOf } from '@/core/agenda';
import { isColorName, parseIcon } from '@/core/appearance';
import { CLIPART_BY_KEY } from '@/core/clipart';
import { dayLabel, type LocalDate, type LocalTime, localDateOf, minutesToTime, shortDate } from '@/core/dates';
import type { ReminderDraft } from '@/core/quick-add';
import { alignStart, describeRule, parseRule } from '@/core/recurrence';
import { PRIORITIES, PRIORITY_LABEL, type Priority, STATUS_LABEL, STATUSES, type TaskStatus } from '@/core/types';
import { Swatch } from '@/components/ColorSheet';
import { DateSheet, type DateScope } from '@/components/DateSheet';
import { OptionSheet } from '@/components/OptionSheet';
import { PictureSheet } from '@/components/PictureSheet';
import { ReminderSheet, reminderText } from '@/components/ReminderSheet';
import { RepeatSheet } from '@/components/RepeatSheet';
import { TagSheet } from '@/components/TagSheet';
import { TaskPicture } from '@/components/TaskPicture';
import { PriorityMark } from '@/components/TaskRow';
import type { TaskFields } from '@/data/actions';
import { pickAndUploadPicture } from '@/platform/pictures';
import { useData, useNotice, useRun } from '@/state/data';
import { useGoogle } from '@/state/google';
import { useLook } from '@/state/look';
import { useNow } from '@/state/now';
import { useSession } from '@/state/session';
import { useTheme } from '@/state/theme';
import { BackHeader } from '@/ui/BackHeader';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { EditableText } from '@/ui/EditableText';
import { duration, showTime } from '@/ui/format';
import { Icon } from '@/ui/Icon';
import { FieldRow, MenuRow, SectionTitle } from '@/ui/Row';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { space, TOUCH, typography } from '@/ui/tokens';

type SheetName = 'due' | 'repeat' | 'reminders' | 'status' | 'priority' | 'project' | 'category' | 'tags' | 'estimate' | 'picture' | 'goal' | null;

const NONE = '__none__';
const ESTIMATES = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240];

const toLocalTime = (d: Date): LocalTime => minutesToTime(d.getHours() * 60 + d.getMinutes());

/** Every detail of one task, edited in place. Changes save as they are made. */
/** "Emoji 🎂", "Clipart: Cake", "Photo", or null. */
function pictureText(value: string | null | undefined): string | null {
  const icon = parseIcon(value);
  if (!icon) return null;
  if (icon.kind === 'emoji') return `Emoji ${icon.emoji}`;
  if (icon.kind === 'clipart') return `Clipart: ${CLIPART_BY_KEY.get(icon.key)?.label ?? icon.key}`;
  return 'Photo';
}

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, actions } = useData();
  const { now } = useNow();
  const { colors } = useTheme();
  const run = useRun();
  const google = useGoogle();
  const { notify } = useNotice();
  const [uploading, setUploading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const { user } = useSession();
  const look = useLook();
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [subtask, setSubtask] = useState('');
  const [link, setLink] = useState('');

  const task = data.tasks.find((t) => t.id === id);
  const records = useMemo(() => data.occurrences.get(id) ?? [], [data, id]);
  const item = useMemo(() => (task ? itemOf(task, records, now) : null), [task, records, now]);

  const update = useCallback((fields: Partial<TaskFields>) => void run(() => actions.updateTask(id, fields)), [actions, id, run]);

  if (!task || !item) {
    return (
      <Screen bottomInset>
        <BackHeader />
        <Text variant="heading">This task is not here</Text>
        <Text variant="small" color="textSecondary">
          It may have been deleted. Deleted tasks can be brought back with Undo straight after deleting.
        </Text>
      </Screen>
    );
  }

  const rule = parseRule(task.rrule);
  const repeating = !!rule && !!task.dueDate;
  const subtasks = data.subtasks.get(id) ?? [];
  const links = data.links.get(id) ?? [];
  const tagNames = (data.taskTags.get(id) ?? []).map((t) => data.tags.find((x) => x.id === t)?.name ?? '').filter(Boolean);
  const reminders = data.reminders.filter((r) => r.taskId === id && r.isActive);
  const drafts: ReminderDraft[] = reminders.flatMap((r): ReminderDraft[] =>
    r.kind === 'before_due'
      ? [{ kind: 'before_due', offsetMinutes: r.offsetMinutes ?? 0 }]
      : r.remindAt
        ? [{ kind: 'absolute', date: localDateOf(new Date(r.remindAt)), time: toLocalTime(new Date(r.remindAt)) }]
        : [],
  );
  const project = data.projects.find((p) => p.id === task.projectId);
  const goal = task.goalId ? data.goals.find((g) => g.id === task.goalId) : undefined;
  const category = data.categories.find((c) => c.id === task.categoryId);
  const history = records.filter((r) => r.status === 'completed').sort((a, b) => (a.date < b.date ? 1 : -1));

  const dueText = item.date ? `${dayLabel(item.date, now.date)}${item.time ? `, ${showTime(item.time)}` : ''}` : null;

  const close = () => setSheet(null);

  const toggle = () => {
    if (item.open) {
      const label = repeating && item.occurrence ? `Done for ${dayLabel(item.occurrence.date, now.date).toLowerCase()}` : 'Completed';
      void run(() => actions.complete([id]), `${label}: ${task.title}`);
    } else {
      void run(() => actions.reopen(id), `Reopened: ${task.title}`);
    }
  };

  return (
    <Screen bottomInset>
      <BackHeader title={project ? project.name : STATUS_LABEL[task.status]} />

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.xs, marginLeft: -space.md }}>
        <Checkbox checked={!item.open} alert={item.overdue} size={24} label={item.open ? `Complete: ${task.title}` : `Reopen: ${task.title}`} onPress={toggle} />
        <View style={{ flex: 1, paddingTop: 4 }}>
          <EditableText
            key={`title-${id}`}
            accessibilityLabel="Title"
            value={task.title}
            required
            multiline
            maxLength={500}
            variant="heading"
            submitBehavior="blurAndSubmit"
            onSave={(title) => title.trim() !== task.title && update({ title: title.trim() })}
          />
        </View>
      </View>

      {rule && repeating && item.occurrence ? (
        <View style={[styles.banner, { borderColor: colors.divider }]}>
          <Icon name="repeat" color={colors.textSecondary} size={16} />
          <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
            {item.open
              ? `${describeRule(rule, task.dueDate)}. This time: ${dayLabel(item.occurrence.date, now.date)}${item.occurrence.moved ? `, moved to ${shortDate(item.occurrence.showDate, now.date)}` : ''}.`
              : `${describeRule(rule, task.dueDate)}. The series has ended.`}
          </Text>
        </View>
      ) : null}

      <View>
        <FieldRow label="Due" value={dueText} placeholder="No date" valueColor={item.overdue ? 'overdue' : 'text'} onPress={() => setSheet('due')} />
        <FieldRow label="Repeat" value={rule && task.dueDate ? describeRule(rule, task.dueDate) : null} placeholder="Does not repeat" onPress={() => setSheet('repeat')} />
        <FieldRow
          label="Reminders"
          value={drafts.length ? drafts.map((r) => reminderText(r, now.date)).join(', ') : null}
          placeholder="None"
          onPress={() => setSheet('reminders')}
        />
        <FieldRow label="Status" value={STATUS_LABEL[task.status]} onPress={() => setSheet('status')} />
        <FieldRow label="Priority" value={PRIORITY_LABEL[task.priority]} onPress={() => setSheet('priority')}>
          <PriorityMark priority={task.priority} />
          <Text variant="smallStrong" style={{ flex: 1 }}>
            {PRIORITY_LABEL[task.priority]}
          </Text>
        </FieldRow>
        <FieldRow label="Project" value={project?.name} placeholder="None" onPress={() => setSheet('project')}>
          {project ? (
            <>
              {isColorName(project.color) ? <Swatch name={project.color} size={10} /> : null}
              <Text variant="smallStrong" style={{ flex: 1 }}>
                {project.name}
              </Text>
            </>
          ) : undefined}
        </FieldRow>
        <FieldRow label="Goal" value={goal?.title} placeholder="None" onPress={() => setSheet('goal')} />
        <FieldRow label="Category" value={category?.name} placeholder="None" onPress={() => setSheet('category')} />
        <FieldRow label="Tags" value={tagNames.length ? tagNames.map((t) => `#${t}`).join(' ') : null} placeholder="None" onPress={() => setSheet('tags')} />
        <FieldRow label="Estimate" value={task.estimatedMinutes ? duration(task.estimatedMinutes) : null} placeholder="None" onPress={() => setSheet('estimate')} />
        <FieldRow label="Picture" value={pictureText(task.icon)} placeholder="None" onPress={() => setSheet('picture')} last>
          {task.icon ? (
            <>
              <TaskPicture icon={task.icon} size={22} color={look.taskHex(task)} />
              <Text variant="smallStrong" style={{ flex: 1 }}>
                {pictureText(task.icon)}
              </Text>
            </>
          ) : undefined}
        </FieldRow>
      </View>

      <View>
        <SectionTitle>{subtasks.length ? `Subtasks · ${subtasks.filter((s) => s.isCompleted).length}/${subtasks.length}` : 'Subtasks'}</SectionTitle>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
          {subtasks.map((s) => (
            <View key={s.id} style={[styles.subRow, { borderBottomColor: colors.divider }]}>
              <Checkbox
                checked={s.isCompleted}
                label={`${s.isCompleted ? 'Untick' : 'Tick'} subtask: ${s.title}`}
                onPress={() => void run(() => actions.updateSubtask(s.id, { isCompleted: !s.isCompleted }))}
              />
              <View style={{ flex: 1 }}>
                <EditableText
                  key={`sub-${s.id}`}
                  accessibilityLabel="Subtask"
                  value={s.title}
                  required
                  maxLength={500}
                  onSave={(title) => title.trim() !== s.title && void run(() => actions.updateSubtask(s.id, { title }))}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete subtask: ${s.title}`}
                onPress={() => void run(() => actions.deleteSubtask(s.id), 'Subtask deleted')}
                style={styles.iconHit}>
                <Icon name="close" color={colors.textSecondary} size={18} />
              </Pressable>
            </View>
          ))}
          <View style={[styles.subRow, { borderBottomColor: colors.divider }]}>
            <View style={styles.iconHit}>
              <Icon name="plus" color={colors.textSecondary} size={18} />
            </View>
            <TextInput
              accessibilityLabel="Add a subtask"
              value={subtask}
              onChangeText={setSubtask}
              placeholder="Add a subtask"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="done"
              submitBehavior="submit"
              maxLength={500}
              onSubmitEditing={() => {
                const title = subtask.trim();
                if (!title) return;
                setSubtask('');
                void run(() => actions.addSubtask(id, title));
              }}
              style={[typography.body, { flex: 1, color: colors.text, minHeight: TOUCH }]}
            />
          </View>
        </View>
      </View>

      <View>
        <SectionTitle>Description</SectionTitle>
        <View style={[styles.box, { borderColor: colors.divider }]}>
          <EditableText
            key={`desc-${id}`}
            accessibilityLabel="Description"
            value={task.description}
            multiline
            placeholder="What is this about?"
            maxLength={10000}
            onSave={(description) => description !== task.description && update({ description })}
          />
        </View>
      </View>

      <View>
        <SectionTitle>Notes</SectionTitle>
        <View style={[styles.box, { borderColor: colors.divider }]}>
          <EditableText
            key={`notes-${id}`}
            accessibilityLabel="Notes"
            value={task.notes}
            multiline
            placeholder="Anything to remember while working on it"
            maxLength={20000}
            onSave={(notes) => notes !== task.notes && update({ notes })}
          />
        </View>
      </View>

      <View>
        <SectionTitle>Links</SectionTitle>
        <View style={{ borderTopWidth: 1, borderTopColor: colors.divider }}>
          {links.map((l) => (
            <View key={l.id} style={[styles.subRow, { borderBottomColor: colors.divider }]}>
              <View style={styles.iconHit}>
                <Icon name="link" color={colors.accent} size={18} />
              </View>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(l.url)} style={{ flex: 1, minHeight: TOUCH, justifyContent: 'center' }}>
                <Text variant="small" color="accent" numberOfLines={1}>
                  {l.name}
                </Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove link ${l.name}`} onPress={() => void run(() => actions.removeLink(l.id), 'Link removed')} style={styles.iconHit}>
                <Icon name="close" color={colors.textSecondary} size={18} />
              </Pressable>
            </View>
          ))}
          <View style={[styles.subRow, { borderBottomColor: colors.divider }]}>
            <View style={styles.iconHit}>
              <Icon name="plus" color={colors.textSecondary} size={18} />
            </View>
            <TextInput
              accessibilityLabel="Add a link"
              value={link}
              onChangeText={setLink}
              placeholder="Paste a web or Google Drive link"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={() => {
                const url = link.trim();
                if (!url) return;
                setLink('');
                void run(() => actions.addLink(id, { url }));
              }}
              style={[typography.small, { flex: 1, color: colors.text, minHeight: TOUCH }]}
            />
          </View>
          {google.available ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach a file from this device, stored in Google Drive"
              disabled={uploading}
              onPress={() => {
                setUploading(true);
                void run(() => google.attachFile(id)).then((r) => {
                  setUploading(false);
                  if (r) notify(`Uploaded to Google Drive and attached: ${r.name}`);
                });
              }}
              style={[styles.subRow, { borderBottomColor: colors.divider, opacity: uploading ? 0.5 : 1 }]}>
              <View style={styles.iconHit}>
                <Icon name="link" color={colors.textSecondary} size={18} />
              </View>
              <Text variant="small" color="textSecondary" style={{ flex: 1 }}>
                {uploading ? 'Uploading to Google Drive…' : 'Attach a file (stored in your Google Drive)'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {history.length ? (
        <View>
          <SectionTitle>{`Done · ${history.length}`}</SectionTitle>
          {history.slice(0, 10).map((h) => (
            <View key={h.date} style={[styles.subRow, { borderBottomColor: colors.divider }]}>
              <Icon name="check" color={colors.completed} size={16} />
              <Text variant="small" style={{ flex: 1 }}>
                {shortDate(h.date, now.date)}
              </Text>
              <Button variant="secondary" label="Undo" onPress={() => void run(() => actions.reopen(id, h.date), `Reopened ${shortDate(h.date, now.date)}`)} />
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <SectionTitle>Actions</SectionTitle>
        {repeating && item.open ? (
          <MenuRow icon="skip" label="Skip this time" detail={item.occurrence ? shortDate(item.occurrence.date, now.date) : undefined} onPress={() => void run(() => actions.skipOccurrence(id), 'Skipped')} />
        ) : null}
        {item.open ? <MenuRow icon="timer" label="Focus on this task" onPress={() => router.push(`/focus?task=${id}`)} /> : null}
        <MenuRow
          icon="copy"
          label="Duplicate"
          onPress={async () => {
            const result = await run(() => actions.duplicate(id), 'Duplicated');
            if (result) router.replace(`/task/${result.id}`);
          }}
        />
        <MenuRow
          icon="trash"
          label="Delete"
          danger
          onPress={async () => {
            const done = await run(() => actions.deleteTasks([id]), `Deleted: ${task.title}`);
            if (done) {
              if (router.canGoBack()) router.back();
              else router.replace('/');
            }
          }}
        />
      </View>

      <Text variant="caption" color="textSecondary">
        Created {shortDate(localDateOf(new Date(task.createdAt)), now.date)}
        {task.completedAt ? ` · Completed ${shortDate(localDateOf(new Date(task.completedAt)), now.date)}, ${showTime(toLocalTime(new Date(task.completedAt)))}` : ''}
      </Text>

      <DateSheet
        visible={sheet === 'due'}
        today={now.date}
        date={item.date}
        time={item.time}
        repeating={repeating}
        onClose={close}
        onPick={(date: LocalDate | null, time: LocalTime | null, scope: DateScope) => {
          close();
          if (repeating && !date) {
            // Removing the date of a repeating task also stops the repeat.
            void run(() => actions.updateTask(id, { dueDate: null, dueTime: null, rrule: null, recurUntil: null }), 'Date and repeat removed');
            return;
          }
          void run(() => actions.reschedule([id], date, time, scope), date ? `Moved to ${dayLabel(date, now.date)}` : 'Date removed');
        }}
      />
      <RepeatSheet
        visible={sheet === 'repeat'}
        today={now.date}
        anchor={task.dueDate}
        rrule={task.rrule}
        until={task.recurUntil}
        onClose={close}
        onSave={(rrule, until) => {
          close();
          const next = parseRule(rrule);
          const start = next ? alignStart(task.dueDate ?? now.date, next) : task.dueDate;
          void run(
            () => actions.updateTask(id, { rrule, recurUntil: until, ...(next ? { dueDate: start } : {}) }),
            next ? describeRule(next, start) : 'No longer repeats',
          );
        }}
      />
      <ReminderSheet
        visible={sheet === 'reminders'}
        today={now.date}
        reminders={drafts}
        hasDate={!!item.date}
        hasTime={!!item.time}
        onClose={close}
        onSave={(list) => {
          close();
          void run(() => actions.setReminders(id, list), list.length ? 'Reminders saved' : 'Reminders removed');
        }}
      />
      <OptionSheet<TaskStatus>
        visible={sheet === 'status'}
        title="Status"
        value={task.status}
        options={STATUSES.map((s) => ({
          value: s,
          label: STATUS_LABEL[s],
          detail: s === 'completed' && repeating ? 'Ends the repeat' : s === 'archived' ? 'Hidden from lists, kept for reference' : undefined,
        }))}
        onClose={close}
        onPick={(status) => {
          close();
          if (status !== task.status) void run(() => actions.updateTask(id, { status }), `Status: ${STATUS_LABEL[status]}`);
        }}
      />
      <PictureSheet
        visible={sheet === 'picture'}
        value={task.icon ?? null}
        onClose={() => setSheet(null)}
        photoBusy={photoBusy}
        onPick={(icon) => {
          setSheet(null);
          update({ icon });
        }}
        onPhoto={() => {
          if (!user) return;
          setPhotoBusy(true);
          void run(async () => {
            const path = await pickAndUploadPicture(user.id, id);
            if (path) {
              await actions.updateTask(id, { icon: `i:${path}` });
              setSheet(null);
            }
          }).finally(() => setPhotoBusy(false));
        }}
      />
      <OptionSheet<Priority>
        visible={sheet === 'priority'}
        title="Priority"
        value={task.priority}
        options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
        onClose={close}
        onPick={(priority) => {
          close();
          update({ priority });
        }}
      />
      <OptionSheet<string>
        visible={sheet === 'project'}
        title="Project"
        value={task.projectId ?? NONE}
        options={[{ value: NONE, label: 'No project' }, ...data.projects.filter((p) => p.status === 'active' || p.id === task.projectId).map((p) => ({ value: p.id, label: p.name }))]}
        createLabel="New project"
        onCreate={async (name) => {
          close();
          const created = await run(() => actions.createProject({ name }));
          if (created) update({ projectId: created.id });
        }}
        onClose={close}
        onPick={(value) => {
          close();
          update({ projectId: value === NONE ? null : value });
        }}
      />
      <OptionSheet<string>
        visible={sheet === 'goal'}
        title="Goal"
        value={task.goalId ?? NONE}
        options={[{ value: NONE, label: 'No goal' }, ...data.goals.filter((g) => g.status === 'active' || g.id === task.goalId).map((g) => ({ value: g.id, label: g.title }))]}
        createLabel="New goal"
        onCreate={async (title) => {
          close();
          const created = await run(() => actions.createGoal({ title }));
          if (created) update({ goalId: created.id });
        }}
        onClose={close}
        onPick={(value) => {
          close();
          update({ goalId: value === NONE ? null : value });
        }}
      />
      <OptionSheet<string>
        visible={sheet === 'category'}
        title="Category"
        value={task.categoryId ?? NONE}
        options={[{ value: NONE, label: 'No category' }, ...data.categories.map((c) => ({ value: c.id, label: c.name }))]}
        createLabel="New category"
        onCreate={async (name) => {
          close();
          const created = await run(() => actions.createCategory(name));
          if (created) update({ categoryId: created.id });
        }}
        onClose={close}
        onPick={(value) => {
          close();
          update({ categoryId: value === NONE ? null : value });
        }}
      />
      <TagSheet
        visible={sheet === 'tags'}
        all={data.tags.map((t) => t.name)}
        selected={tagNames}
        onClose={close}
        onSave={(names) => {
          close();
          void run(() => actions.setTags(id, names));
        }}
      />
      <OptionSheet<string>
        visible={sheet === 'estimate'}
        title="Estimate"
        value={task.estimatedMinutes ? String(task.estimatedMinutes) : NONE}
        options={[{ value: NONE, label: 'No estimate' }, ...ESTIMATES.map((m) => ({ value: String(m), label: duration(m) }))]}
        onClose={close}
        onPick={(value) => {
          close();
          update({ estimatedMinutes: value === NONE ? null : Number(value) });
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, padding: space.md },
  subRow: { minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.xs, borderBottomWidth: 1 },
  iconHit: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  box: { borderWidth: 1, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 72 },
});
