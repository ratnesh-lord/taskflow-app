/**
 * Everything the user can do to their data. Each action is one transaction
 * and returns an undo log, so any of them can be reversed with one tap.
 */
import { seriesOf } from '@/core/agenda';
import { type LocalDate, type LocalTime, localDateOf, toMoment } from '@/core/dates';
import { normaliseTagName, occurrenceId, tagId, taskTagId } from '@/core/ids';
import type { QuickAdd, ReminderDraft } from '@/core/quick-add';
import { type OccurrenceRecord, planCompletion, planMove, planSkip } from '@/core/recurrence';
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
};

export type TaskInput = Partial<TaskFields> & {
  title: string;
  tags?: string[];
  subtasks?: string[];
  reminders?: ReminderDraft[];
  links?: LinkInput[];
};

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

  private async task(tx: Tx, id: string): Promise<Row> {
    const row = await tx.get('tasks', id);
    if (!row || row.deleted_at) throw new InvalidInput('That task no longer exists.');
    return row;
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
      const organised = !!(input.projectId || input.categoryId || input.dueDate);
      columns.status = input.status ?? (organised ? 'not_started' : 'inbox');
      columns.priority = input.priority ?? 'medium';
      columns.sort_order = this.now().getTime();
      if (columns.status === 'completed') columns.completed_at = this.now().toISOString();
      await tx.write('tasks', id, columns);
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
  async createFromQuickAdd(parsed: QuickAdd, defaults: Partial<TaskFields> = {}): Promise<{ id: string; undo: UndoLog }> {
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
      await this.task(tx, taskId);
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
      await this.task(tx, taskId);
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
    return (await this.store.transaction((tx) => tx.write('subtasks', id, patch))).undo;
  }

  async deleteSubtask(id: string): Promise<UndoLog> {
    return (await this.store.transaction((tx) => tx.remove('subtasks', id))).undo;
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
  ): Promise<UndoLog> {
    const { undo } = await this.store.transaction(async (tx) => {
      for (const id of taskIds) {
        const task = toTask(await this.task(tx, id));
        const series = seriesOf(task);
        const keepTime = time === undefined ? task.dueTime : time;
        if (series && scope === 'occurrence' && date) {
          const record = planMove(series, await this.records(tx, id), date, keepTime);
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
      const task = toTask(await this.task(tx, taskId));
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
