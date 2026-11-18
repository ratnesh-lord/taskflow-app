/**
 * Filtering, sorting and searching task lists. A filter is plain data, so it
 * can be saved (saved_filters.query) and shown as a sentence.
 */
import { compareItems, type TaskItem } from './agenda';
import { addDays, type Now } from './dates';
import { type Priority, PRIORITY_LABEL, PRIORITY_RANK, STATUS_LABEL, type TaskStatus } from './types';

export type DueFilter = 'any' | 'overdue' | 'today' | 'tomorrow' | 'next7' | 'next30' | 'none';
export type ShowFilter = 'open' | 'completed' | 'all';
export type SortKey = 'due' | 'priority' | 'created' | 'title';

/** Matches the project, category or tag being unset. */
export const NONE_ID = 'none';

export type TaskFilter = {
  text?: string;
  show?: ShowFilter;
  due?: DueFilter;
  priorities?: Priority[];
  statuses?: TaskStatus[];
  projectIds?: string[];
  categoryIds?: string[];
  /** Any of these tags. */
  tagIds?: string[];
  sort?: SortKey;
};

export const DUE_LABEL: Record<DueFilter, string> = {
  any: 'Any date',
  overdue: 'Overdue',
  today: 'Due today',
  tomorrow: 'Due tomorrow',
  next7: 'Next 7 days',
  next30: 'Next 30 days',
  none: 'No date',
};

export const SORT_LABEL: Record<SortKey, string> = {
  due: 'Due date',
  priority: 'Priority',
  created: 'Newest first',
  title: 'Title',
};

export type FilterContext = {
  now: Now;
  tagIdsOf: (taskId: string) => readonly string[];
};

/** Every word must appear somewhere in the title, description or notes. */
export function matchesText(item: TaskItem, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${item.task.title}\n${item.task.description}\n${item.task.notes}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}

function matchesDue(item: TaskItem, due: DueFilter, now: Now): boolean {
  const d = item.date;
  switch (due) {
    case 'any':
      return true;
    case 'none':
      return !d;
    case 'overdue':
      return item.open && item.overdue;
    case 'today':
      return d === now.date;
    case 'tomorrow':
      return d === addDays(now.date, 1);
    case 'next7':
      return !!d && d > now.date && d <= addDays(now.date, 7);
    case 'next30':
      return !!d && d > now.date && d <= addDays(now.date, 30);
  }
}

export function matchesFilter(item: TaskItem, filter: TaskFilter, ctx: FilterContext): boolean {
  const show = filter.show ?? 'open';
  if (show === 'open' && !item.open) return false;
  if (show === 'completed' && item.task.status !== 'completed' && !(item.repeating && !item.open)) return false;
  if (filter.text && !matchesText(item, filter.text)) return false;
  if (filter.due && !matchesDue(item, filter.due, ctx.now)) return false;
  if (filter.priorities?.length && !filter.priorities.includes(item.task.priority)) return false;
  if (filter.statuses?.length && !filter.statuses.includes(item.task.status)) return false;
  if (filter.projectIds?.length && !filter.projectIds.includes(item.task.projectId ?? NONE_ID)) return false;
  if (filter.categoryIds?.length && !filter.categoryIds.includes(item.task.categoryId ?? NONE_ID)) return false;
  if (filter.tagIds?.length) {
    const tags = ctx.tagIdsOf(item.task.id);
    if (!filter.tagIds.some((t) => tags.includes(t))) return false;
  }
  return true;
}

export function sortItems(items: readonly TaskItem[], key: SortKey = 'due'): TaskItem[] {
  const out = [...items];
  switch (key) {
    case 'due':
      return out.sort(compareItems);
    case 'priority':
      return out.sort((a, b) => PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority] || compareItems(a, b));
    case 'created':
      return out.sort((a, b) => (a.task.createdAt < b.task.createdAt ? 1 : a.task.createdAt > b.task.createdAt ? -1 : 0));
    case 'title':
      return out.sort((a, b) => a.task.title.localeCompare(b.task.title, undefined, { sensitivity: 'base' }) || compareItems(a, b));
  }
}

export function filterItems(items: readonly TaskItem[], filter: TaskFilter, ctx: FilterContext): TaskItem[] {
  return sortItems(items.filter((i) => matchesFilter(i, filter, ctx)), filter.sort);
}

/** How many conditions are set, not counting sort and the default "open". */
export function activeConditions(filter: TaskFilter): number {
  let n = 0;
  if (filter.show && filter.show !== 'open') n += 1;
  if (filter.due && filter.due !== 'any') n += 1;
  for (const list of [filter.priorities, filter.statuses, filter.projectIds, filter.categoryIds, filter.tagIds]) if (list?.length) n += 1;
  return n;
}

export type FilterNames = { project: (id: string) => string; category: (id: string) => string; tag: (id: string) => string };

/** "High, Critical · Overdue · #exam" */
export function describeFilter(filter: TaskFilter, names: FilterNames): string {
  const parts: string[] = [];
  if (filter.show === 'completed') parts.push('Completed');
  if (filter.show === 'all') parts.push('Open and completed');
  if (filter.due && filter.due !== 'any') parts.push(DUE_LABEL[filter.due]);
  if (filter.priorities?.length) parts.push(filter.priorities.map((p) => PRIORITY_LABEL[p]).join(', '));
  if (filter.statuses?.length) parts.push(filter.statuses.map((s) => STATUS_LABEL[s]).join(', '));
  if (filter.projectIds?.length) parts.push(filter.projectIds.map((id) => (id === NONE_ID ? 'No project' : names.project(id))).join(', '));
  if (filter.categoryIds?.length) parts.push(filter.categoryIds.map((id) => (id === NONE_ID ? 'No category' : names.category(id))).join(', '));
  if (filter.tagIds?.length) parts.push(filter.tagIds.map((id) => `#${names.tag(id)}`).join(' '));
  if (filter.text?.trim()) parts.push(`“${filter.text.trim()}”`);
  return parts.length ? parts.join(' · ') : 'All open tasks';
}

/** Reads a saved filter, dropping anything unknown, so an old or edited value never breaks a screen. */
export function readFilter(value: unknown): TaskFilter {
  if (!value || typeof value !== 'object') return {};
  const v = value as Record<string, unknown>;
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : undefined);
  const pick = <T extends string>(x: unknown, allowed: readonly T[]) => (typeof x === 'string' && (allowed as readonly string[]).includes(x) ? (x as T) : undefined);
  const out: TaskFilter = {
    text: typeof v.text === 'string' ? v.text : undefined,
    show: pick(v.show, ['open', 'completed', 'all'] as const),
    due: pick(v.due, ['any', 'overdue', 'today', 'tomorrow', 'next7', 'next30', 'none'] as const),
    priorities: strings(v.priorities)?.filter((p): p is Priority => p in PRIORITY_RANK),
    statuses: strings(v.statuses)?.filter((s): s is TaskStatus => s in STATUS_LABEL),
    projectIds: strings(v.projectIds),
    categoryIds: strings(v.categoryIds),
    tagIds: strings(v.tagIds),
    sort: pick(v.sort, ['due', 'priority', 'created', 'title'] as const),
  };
  for (const key of Object.keys(out) as (keyof TaskFilter)[]) if (out[key] === undefined) delete out[key];
  return out;
}
