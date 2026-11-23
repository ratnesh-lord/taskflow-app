/**
 * Everything the screens show, read in one go and shaped for src/core.
 * A personal task list is small enough to hold in memory; screens work out
 * their lists from this snapshot with the pure functions in src/core.
 */
import type { ReminderRecord, TaskRecord } from '@/core/agenda';
import { normaliseTime } from '@/core/dates';
import { readFilter, type TaskFilter } from '@/core/filters';
import type { OccurrenceRecord } from '@/core/recurrence';
import type { Priority, TaskStatus } from '@/core/types';

import type { Row, Store } from './store';

export type ProjectRecord = {
  id: string;
  name: string;
  description: string;
  color: string | null;
  deadline: string | null;
  status: 'active' | 'archived';
  sortOrder: number;
  createdAt: string;
};
export type CategoryRecord = { id: string; name: string; color: string | null; sortOrder: number };
export type TagRecord = { id: string; name: string };
export type SubtaskRecord = { id: string; taskId: string; title: string; isCompleted: boolean; sortOrder: number };
export type LinkRecord = { id: string; taskId: string; url: string; name: string; kind: 'file' | 'link' | 'drive' };
/** Which Google Tasks item belongs to which task (stored in calendar_links). */
export type ExternalLinkRecord = { id: string; taskId: string; provider: string; listId: string; externalId: string };
export type SavedFilterRecord = { id: string; name: string; filter: TaskFilter; sortOrder: number };
export type OccurrenceRow = OccurrenceRecord & { id: string; taskId: string };

export type DataSnapshot = {
  tasks: TaskRecord[];
  occurrences: Map<string, OccurrenceRow[]>;
  projects: ProjectRecord[];
  categories: CategoryRecord[];
  tags: TagRecord[];
  /** Tag ids per task id (live tags only). */
  taskTags: Map<string, string[]>;
  subtasks: Map<string, SubtaskRecord[]>;
  reminders: ReminderRecord[];
  links: Map<string, LinkRecord[]>;
  externalLinks: ExternalLinkRecord[];
  savedFilters: SavedFilterRecord[];
  /** Edits waiting to be sent to the server. */
  pendingEdits: number;
  /** The account's profile, once it has arrived from the server. */
  profile: { timezone: string; settings: Record<string, unknown> } | null;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

export function toTask(r: Row): TaskRecord {
  return {
    id: r.id,
    title: str(r.title),
    description: str(r.description),
    notes: str(r.notes),
    status: (r.status as TaskStatus) ?? 'inbox',
    priority: (r.priority as Priority) ?? 'medium',
    projectId: strOrNull(r.project_id),
    categoryId: strOrNull(r.category_id),
    dueDate: strOrNull(r.due_date),
    dueTime: normaliseTime(strOrNull(r.due_time)),
    estimatedMinutes: numOrNull(r.estimated_minutes),
    completedAt: strOrNull(r.completed_at),
    rrule: strOrNull(r.rrule),
    recurUntil: strOrNull(r.recur_until),
    sortOrder: num(r.sort_order),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function group<T extends { taskId: string }>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const list = out.get(item.taskId) ?? [];
    list.push(item);
    out.set(item.taskId, list);
  }
  return out;
}

export async function loadSnapshot(store: Store): Promise<DataSnapshot> {
  const [tasks, occurrences, projects, categories, tags, taskTags, subtasks, reminders, attachments, filters, pending, external] = await Promise.all([
    store.rows('tasks'),
    store.rows('task_occurrences'),
    store.rows('projects'),
    store.rows('categories'),
    store.rows('tags'),
    store.rows('task_tags'),
    store.rows('subtasks'),
    store.rows('reminders'),
    store.rows('attachments'),
    store.rows('saved_filters'),
    store.outboxCount(),
    store.rows('calendar_links'),
  ]);
  const [profileRow] = await store.rows('profiles');

  const liveTasks = new Set(tasks.map((t) => t.id));
  const liveTags = new Set(tags.map((t) => t.id));
  const ofLiveTask = (r: Row) => liveTasks.has(str(r.task_id));

  const tagMap = new Map<string, string[]>();
  for (const r of taskTags) {
    if (!ofLiveTask(r) || !liveTags.has(str(r.tag_id))) continue;
    const list = tagMap.get(str(r.task_id)) ?? [];
    list.push(str(r.tag_id));
    tagMap.set(str(r.task_id), list);
  }

  return {
    tasks: tasks.map(toTask),
    occurrences: group(
      occurrences.filter(ofLiveTask).map((r) => ({
        id: r.id,
        taskId: str(r.task_id),
        date: str(r.occurrence_date),
        status: r.status === 'skipped' ? 'skipped' : 'completed',
        completedAt: strOrNull(r.completed_at),
        movedToDate: strOrNull(r.moved_to_date),
        movedToTime: normaliseTime(strOrNull(r.moved_to_time)),
      })),
    ),
    projects: projects
      .map((r) => ({
        id: r.id, name: str(r.name), description: str(r.description), color: strOrNull(r.color), deadline: strOrNull(r.deadline),
        status: (r.status === 'archived' ? 'archived' : 'active') as ProjectRecord['status'], sortOrder: num(r.sort_order), createdAt: str(r.created_at),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    categories: categories
      .map((r) => ({ id: r.id, name: str(r.name), color: strOrNull(r.color), sortOrder: num(r.sort_order) }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    tags: tags.map((r) => ({ id: r.id, name: str(r.name) })).sort((a, b) => a.name.localeCompare(b.name)),
    taskTags: tagMap,
    subtasks: group(
      subtasks.filter(ofLiveTask)
        .map((r) => ({ id: r.id, taskId: str(r.task_id), title: str(r.title), isCompleted: r.is_completed === true, sortOrder: num(r.sort_order) }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ),
    reminders: reminders.filter(ofLiveTask).map((r) => ({
      id: r.id,
      taskId: str(r.task_id),
      kind: r.kind === 'before_due' ? 'before_due' : 'absolute',
      remindAt: strOrNull(r.remind_at),
      offsetMinutes: numOrNull(r.offset_minutes),
      isActive: r.is_active !== false,
    })),
    links: group(
      attachments.filter(ofLiveTask).map((r) => ({
        id: r.id, taskId: str(r.task_id), url: str(r.file_url), name: str(r.file_name),
        kind: (r.kind === 'drive' || r.kind === 'file' ? r.kind : 'link') as LinkRecord['kind'],
      })),
    ),
    externalLinks: external.filter(ofLiveTask).map((r) => ({
      id: r.id, taskId: str(r.task_id), provider: str(r.provider), listId: str(r.calendar_id), externalId: str(r.event_id),
    })),
    savedFilters: filters
      .map((r) => ({ id: r.id, name: str(r.name), filter: readFilter(r.query), sortOrder: num(r.sort_order) }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    pendingEdits: pending,
    profile: profileRow
      ? {
          timezone: str(profileRow.timezone) || 'UTC',
          settings: profileRow.settings && typeof profileRow.settings === 'object' ? (profileRow.settings as Record<string, unknown>) : {},
        }
      : null,
  };
}
