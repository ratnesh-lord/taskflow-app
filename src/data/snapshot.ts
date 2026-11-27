/**
 * Everything the screens show, read in one go and shaped for src/core.
 * A personal task list is small enough to hold in memory; screens work out
 * their lists from this snapshot with the pure functions in src/core.
 */
import type { ReminderRecord, TaskRecord } from '@/core/agenda';
import { normaliseTime } from '@/core/dates';
import type { FocusRecord } from '@/core/focus';
import type { GoalRecord } from '@/core/goals';
import type { HabitLogRecord, HabitRecord } from '@/core/habits';
import { readFilter, type TaskFilter } from '@/core/filters';
import type { OccurrenceRecord } from '@/core/recurrence';
import { type GroupRole, isMine } from '@/core/sharing';
import type { Priority, TaskStatus } from '@/core/types';

import type { TableName } from './schema';
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
/** A day's note ("day") or a week's review ("week", dated by its Monday). */
export type NoteRecord = { id: string; kind: 'day' | 'week'; date: string; body: string; plannedAt: string | null; updatedAt: string };

export type MemberRecord = {
  id: string;
  groupId: string;
  memberId: string;
  username: string;
  displayName: string;
  role: GroupRole;
  status: 'invited' | 'active';
};
export type GroupRecord = {
  id: string;
  name: string;
  createdBy: string | null;
  /** My role, or null while I am only invited. */
  myRole: GroupRole | null;
  /** Active members first (owner, admins, members), then open invitations. */
  members: MemberRecord[];
};
export type InviteRecord = { groupId: string; groupName: string; invitedBy: string };

export type DataSnapshot = {
  /** The signed-in account. */
  me: { userId: string; username: string | null; name: string };
  /**
   * My tasks: personal ones, and group tasks assigned to me (or created by
   * me and assigned to nobody). Every list, widget and reminder uses these.
   */
  tasks: TaskRecord[];
  /** Every task in my groups that I can see, mine included. */
  groupTasks: TaskRecord[];
  /** Groups I am in, by name. */
  groups: GroupRecord[];
  /** Open invitations to groups. */
  invites: InviteRecord[];
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
  goals: GoalRecord[];
  /** Live habits, active and archived. */
  habits: HabitRecord[];
  /** Logs per habit id (live habits only). */
  habitLogs: Map<string, HabitLogRecord[]>;
  /** Notes by "<kind>:<date>", e.g. "day:2026-11-25". */
  notes: Map<string, NoteRecord>;
  /** Newest first. */
  focusSessions: FocusRecord[];
  /** Edits waiting to be sent to the server. */
  pendingEdits: number;
  /** The account's profile, once it has arrived from the server. */
  profile: { timezone: string; settings: Record<string, unknown> } | null;
};

/** A task by id, mine or another group member's. */
export function findTask(data: Pick<DataSnapshot, 'tasks' | 'groupTasks'>, id: string): TaskRecord | undefined {
  return data.tasks.find((t) => t.id === id) ?? data.groupTasks.find((t) => t.id === id);
}

const ROLE_ORDER: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

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
    icon: strOrNull(r.icon),
    goalId: strOrNull(r.goal_id),
    groupId: strOrNull(r.group_id),
    ownerId: strOrNull(r.owner_id),
    createdBy: strOrNull(r.created_by),
    isPrivate: r.is_private === true,
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

/**
 * Rows read for the screens, kept per store and table. A table is read again
 * only when it has changed since (Store.version), so ticking a task re-reads
 * the tasks, not a year of repeat history or habit logs.
 */
const cache = new WeakMap<Store, Map<TableName, { version: number; rows: Promise<Row[]> }>>();

function rowsOf(store: Store, table: TableName): Promise<Row[]> {
  let tables = cache.get(store);
  if (!tables) {
    tables = new Map();
    cache.set(store, tables);
  }
  const version = store.version(table);
  const hit = tables.get(table);
  if (hit && hit.version === version) return hit.rows;
  // Only a few rows changed (a tick, an edit): read just those and patch them in.
  const changed = hit ? store.changedSince(table, hit.version) : null;
  const rows = hit && changed ? patchRows(hit.rows, store.viewRows(table, [...changed]), changed) : store.view(table);
  tables.set(table, { version, rows });
  // A failed read is not kept.
  rows.catch(() => tables.delete(table));
  return rows;
}

/** Forget the cached rows of a store (tests compare against a fresh read). */
export function forgetCachedRows(store: Store): void {
  cache.delete(store);
}

/**
 * The cached rows with the changed ones replaced, removed (deleted, or gone)
 * or added at the end, as a fresh read would list them.
 */
async function patchRows(before: Promise<Row[]>, fresh: Promise<Row[]>, changed: ReadonlySet<string>): Promise<Row[]> {
  const [old, now] = await Promise.all([before, fresh]);
  const live = new Map(now.filter((r) => !r.deleted_at).map((r) => [r.id, r]));
  const out: Row[] = [];
  for (const r of old) {
    if (!changed.has(r.id)) out.push(r);
    else if (live.has(r.id)) {
      out.push(live.get(r.id)!);
      live.delete(r.id);
    }
  }
  for (const r of live.values()) out.push(r);
  return out;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const list = out.get(key(item)) ?? [];
    list.push(item);
    out.set(key(item), list);
  }
  return out;
}

export async function loadSnapshot(store: Store): Promise<DataSnapshot> {
  const [goals, habits, habitLogs, notes, sessions] = await Promise.all([
    rowsOf(store, 'goals'),
    rowsOf(store, 'habits'),
    rowsOf(store, 'habit_logs'),
    rowsOf(store, 'daily_notes'),
    rowsOf(store, 'focus_sessions'),
  ]);
  const [tasks, occurrences, projects, categories, tags, taskTags, subtasks, reminders, attachments, filters, pending, external] = await Promise.all([
    rowsOf(store, 'tasks'),
    rowsOf(store, 'task_occurrences'),
    rowsOf(store, 'projects'),
    rowsOf(store, 'categories'),
    rowsOf(store, 'tags'),
    rowsOf(store, 'task_tags'),
    rowsOf(store, 'subtasks'),
    rowsOf(store, 'reminders'),
    rowsOf(store, 'attachments'),
    rowsOf(store, 'saved_filters'),
    store.outboxCount(),
    rowsOf(store, 'calendar_links'),
  ]);
  const [profileRow] = await rowsOf(store, 'profiles');
  const [groupRows, memberRows] = await Promise.all([rowsOf(store, 'groups'), rowsOf(store, 'group_members')]);
  const me = store.userId;

  const liveTasks = new Set(tasks.map((t) => t.id));
  const liveGoals = new Set(goals.map((g) => g.id));
  const liveHabits = new Set(habits.map((h) => h.id));
  const liveTags = new Set(tags.map((t) => t.id));
  const ofLiveTask = (r: Row) => liveTasks.has(str(r.task_id));

  const tagMap = new Map<string, string[]>();
  for (const r of taskTags) {
    if (!ofLiveTask(r) || !liveTags.has(str(r.tag_id))) continue;
    const list = tagMap.get(str(r.task_id)) ?? [];
    list.push(str(r.tag_id));
    tagMap.set(str(r.task_id), list);
  }

  const allTasks = tasks.map(toTask).map((t) => (t.goalId && !liveGoals.has(t.goalId) ? { ...t, goalId: null } : t));
  const members = memberRows
    .map((r) => ({
      id: r.id, groupId: str(r.group_id), memberId: str(r.member_id), username: str(r.username), displayName: str(r.display_name),
      role: (r.role === 'owner' || r.role === 'admin' ? r.role : 'member') as GroupRole,
      status: (r.status === 'active' ? 'active' : 'invited') as MemberRecord['status'],
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
      || (a.displayName || a.username).localeCompare(b.displayName || b.username));
  const membersOf = groupBy(members, (m) => m.groupId);
  const groups: GroupRecord[] = [];
  const invites: InviteRecord[] = [];
  for (const g of groupRows) {
    const list = membersOf.get(g.id) ?? [];
    const mine = list.find((m) => m.memberId === me);
    if (mine?.status === 'invited') {
      const raw = memberRows.find((r) => r.id === mine.id);
      invites.push({ groupId: g.id, groupName: str(g.name), invitedBy: str(raw?.invited_by_name) });
      continue;
    }
    groups.push({ id: g.id, name: str(g.name), createdBy: strOrNull(g.created_by), myRole: mine?.role ?? null, members: list });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  const inMyGroups = new Set(groups.map((g) => g.id));

  return {
    me: { userId: me, username: profileRow ? strOrNull(profileRow.username) : null, name: profileRow ? str(profileRow.name) : '' },
    tasks: allTasks.filter((t) => isMine(t, me)),
    groupTasks: allTasks.filter((t) => t.groupId && inMyGroups.has(t.groupId)),
    groups,
    invites,
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
    goals: goals.map((r) => ({
      id: r.id, title: str(r.title), description: str(r.description), targetDate: strOrNull(r.target_date),
      status: (r.status === 'achieved' || r.status === 'dropped' ? r.status : 'active') as GoalRecord['status'],
      color: strOrNull(r.color), icon: strOrNull(r.icon), sortOrder: num(r.sort_order), createdAt: str(r.created_at),
    })),
    habits: habits
      .map((r) => ({
        id: r.id, title: str(r.title), icon: strOrNull(r.icon), color: strOrNull(r.color), schedule: str(r.schedule) || 'daily',
        target: Math.max(1, num(r.target)), unit: str(r.unit), reminderTime: normaliseTime(strOrNull(r.reminder_time)),
        status: (r.status === 'archived' ? 'archived' : 'active') as HabitRecord['status'], sortOrder: num(r.sort_order), createdAt: str(r.created_at),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt)),
    habitLogs: groupBy(
      habitLogs.filter((r) => liveHabits.has(str(r.habit_id))).map((r) => ({
        id: r.id, habitId: str(r.habit_id), date: str(r.log_date), amount: Math.max(1, num(r.amount)), loggedAt: str(r.logged_at) || str(r.created_at),
      })),
      (l) => l.habitId,
    ),
    notes: new Map(
      notes.map((r) => {
        const kind = r.kind === 'week' ? 'week' : 'day';
        return [`${kind}:${str(r.note_date)}`, { id: r.id, kind, date: str(r.note_date), body: str(r.body), plannedAt: strOrNull(r.planned_at), updatedAt: str(r.updated_at) }];
      }),
    ),
    focusSessions: sessions
      .map((r) => ({
        id: r.id, taskId: liveTasks.has(str(r.task_id)) ? str(r.task_id) : null, kind: (r.kind === 'break' ? 'break' : 'focus') as FocusRecord['kind'],
        startedAt: str(r.started_at), plannedMinutes: Math.max(1, num(r.planned_minutes)), endedAt: strOrNull(r.ended_at), deviceId: strOrNull(r.device_id),
      }))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    pendingEdits: pending,
    profile: profileRow
      ? {
          timezone: str(profileRow.timezone) || 'UTC',
          settings: profileRow.settings && typeof profileRow.settings === 'object' ? (profileRow.settings as Record<string, unknown>) : {},
        }
      : null,
  };
}
