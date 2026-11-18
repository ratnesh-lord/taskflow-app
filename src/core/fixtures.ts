/** Test helpers: a task record with sensible defaults. Not used by the app. */
import type { TaskRecord } from './agenda';

let counter = 0;

export function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    title: `Task ${counter}`,
    description: '',
    notes: '',
    status: 'not_started',
    priority: 'medium',
    projectId: null,
    categoryId: null,
    dueDate: null,
    dueTime: null,
    estimatedMinutes: null,
    completedAt: null,
    rrule: null,
    recurUntil: null,
    sortOrder: 0,
    createdAt: `2026-11-01T00:00:${String(counter % 60).padStart(2, '0')}Z`,
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}
