/**
 * Everything the user can do to their data. Each action is one transaction
 * and returns an undo log, so any of them can be reversed with one tap.
 */
import { seriesOf } from '@/core/agenda';
import type { SummarySettings } from '@/core/alarms';
import { type LocalDate, type LocalTime, localDateOf, toMoment } from '@/core/dates';
import { type ColorSettings, parseIcon, readColorSettings } from '@/core/appearance';
import { readGoogleSettings, type GoogleSettings } from '@/core/google';
import { externalLinkId, noteId, normaliseTagName, occurrenceId, tagId, taskTagId } from '@/core/ids';
import type { FocusKind } from '@/core/focus';
import { MAX_MINUTES } from '@/core/focus';
import type { GoalStatus } from '@/core/goals';
import { isScheduleText, MAX_TARGET, MAX_UNIT } from '@/core/habits';
import type { MatrixMove } from '@/core/matrix';
import type { QuickAdd, ReminderDraft } from '@/core/quick-add';
import { currentOccurrence, type OccurrenceRecord, planCompletion, planMove, planSkip } from '@/core/recurrence';
import { canDecline, canEdit } from '@/core/sharing';
import type { TaskFilter } from '@/core/filters';
import type { Priority, TaskStatus } from '@/core/types';
import { isOpenStatus } from '@/core/types';

import { type Backup, makeBackup, restoreBackup } from './backup';
import { toTask } from './snapshot';
import type { Row, Store, Tx, UndoLog } from './store';

export type LinkInput = { url: string; name?: string };

export type TaskFields = {
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  projectId: string | null;
  categoryId: string | null;
  dueDate: LocalDate | null;
  dueTime: LocalTime | null;
  estimatedMinutes: number | null;
  rrule: string | null;
  recurUntil: LocalDate | null;
  /** The task's picture (src/core/appearance.ts), or null for none. */
  icon: string | null;
  /** The goal it counts towards, or null. */
  goalId: string | null;
};

export type TaskInput = Partial<TaskFields> & {
  title: string;
  /** Share it with this group (src/core/sharing.ts). Group tasks have no project, category, goal, tags or links. */
  groupId?: string | null;
  /** In a group: who it is assigned to (null: nobody, so the creator has it). */
  ownerId?: string | null;
  /** In a group: only creator and owner see it. */
  isPrivate?: boolean;
  tags?: string[];
  subtasks?: string[];
  reminders?: ReminderDraft[];
  links?: LinkInput[];
};

export type GoalInput = { title: string; description?: string; targetDate?: LocalDate | null; color?: string | null; icon?: string | null };

export type HabitInput = {
  title: string;
  icon?: string | null;
  color?: string | null;
  /** "daily", "days:1,3,5" or "week:3" (src/core/habits.ts). */
  schedule?: string;
  target?: number;
  unit?: string;
  reminderTime?: LocalTime | null;
};

const HABIT_COLUMNS: Record<keyof HabitInput, string> = {
  title: 'title', icon: 'icon', color: 'color', schedule: 'schedule', target: 'target', unit: 'unit', reminderTime: 'reminder_time',
};

function habitColumns(input: Partial<HabitInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = HABIT_COLUMNS[key as keyof HabitInput];
    if (column) out[column] = value;
  }
  if (out.title !== undefined) {
    out.title = String(out.title).trim();
    if (!out.title) throw new InvalidInput('A habit needs a name.');
    if ((out.title as string).length > 200) throw new InvalidInput('A habit name can be at most 200 characters.');
  }
  if (out.schedule !== undefined && !isScheduleText(String(out.schedule))) throw new InvalidInput('Choose when the habit is done.');
  if (out.target !== undefined) {
    const n = Number(out.target);
    if (!Number.isInteger(n) || n < 1 || n > MAX_TARGET) throw new InvalidInput(`The daily target is a whole number from 1 to ${MAX_TARGET}.`);
  }
  if (out.unit !== undefined) {
    out.unit = String(out.unit).trim();
    if ((out.unit as string).length > MAX_UNIT) throw new InvalidInput(`A unit can be at most ${MAX_UNIT} characters.`);
  }
  if (out.reminder_time !== undefined && out.reminder_time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(out.reminder_time))) {
    throw new InvalidInput('Choose a time for the reminder.');
  }
  if (out.icon != null && !parseIcon(String(out.icon))) throw new InvalidInput('That picture cannot be used: choose an emoji or a clipart.');
  return out;
}

export const MAX_NOTE = 20000;

export type ProjectInput = { name: string; description?: string; color?: string | null; deadline?: LocalDate | null };

const FIELD_COLUMNS: Record<keyof TaskFields, string> = {
  title: 'title',
  description: 'description',
  notes: 'notes',
  status: 'status',
  priority: 'priority',
  projectId: 'project_id',
  categoryId: 'category_id',
  dueDate: 'due_date',
  dueTime: 'due_time',
  estimatedMinutes: 'estimated_minutes',
  rrule: 'rrule',
  recurUntil: 'recur_until',
  icon: 'icon',
  goalId: 'goal_id',
};

/** Children that go with a task when it is deleted or duplicated. */
const CHILD_TABLES = ['subtasks', 'reminders', 'task_tags', 'attachments', 'task_occurrences', 'calendar_links'] as const;

export class InvalidInput extends Error {}

function toColumns(fields: Partial<TaskFields>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const column = FIELD_COLUMNS[key as keyof TaskFields];
    if (!column) continue;
    out[column] = typeof value === 'string' && key !== 'title' && key !== 'description' && key !== 'notes' && value === '' ? null : value;
  }
  if (typeof out.title === 'string') {
    out.title = (out.title as string).trim();
    if (!out.title) throw new InvalidInput('A task needs a title.');
    if ((out.title as string).length > 500) throw new InvalidInput('A title can be at most 500 characters.');
  }
  if (out.icon != null && !parseIcon(String(out.icon))) throw new InvalidInput('That picture cannot be used: choose an emoji, a clipart or a photo.');
  return out;
}

export type ActionOptions = {
  newId: () => string;
  now?: () => Date;
};

export class Actions {
  private readonly now: () => Date;

  constructor(
    private readonly store: Store,
    private readonly opts: ActionOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  private today(): LocalDate {
    return localDateOf(this.now());
  }

  /**
   * A task that is about to be changed: it must exist and, in a group, be
   * mine to change (creator or owner). `read` only checks that it exists.
   */
  private async task(tx: Tx, id: string, mode: 'edit' | 'read' = 'edit'): Promise<Row> {
    const row = await tx.get('tasks', id);
    if (!row || row.deleted_at) throw new InvalidInput('That task no longer exists.');
    if (mode === 'edit' && !canEdit(toTask(row), this.store.userId)) {
      throw new InvalidInput('Only the person who created this task or the person it is assigned to can change it.');
    }
    return row;
  }

  private static readonly PERSONAL_ONLY = 'A group task has no tags, links or files: those stay personal.';

  /** The task a subtask belongs to, checked as for task(). */
  private async childTask(tx: Tx, table: 'subtasks', id: string): Promise<void> {
    const child = await tx.get(table, id);
    if (child?.task_id) await this.task(tx, String(child.task_id));
  }

  undo(log: UndoLog): Promise<void> {
    return this.store.undo(log);
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  async createTask(input: TaskInput): Promise<{ id: string; undo: UndoLog }> {
    const id = this.opts.newId();
    const { undo } = await this.store.transaction(async (tx) => {
      const columns = toColumns(input);
      const inGroup = !!input.groupId;
      if (inGroup) {
        if (!(await this.isMember(tx, input.groupId!, this.store.userId))) throw new InvalidInput('You are not a member of that group.');
        if (input.ownerId && !(await this.isMember(tx, input.groupId!, input.ownerId))) {
          throw new InvalidInput('That person is not a member of the group.');
        }
        delete columns.project_id;
        delete columns.category_id;
        delete columns.goal_id;
        columns.group_id = input.groupId;
        columns.owner_id = input.ownerId ?? null;
        columns.is_private = input.isPrivate === true;
        columns.created_by = this.store.userId;
      }
      const organised = !!((!inGroup && (input.projectId || input.categoryId)) || input.dueDate);
      columns.status = input.status ?? (organised ? 'not_started' : 'inbox');
      columns.priority = input.priority ?? 'medium';
      columns.sort_order = this.now().getTime();
      if (columns.status === 'completed') columns.completed_at = this.now().toISOString();
      await tx.write('tasks', id, columns);
      if (inGroup && (input.tags?.length || input.links?.length)) throw new InvalidInput(Actions.PERSONAL_ONLY);
      if (input.tags?.length) await this.writeTags(tx, id, input.tags);
      for (const [i, title] of (input.subtasks ?? []).entries()) {
        if (title.trim()) await tx.write('subtasks', this.opts.newId(), { task_id: id, title: title.trim(), sort_order: i });
      }
      for (const draft of input.reminders ?? []) await this.writeReminder(tx, id, draft);
      for (const link of input.links ?? []) await this.writeLink(tx, id, link);
    });
    return { id, undo };
  }

  /** A task from a quick-add line. The project is matched by name, or created. */
  async createFromQuickAdd(parsed: QuickAdd, defaults: Partial<TaskFields> & { groupId?: string } = {}): Promise<{ id: string; undo: UndoLog }> {
    if (defaults.groupId) {
      // Into a group: projects and tags are personal, so they are left out.
      return this.createTask({
        title: parsed.title, groupId: defaults.groupId, dueDate: parsed.dueDate ?? defaults.dueDate ?? null,
        dueTime: parsed.dueTime ?? null, rrule: parsed.rrule, priority: parsed.priority ?? undefined, estimatedMinutes: parsed.estimatedMinutes,
        reminders: parsed.reminders,
      });
    }
    let projectId = defaults.projectId ?? null;
    if (parsed.project) {
      const wanted = normaliseTagName(parsed.project).replace(/-/g, '');
      const existing = (await this.store.rows('projects')).find((p) => normaliseTagName(String(p.name)).replace(/-/g, '') === wanted);
      projectId = existing?.id ?? null;
      if (!existing) {
        const name = parsed.project.replace(/[-_]+/g, ' ').trim();
        projectId = (await this.createProject({ name: name.charAt(0).toUpperCase() + name.slice(1) })).id;
      }
    }
    return this.createTask({
      ...defaults,
      title: parsed.title,
      dueDate: parsed.dueDate ?? defaults.dueDate ?? null,
      dueTime: parsed.dueTime ?? defaults.dueTime ?? null,
      rrule: parsed.rrule,
      priority: parsed.priority ?? defaults.priority,
      projectId,
      estimatedMinutes: parsed.estimatedMinutes,
      tags: parsed.tags,
      reminders: parsed.reminders,
    });
  }

  async updateTask(id: string, fields: Partial<TaskFields>): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      await this.patchTask(tx, id, fields);
    });
    return undo;
  }

  private async patchTask(tx: Tx, id: string, fields: Partial<TaskFields>): Promise<void> {
    const current = toTask(await this.task(tx, id));
    const columns = toColumns(fields);
    if (current.groupId) {
      // Projects, categories and goals are personal.
      delete columns.project_id;
      delete columns.category_id;
      delete columns.goal_id;
    }
    // A task leaves the Inbox once it gets a project, a category or a date.
    if (current.status === 'inbox' && fields.status === undefined && (fields.projectId || fields.categoryId || fields.dueDate)) {
      columns.status = 'not_started';
    }
    const nextStatus = (columns.status as TaskStatus | undefined) ?? current.status;
    if (nextStatus === 'completed' && current.status !== 'completed') columns.completed_at = this.now().toISOString();
    if (nextStatus !== 'completed' && current.status === 'completed') columns.completed_at = null;
    await tx.write('tasks', id, columns);
  }

  async setTags(taskId: string, names: string[]): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (task.groupId) {
        if (names.length) throw new InvalidInput(Actions.PERSONAL_ONLY);
        return;
      }
      await this.writeTags(tx, taskId, names);
    });
    return undo;
  }

  private async writeTags(tx: Tx, taskId: string, names: string[]): Promise<void> {
    const wanted = new Map<string, string>();
    for (const name of names) {
      const clean = normaliseTagName(name);
      if (clean && clean.length <= 60) wanted.set(tagId(this.store.userId, clean), clean);
    }
    for (const [id, name] of wanted) {
      const existing = await tx.get('tags', id);
      if (!existing) await tx.write('tags', id, { name });
      else if (existing.deleted_at) await tx.restore('tags', id);
      const linkId = taskTagId(taskId, id);
      const link = await tx.get('task_tags', linkId);
      if (!link) await tx.write('task_tags', linkId, { task_id: taskId, tag_id: id });
      else if (link.deleted_at) await tx.restore('task_tags', linkId);
    }
    for (const link of await tx.find('task_tags', 'task_id', taskId)) {
      if (!wanted.has(String(link.tag_id))) await tx.remove('task_tags', link.id);
    }
  }

  async setReminders(taskId: string, drafts: ReminderDraft[]): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      await this.task(tx, taskId);
      for (const r of await tx.find('reminders', 'task_id', taskId)) await tx.remove('reminders', r.id);
      for (const draft of drafts) await this.writeReminder(tx, taskId, draft);
    });
    return undo;
  }

  private async writeReminder(tx: Tx, taskId: string, draft: ReminderDraft): Promise<void> {
    const id = this.opts.newId();
    if (draft.kind === 'before_due') {
      await tx.write('reminders', id, { task_id: taskId, kind: 'before_due', offset_minutes: Math.max(0, Math.round(draft.offsetMinutes)) });
    } else {
      await tx.write('reminders', id, { task_id: taskId, kind: 'absolute', remind_at: toMoment(draft.date, draft.time).toISOString() });
    }
  }

  private async writeLink(tx: Tx, taskId: string, link: LinkInput): Promise<string> {
    let url = link.url.trim();
    if (!url) throw new InvalidInput('A link needs an address.');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    const id = this.opts.newId();
    await tx.write('attachments', id, { task_id: taskId, kind: /drive\.google\.com|docs\.google\.com/.test(url) ? 'drive' : 'link', file_url: url, file_name: link.name?.trim() || url.replace(/^https?:\/\//, '') });
    return id;
  }

  async addLink(taskId: string, link: LinkInput): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      if (toTask(await this.task(tx, taskId)).groupId) throw new InvalidInput(Actions.PERSONAL_ONLY);
      await this.writeLink(tx, taskId, link);
    });
    return undo;
  }

  async removeLink(id: string): Promise<UndoLog> {
    return (await this.store.transaction((tx) => tx.remove('attachments', id))).undo;
  }

  // ---- subtasks ---------------------------------------------------------------

  async addSubtask(taskId: string, title: string): Promise<UndoLog> {
    const clean = title.trim();
    if (!clean) throw new InvalidInput('A subtask needs a title.');
    const { undo } = await this.store.transaction(async (tx) => {
      await this.task(tx, taskId);
      const count = (await tx.find('subtasks', 'task_id', taskId)).length;
      await tx.write('subtasks', this.opts.newId(), { task_id: taskId, title: clean, sort_order: count });
    });
    return undo;
  }

  async updateSubtask(id: string, fields: { title?: string; isCompleted?: boolean }): Promise<UndoLog> {
    const patch: Record<string, unknown> = {};
    if (fields.title !== undefined) {
      if (!fields.title.trim()) throw new InvalidInput('A subtask needs a title.');
      patch.title = fields.title.trim();
    }
    if (fields.isCompleted !== undefined) patch.is_completed = fields.isCompleted;
    return (await this.store.transaction(async (tx) => {
      await this.childTask(tx, 'subtasks', id);
      await tx.write('subtasks', id, patch);
    })).undo;
  }

  async deleteSubtask(id: string): Promise<UndoLog> {
    return (await this.store.transaction(async (tx) => {
      await this.childTask(tx, 'subtasks', id);
      await tx.remove('subtasks', id);
    })).undo;
  }

  // ---- completing, skipping, moving ------------------------------------------------

  /**
   * Complete a task. A repeating task gets its current occurrence recorded as
   * done (and moves on); a one-off task becomes Completed.
   */
  async complete(taskIds: string[]): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const id of taskIds) await this.completeOne(tx, id);
    });
    return undo;
  }

  private async completeOne(tx: Tx, id: string): Promise<void> {
    const task = toTask(await this.task(tx, id));
    if (!isOpenStatus(task.status)) return;
    const series = seriesOf(task);
    if (series) {
      const records = await this.records(tx, id);
      const plan = planCompletion(series, records, this.today(), this.now().toISOString());
      if (plan.length === 0) {
        await this.patchTask(tx, id, { status: 'completed' });
        return;
      }
      for (const r of plan) await this.writeOccurrence(tx, id, r);
      return;
    }
    await this.patchTask(tx, id, { status: 'completed' });
  }

  /**
   * "Mark completed" pressed on a notification, perhaps a while ago. Completes
   * that very occurrence, and does nothing if it is already done (on this
   * device or, after a sync, on another), so a late tap never ticks off the
   * next one.
   */
  async completeFromNotification(taskId: string, occurrenceDate: LocalDate | null, at: Date): Promise<boolean> {
    const { result } = await this.store.transaction(async (tx) => {
      const row = await tx.get('tasks', taskId);
      if (!row || row.deleted_at) return false;
      const task = toTask(row);
      if (!isOpenStatus(task.status)) return false;
      const series = seriesOf(task);
      if (!series || !occurrenceDate) {
        if (series) return false;
        await this.patchTask(tx, taskId, { status: 'completed' });
        return true;
      }
      const records = await this.records(tx, taskId);
      const record = records.find((r) => r.date === occurrenceDate);
      if (record && (record.status === 'completed' || (record.status === 'skipped' && !record.movedToDate))) return false;
      const current = currentOccurrence(series, records);
      if (current?.date === occurrenceDate) {
        await this.completeOne(tx, taskId);
        return true;
      }
      if (current && occurrenceDate < current.date) return false; // an earlier time, already passed by
      await this.writeOccurrence(tx, taskId, { date: occurrenceDate, status: 'completed', completedAt: at.toISOString(), movedToDate: null, movedToTime: null });
      return true;
    });
    return result;
  }

  /** Back to open: a one-off task, or one completed occurrence of a repeating task. */
  async reopen(taskId: string, occurrenceDate?: LocalDate): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (occurrenceDate) {
        const row = await tx.get('task_occurrences', occurrenceId(taskId, occurrenceDate));
        if (row && !row.deleted_at) await tx.remove('task_occurrences', row.id);
      }
      if (!isOpenStatus(task.status)) {
        await this.patchTask(tx, taskId, { status: task.projectId || task.categoryId || task.dueDate ? 'not_started' : 'inbox' });
      }
    });
    return undo;
  }

  async skipOccurrence(taskId: string): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      const series = seriesOf(task);
      if (!series) throw new InvalidInput('Only a repeating task can skip one time.');
      const record = planSkip(series, await this.records(tx, taskId));
      if (record) await this.writeOccurrence(tx, taskId, record);
    });
    return undo;
  }

  /**
   * Move a task to another day. For a repeating task, `scope` says whether
   * only the current occurrence moves or the whole series starts again there.
   */
  async reschedule(
    taskIds: string[],
    date: LocalDate | null,
    time: LocalTime | null | undefined,
    scope: 'occurrence' | 'series' = 'occurrence',
    /** For one repeating task: which occurrence to move (default: the current one). */
    occurrenceDate?: LocalDate,
  ): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const id of taskIds) {
        const task = toTask(await this.task(tx, id));
        const series = seriesOf(task);
        const keepTime = time === undefined ? task.dueTime : time;
        if (series && scope === 'occurrence' && date) {
          const record = planMove(series, await this.records(tx, id), date, keepTime, occurrenceDate);
          if (record) await this.writeOccurrence(tx, id, record);
        } else {
          await this.patchTask(tx, id, { dueDate: date, dueTime: date ? keepTime : null });
        }
      }
    });
    return undo;
  }

  private async records(tx: Tx, taskId: string): Promise<OccurrenceRecord[]> {
    return (await tx.find('task_occurrences', 'task_id', taskId)).map((r) => ({
      date: String(r.occurrence_date),
      status: r.status === 'skipped' ? 'skipped' : 'completed',
      completedAt: (r.completed_at as string) ?? null,
      movedToDate: (r.moved_to_date as string) ?? null,
      movedToTime: (r.moved_to_time as string) ?? null,
    }));
  }

  private async writeOccurrence(tx: Tx, taskId: string, r: OccurrenceRecord): Promise<void> {
    const id = occurrenceId(taskId, r.date);
    const existing = await tx.get('task_occurrences', id);
    if (existing?.deleted_at) await tx.restore('task_occurrences', id);
    await tx.write('task_occurrences', id, {
      task_id: taskId,
      occurrence_date: r.date,
      status: r.status,
      completed_at: r.completedAt ?? null,
      moved_to_date: r.movedToDate ?? null,
      moved_to_time: r.movedToTime ?? null,
    });
  }

  // ---- duplicate, delete, bulk -------------------------------------------------------------

  async duplicate(taskId: string): Promise<{ id: string; undo: UndoLog }> {
    const copyId = this.opts.newId();
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId, 'read'));
      await tx.write('tasks', copyId, {
        ...toColumns({
          title: task.title, description: task.description, notes: task.notes, priority: task.priority,
          status: isOpenStatus(task.status) ? task.status : 'not_started', projectId: task.projectId, categoryId: task.categoryId,
          dueDate: task.dueDate, dueTime: task.dueTime, estimatedMinutes: task.estimatedMinutes, rrule: task.rrule, recurUntil: task.recurUntil,
        }),
        sort_order: this.now().getTime(),
      });
      for (const s of await tx.find('subtasks', 'task_id', taskId)) {
        await tx.write('subtasks', this.opts.newId(), { task_id: copyId, title: s.title, sort_order: s.sort_order, is_completed: false });
      }
      for (const r of await tx.find('reminders', 'task_id', taskId)) {
        await tx.write('reminders', this.opts.newId(), {
          task_id: copyId, kind: r.kind, remind_at: r.remind_at, offset_minutes: r.offset_minutes, notification_type: r.notification_type,
        });
      }
      for (const link of await tx.find('task_tags', 'task_id', taskId)) {
        await tx.write('task_tags', taskTagId(copyId, String(link.tag_id)), { task_id: copyId, tag_id: link.tag_id });
      }
      for (const a of await tx.find('attachments', 'task_id', taskId)) {
        await tx.write('attachments', this.opts.newId(), { task_id: copyId, kind: a.kind, file_url: a.file_url, file_name: a.file_name });
      }
    });
    return { id: copyId, undo };
  }

  async deleteTasks(taskIds: string[]): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const id of taskIds) {
        await this.task(tx, id);
        for (const table of CHILD_TABLES) for (const child of await tx.find(table, 'task_id', id)) await tx.remove(table, child.id);
        await tx.remove('tasks', id);
      }
    });
    return undo;
  }

  /** The same change to several tasks at once. */
  async updateTasks(taskIds: string[], fields: Partial<TaskFields>): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const id of taskIds) await this.patchTask(tx, id, fields);
    });
    return undo;
  }


  // ---------------------------------------------------------------------------
  // Sharing with a group (src/core/sharing.ts)
  // ---------------------------------------------------------------------------

  /** Is this person an active member of the group, as far as this device knows? */
  private async isMember(tx: Tx, groupId: string, userId: string): Promise<boolean> {
    return (await tx.find('group_members', 'group_id', groupId)).some((m) => m.member_id === userId && m.status === 'active');
  }

  /**
   * Move a personal task into a group, with its subtasks, reminders and
   * repeat history. Its project, category, goal and tags are personal, so
   * they are left behind. It cannot be moved out again.
   */
  async shareTask(taskId: string, groupId: string, opts: { ownerId?: string | null; isPrivate?: boolean } = {}): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (task.groupId) throw new InvalidInput('This task is already in a group.');
      if (!(await this.isMember(tx, groupId, this.store.userId))) throw new InvalidInput('You are not a member of that group.');
      const owner = opts.ownerId ?? null;
      if (owner && !(await this.isMember(tx, groupId, owner))) throw new InvalidInput('That person is not a member of the group.');
      if ((await tx.find('attachments', 'task_id', taskId)).length) {
        throw new InvalidInput('Remove the task\'s links and files first: they are personal and cannot be shared.');
      }
      for (const link of await tx.find('task_tags', 'task_id', taskId)) await tx.remove('task_tags', link.id);
      await tx.write('tasks', taskId, {
        group_id: groupId, owner_id: owner, is_private: opts.isPrivate === true, created_by: task.createdBy ?? this.store.userId,
        project_id: null, category_id: null, goal_id: null,
      });
      for (const table of ['subtasks', 'reminders', 'task_occurrences'] as const) {
        for (const child of await tx.find(table, 'task_id', taskId)) await tx.write(table, child.id, { group_id: groupId });
      }
    });
    return undo;
  }

  /** Assign a group task to a member, or to nobody (back to its creator). */
  async assignTask(taskId: string, ownerId: string | null): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (!task.groupId) throw new InvalidInput('Only a task in a group can be assigned.');
      if (ownerId && !(await this.isMember(tx, task.groupId, ownerId))) throw new InvalidInput('That person is not a member of the group.');
      await tx.write('tasks', taskId, { owner_id: ownerId === task.createdBy ? null : ownerId });
    });
    return undo;
  }

  /** Hand a task assigned to me back to the person who created it. */
  async declineTask(taskId: string): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (!canDecline(task, this.store.userId)) throw new InvalidInput('Only a task someone else assigned to you can be handed back.');
      await tx.write('tasks', taskId, { owner_id: null });
    });
    return undo;
  }

  /** In a group: private means only its creator and the person it is assigned to see it. */
  async setTaskPrivate(taskId: string, isPrivate: boolean): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (!task.groupId) throw new InvalidInput('Only a task in a group can be private; your own tasks are always private.');
      await tx.write('tasks', taskId, { is_private: isPrivate });
    });
    return undo;
  }

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------

  async createGoal(input: GoalInput): Promise<{ id: string; undo: UndoLog }> {
    const title = input.title.trim();
    if (!title) throw new InvalidInput('A goal needs a name.');
    if (title.length > 200) throw new InvalidInput('A goal name can be at most 200 characters.');
    const id = this.opts.newId();
    const { undo } = await this.store.transaction((tx) =>
      tx.write('goals', id, {
        title, description: input.description ?? '', target_date: input.targetDate ?? null, color: input.color ?? null,
        icon: input.icon ?? null, status: 'active', sort_order: this.now().getTime(),
      }),
    );
    return { id, undo };
  }

  async updateGoal(id: string, input: Partial<GoalInput> & { status?: GoalStatus }): Promise<UndoLog> {
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new InvalidInput('A goal needs a name.');
      if (title.length > 200) throw new InvalidInput('A goal name can be at most 200 characters.');
      patch.title = title;
    }
    if (input.description !== undefined) {
      if (input.description.length > 5000) throw new InvalidInput('A description can be at most 5,000 characters.');
      patch.description = input.description;
    }
    if (input.targetDate !== undefined) patch.target_date = input.targetDate;
    if (input.color !== undefined) patch.color = input.color;
    if (input.icon !== undefined) {
      if (input.icon != null && !parseIcon(input.icon)) throw new InvalidInput('That picture cannot be used.');
      patch.icon = input.icon;
    }
    if (input.status !== undefined) patch.status = input.status;
    return (await this.store.transaction(async (tx) => {
      const row = await tx.get('goals', id);
      if (!row || row.deleted_at) throw new InvalidInput('That goal no longer exists.');
      await tx.write('goals', id, patch);
    })).undo;
  }

  /** Delete a goal. Its tasks stay; they just stop counting towards it. */
  async deleteGoal(id: string): Promise<UndoLog> {
    return (await this.store.transaction(async (tx) => {
      for (const task of await tx.find('tasks', 'goal_id', id)) await tx.write('tasks', task.id, { goal_id: null });
      await tx.remove('goals', id);
    })).undo;
  }

  // ---------------------------------------------------------------------------
  // Habits
  // ---------------------------------------------------------------------------

  async createHabit(input: HabitInput): Promise<{ id: string; undo: UndoLog }> {
    const columns = habitColumns({ schedule: 'daily', target: 1, unit: '', ...input });
    const id = this.opts.newId();
    const { undo } = await this.store.transaction((tx) => tx.write('habits', id, { ...columns, status: 'active', sort_order: this.now().getTime() }));
    return { id, undo };
  }

  async updateHabit(id: string, input: Partial<HabitInput> & { status?: 'active' | 'archived' }): Promise<UndoLog> {
    const { status, ...rest } = input;
    const columns = habitColumns(rest);
    if (status !== undefined) columns.status = status;
    return (await this.store.transaction(async (tx) => {
      const row = await tx.get('habits', id);
      if (!row || row.deleted_at) throw new InvalidInput('That habit no longer exists.');
      await tx.write('habits', id, columns);
    })).undo;
  }

  /** Delete a habit and its history. */
  async deleteHabit(id: string): Promise<UndoLog> {
    return (await this.store.transaction(async (tx) => {
      for (const log of await tx.find('habit_logs', 'habit_id', id)) await tx.remove('habit_logs', log.id);
      await tx.remove('habits', id);
    })).undo;
  }

  /** Record doing a habit (amount times) on a day. Each log is its own row, so logs from two devices add up. */
  async logHabit(habitId: string, date: LocalDate, amount = 1): Promise<UndoLog> {
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_TARGET) throw new InvalidInput(`An amount is a whole number from 1 to ${MAX_TARGET}.`);
    return (await this.store.transaction(async (tx) => {
      const habit = await tx.get('habits', habitId);
      if (!habit || habit.deleted_at) throw new InvalidInput('That habit no longer exists.');
      await tx.write('habit_logs', this.opts.newId(), { habit_id: habitId, log_date: date, amount, logged_at: this.now().toISOString() });
    })).undo;
  }

  /** Take back the most recent log of a habit on a day ("−"). Returns null when there is none. */
  async unlogHabit(habitId: string, date: LocalDate): Promise<UndoLog | null> {
    let found = false;
    const { undo } = await this.store.transaction(async (tx) => {
      const logs = (await tx.find('habit_logs', 'habit_id', habitId)).filter((l) => l.log_date === date);
      const last = logs.sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at)))[0];
      if (!last) return;
      found = true;
      await tx.remove('habit_logs', last.id);
    });
    return found ? undo : null;
  }

  // ---------------------------------------------------------------------------
  // Daily notes and weekly reviews
  // ---------------------------------------------------------------------------

  private async writeNote(tx: Tx, kind: 'day' | 'week', date: LocalDate, patch: Record<string, unknown>): Promise<void> {
    const id = noteId(this.store.userId, kind, date);
    const existing = await tx.get('daily_notes', id);
    if (existing?.deleted_at) await tx.restore('daily_notes', id);
    await tx.write('daily_notes', id, existing ? patch : { note_date: date, kind, body: '', ...patch });
  }

  async saveNote(kind: 'day' | 'week', date: LocalDate, body: string): Promise<UndoLog> {
    if (body.length > MAX_NOTE) throw new InvalidInput('A note can be at most 20,000 characters.');
    return (await this.store.transaction((tx) => this.writeNote(tx, kind, date, { body }))).undo;
  }

  /** Mark the day planned, or the week reviewed (null clears it). */
  async setPlanned(kind: 'day' | 'week', date: LocalDate, planned: boolean): Promise<UndoLog> {
    return (await this.store.transaction((tx) => this.writeNote(tx, kind, date, { planned_at: planned ? this.now().toISOString() : null }))).undo;
  }

  // ---------------------------------------------------------------------------
  // Focus timer
  // ---------------------------------------------------------------------------

  /** Start a focus session or a break. Anything still running is stopped first. */
  async startFocus(input: { kind: FocusKind; minutes: number; taskId: string | null; deviceId: string }): Promise<{ id: string; undo: UndoLog }> {
    if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > MAX_MINUTES) {
      throw new InvalidInput(`A session lasts from 1 to ${MAX_MINUTES} minutes.`);
    }
    const id = this.opts.newId();
    const now = this.now();
    const { undo } = await this.store.transaction(async (tx) => {
      if (input.taskId) await this.task(tx, input.taskId, 'read');
      const open = [...(await tx.find('focus_sessions', 'kind', 'focus')), ...(await tx.find('focus_sessions', 'kind', 'break'))];
      for (const r of open) {
        const end = Date.parse(String(r.started_at)) + Number(r.planned_minutes) * 60_000;
        if (!r.ended_at && end > now.getTime()) await tx.write('focus_sessions', r.id, { ended_at: now.toISOString() });
      }
      await tx.write('focus_sessions', id, {
        task_id: input.taskId, kind: input.kind, started_at: now.toISOString(), planned_minutes: input.minutes, device_id: input.deviceId,
      });
    });
    return { id, undo };
  }

  /** Stop a running session now. */
  async stopFocus(id: string): Promise<UndoLog> {
    return (await this.store.transaction(async (tx) => {
      const row = await tx.get('focus_sessions', id);
      if (!row || row.deleted_at || row.ended_at) return;
      await tx.write('focus_sessions', id, { ended_at: this.now().toISOString() });
    })).undo;
  }

  async deleteFocus(id: string): Promise<UndoLog> {
    return (await this.store.transaction((tx) => tx.remove('focus_sessions', id))).undo;
  }

  // ---------------------------------------------------------------------------
  // Eisenhower matrix
  // ---------------------------------------------------------------------------

  /**
   * Move a task to another box of the matrix: a new priority, a new date, or
   * both, in one step that one Undo reverses. A repeating task's current
   * occurrence (or the one named) moves; the series stays.
   */
  async applyMove(taskId: string, move: MatrixMove, occurrenceDate?: LocalDate): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const task = toTask(await this.task(tx, taskId));
      if (move.priority) await this.patchTask(tx, taskId, { priority: move.priority });
      if (move.date) {
        const series = seriesOf(task);
        if (series) {
          const record = planMove(series, await this.records(tx, taskId), move.date, task.dueTime, occurrenceDate);
          if (record) await this.writeOccurrence(tx, taskId, record);
        } else {
          await this.patchTask(tx, taskId, { dueDate: move.date });
        }
      }
    });
    return undo;
  }

  // ---------------------------------------------------------------------------
  // Projects, categories, saved filters
  // ---------------------------------------------------------------------------

  /** Everything in the account, for a backup file. */
  exportBackup(appVersion?: string): Promise<Backup> {
    return makeBackup(this.store, { now: this.now(), appVersion });
  }

  /** Bring every item in a backup back to how it was; returns an undo log. */
  restoreBackup(backup: Backup): Promise<{ changed: number; undo: UndoLog }> {
    return restoreBackup(this.store, backup);
  }

  /** Morning plan and evening check times (null = off), kept in the profile so every device uses them. */
  async setSummaries(userId: string, summaries: SummarySettings): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      const profile = await tx.get('profiles', userId);
      if (!profile) throw new InvalidInput('Your profile has not arrived from your account yet. Sync, then try again.');
      const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Record<string, unknown>;
      await tx.write('profiles', userId, { settings: { ...settings, notifications: { morning: summaries.morning, evening: summaries.evening } } });
    });
    return undo;
  }

  /** How tasks are coloured, kept in the profile so every device shows the same colours. */
  async setColorSettings(userId: string, patch: Partial<ColorSettings>): Promise<void> {
    await this.store.transaction(async (tx) => {
      const profile = await tx.get('profiles', userId);
      if (!profile) throw new InvalidInput('Your profile has not arrived from your account yet. Sync, then try again.');
      const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Record<string, unknown>;
      const current = readColorSettings(settings);
      const colors = { by: patch.by ?? current.by, priority: { ...current.priority, ...patch.priority } };
      await tx.write('profiles', userId, { settings: { ...settings, colors } });
    });
  }

  /** Google integration settings, kept in the profile so every device uses the same calendar, list and folder. */
  async setGoogleSettings(userId: string, patch: Partial<GoogleSettings>): Promise<void> {
    await this.store.transaction(async (tx) => {
      const profile = await tx.get('profiles', userId);
      if (!profile) throw new InvalidInput('Your profile has not arrived from your account yet. Sync, then try again.');
      const settings = (profile.settings && typeof profile.settings === 'object' ? profile.settings : {}) as Record<string, unknown>;
      const google = { ...readGoogleSettings(settings), ...patch };
      await tx.write('profiles', userId, { settings: { ...settings, google } });
    });
  }

  /** Remember which Google Tasks item a task belongs to (calendar_links holds it). */
  async linkExternal(taskId: string, provider: string, listId: string, externalId: string): Promise<void> {
    await this.store.transaction(async (tx) => {
      const id = externalLinkId(taskId, listId);
      const existing = await tx.get('calendar_links', id);
      if (existing?.deleted_at) await tx.restore('calendar_links', id);
      if (existing && !existing.deleted_at && existing.event_id === externalId && existing.provider === provider) return;
      await tx.write('calendar_links', id, { task_id: taskId, provider, calendar_id: listId, event_id: externalId, last_synced_at: this.now().toISOString() });
    });
  }

  /** A task brought in from Google Tasks, with its subtasks and the link back to the Google task, in one step. */
  async importTask(input: {
    title: string; description: string; dueDate: LocalDate | null; completedAt: string | null; projectId: string | null;
    subtasks: { title: string; done: boolean }[]; provider: string; listId: string; googleId: string;
  }): Promise<string> {
    const id = this.opts.newId();
    await this.store.transaction(async (tx) => {
      const organised = !!(input.projectId || input.dueDate);
      await tx.write('tasks', id, {
        title: input.title.slice(0, 500), description: input.description, project_id: input.projectId, due_date: input.dueDate,
        status: input.completedAt ? 'completed' : organised ? 'not_started' : 'inbox', completed_at: input.completedAt,
        priority: 'medium', sort_order: this.now().getTime(),
      });
      for (const [i, sub] of input.subtasks.entries()) {
        await tx.write('subtasks', this.opts.newId(), { task_id: id, title: sub.title.slice(0, 500), is_completed: sub.done, sort_order: i });
      }
      await tx.write('calendar_links', externalLinkId(id, input.listId), {
        task_id: id, provider: input.provider, calendar_id: input.listId, event_id: input.googleId, last_synced_at: this.now().toISOString(),
      });
    });
    return id;
  }

  /** The project with this name (any letter case), or a new one. */
  async projectNamed(name: string): Promise<string> {
    const wanted = name.trim().toLowerCase();
    const found = (await this.store.rows('projects')).find((p) => String(p.name ?? '').trim().toLowerCase() === wanted);
    if (found) return found.id;
    return (await this.createProject({ name: name.trim().slice(0, 100) || 'Google Tasks' })).id;
  }

  /** A file uploaded to Google Drive, attached to a task as a Drive link. */
  async addDriveFile(taskId: string, file: { url: string; name: string; mimeType: string | null; size: number | null }): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      if (toTask(await this.task(tx, taskId)).groupId) throw new InvalidInput(Actions.PERSONAL_ONLY);
      await tx.write('attachments', this.opts.newId(), {
        task_id: taskId, kind: 'drive', file_url: file.url, file_name: file.name.slice(0, 500), mime_type: file.mimeType, size_bytes: file.size,
      });
    });
    return undo;
  }

  /**
   * Keep the account's time zone in step with this device (Phase 5 uses it for
   * server-sent summaries). Only once the profile has arrived from the server.
   */
  async setTimezone(userId: string, timezone: string): Promise<boolean> {
    const { result } = await this.store.transaction(async (tx) => {
      const profile = await tx.get('profiles', userId);
      if (!profile || profile.timezone === timezone) return false;
      await tx.write('profiles', userId, { timezone });
      return true;
    });
    return result;
  }

  async createProject(input: ProjectInput): Promise<{ id: string; undo: UndoLog }> {
    const name = input.name.trim();
    if (!name) throw new InvalidInput('A project needs a name.');
    const id = this.opts.newId();
    const { undo } = await this.store.transaction((tx) =>
      tx.write('projects', id, {
        name, description: input.description?.trim() ?? '', color: input.color ?? null, deadline: input.deadline ?? null,
        sort_order: this.now().getTime(),
      }),
    );
    return { id, undo };
  }

  async updateProject(id: string, input: Partial<ProjectInput> & { status?: 'active' | 'archived' }): Promise<UndoLog> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new InvalidInput('A project needs a name.');
      patch.name = input.name.trim();
    }
    if (input.description !== undefined) patch.description = input.description.trim();
    if (input.color !== undefined) patch.color = input.color;
    if (input.deadline !== undefined) patch.deadline = input.deadline;
    if (input.status !== undefined) patch.status = input.status;
    return (await this.store.transaction((tx) => tx.write('projects', id, patch))).undo;
  }

  /** Deletes the project. Its tasks are kept, without a project. */
  async deleteProject(id: string): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const t of await tx.find('tasks', 'project_id', id)) await tx.write('tasks', t.id, { project_id: null });
      await tx.remove('projects', id);
    });
    return undo;
  }

  async createCategory(name: string, color: string | null = null): Promise<{ id: string; undo: UndoLog }> {
    const clean = name.trim();
    if (!clean) throw new InvalidInput('A category needs a name.');
    const id = this.opts.newId();
    const { undo } = await this.store.transaction((tx) => tx.write('categories', id, { name: clean, color, sort_order: this.now().getTime() }));
    return { id, undo };
  }

  async updateCategory(id: string, fields: { name?: string; color?: string | null }): Promise<UndoLog> {
    const patch: Record<string, unknown> = {};
    if (fields.name !== undefined) {
      if (!fields.name.trim()) throw new InvalidInput('A category needs a name.');
      patch.name = fields.name.trim();
    }
    if (fields.color !== undefined) patch.color = fields.color;
    return (await this.store.transaction((tx) => tx.write('categories', id, patch))).undo;
  }

  /** Deletes the category. Its tasks are kept, without a category. */
  async deleteCategory(id: string): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const t of await tx.find('tasks', 'category_id', id)) await tx.write('tasks', t.id, { category_id: null });
      await tx.remove('categories', id);
    });
    return undo;
  }

  async saveFilter(name: string, filter: TaskFilter): Promise<{ id: string; undo: UndoLog }> {
    const clean = name.trim();
    if (!clean) throw new InvalidInput('A saved filter needs a name.');
    const id = this.opts.newId();
    const { undo } = await this.store.transaction((tx) => tx.write('saved_filters', id, { name: clean, query: filter, sort_order: this.now().getTime() }));
    return { id, undo };
  }

  async deleteFilter(id: string): Promise<UndoLog> {
    return (await this.store.transaction((tx) => tx.remove('saved_filters', id))).undo;
  }
}
