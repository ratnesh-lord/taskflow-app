/**
 * Performance with a large account: how long the work behind each screen and
 * each notification plan takes, on this machine, with
 *   2,000 tasks (1,200 open, 600 done, 150 repeating with a year of history),
 *   30 projects, 8 habits with a year of logs, 600 focus sessions.
 * Each budget is several times the time measured when it was set, so the test
 * fails on a real slowdown, not on a busy CI machine. PERF=1 prints the table.
 * A phone runs the same JavaScript roughly 3 to 5 times slower.
 */
import { randomUUID } from 'node:crypto';

import { allItems, todayView, upcomingView } from '@/core/agenda';
import { planAlarms } from '@/core/alarms';
import { completionRate, donePerDay } from '@/core/analytics';
import { addDays, type LocalDate } from '@/core/dates';
import { focusTotals } from '@/core/focus';
import { streakOf } from '@/core/habits';
import { matrixOf } from '@/core/matrix';
import { dayPlan, weekReview } from '@/core/planning';
import { widgetData } from '@/core/widgets';

import { loadSnapshot } from './snapshot';
import { Store } from './store';
import { openNodeDb } from './testing/node-db';

const USER = '11111111-1111-4111-8111-111111111111';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const moment = new Date(2026, 10, 25, 10, 0);
const today = '2026-11-25';
const now = { date: today, minutes: 600 };
const toLocal = (iso: string) => iso.slice(0, 10);

/** A seeded random number, so every run builds the same account. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

async function bigAccount() {
  const store = await Store.open(openNodeDb(), { userId: USER, deviceId: DEVICE, now: () => moment });
  const r = random(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const projects = Array.from({ length: 30 }, () => randomUUID());
  const priorities = ['critical', 'high', 'medium', 'low'];
  const day = (offset: number): LocalDate => addDays(today, offset);
  await store.transaction(async (tx) => {
    for (const [i, id] of projects.entries()) await tx.write('projects', id, { name: `Project ${i}`, sort_order: i, status: 'active' });
    for (let i = 0; i < 2000; i += 1) {
      const id = randomUUID();
      const done = i < 600;
      const repeating = i >= 600 && i < 750;
      await tx.write('tasks', id, {
        title: `Task number ${i} with a realistic length of title`,
        description: i % 5 === 0 ? 'Some notes about the task. '.repeat(8) : '',
        status: done ? 'completed' : 'not_started',
        priority: pick(priorities),
        project_id: r() < 0.7 ? pick(projects) : null,
        due_date: repeating ? day(-365) : r() < 0.8 ? day(Math.floor(r() * 120) - 60) : null,
        due_time: r() < 0.4 ? `${String(8 + Math.floor(r() * 12)).padStart(2, '0')}:00` : null,
        estimated_minutes: r() < 0.5 ? 15 * (1 + Math.floor(r() * 8)) : null,
        completed_at: done ? `${day(-Math.floor(r() * 60))}T09:00:00.000Z` : null,
        rrule: repeating ? (i % 3 === 0 ? 'FREQ=WEEKLY' : 'FREQ=DAILY') : null,
        sort_order: i,
      });
      if (repeating && i % 3 !== 0) {
        for (let d = -365; d < 0; d += 1) {
          if (r() < 0.8) await tx.write('task_occurrences', randomUUID(), { task_id: id, occurrence_date: day(d), status: 'completed', completed_at: `${day(d)}T09:00:00.000Z` });
        }
      }
      if (!done && r() < 0.3) await tx.write('reminders', randomUUID(), { task_id: id, kind: 'offset', offset_minutes: 30, is_active: true });
    }
    for (let h = 0; h < 8; h += 1) {
      const habit = randomUUID();
      await tx.write('habits', habit, { title: `Habit ${h}`, schedule: h % 2 ? 'daily' : 'week:3', target: h % 3 ? 1 : 8, status: 'active', reminder_time: '10:00' });
      for (let d = -365; d <= 0; d += 1) {
        const n = h % 3 ? (r() < 0.7 ? 1 : 0) : Math.floor(r() * 9);
        for (let k = 0; k < n; k += 1) await tx.write('habit_logs', randomUUID(), { habit_id: habit, log_date: day(d), amount: 1, logged_at: `${day(d)}T08:00:00.000Z` });
      }
    }
    for (let s = 0; s < 600; s += 1) {
      await tx.write('focus_sessions', randomUUID(), { kind: 'focus', started_at: `${day(-Math.floor(s / 4))}T09:00:00.000Z`, planned_minutes: 25, device_id: DEVICE });
    }
  });
  return store;
}

function time(fn: () => unknown, runs = 5): number {
  const t: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const start = performance.now();
    fn();
    t.push(performance.now() - start);
  }
  return t.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

jest.setTimeout(120_000);

it('a large account stays fast', async () => {
  const store = await bigAccount();
  let start = performance.now();
  const data = await loadSnapshot(store);
  const firstLoad = performance.now() - start;
  // Tick one task, then reload: only the tasks table is read again.
  const one = data.tasks.find((t) => t.status === 'not_started')!;
  await store.transaction((tx) => tx.write('tasks', one.id, { status: 'completed', completed_at: moment.toISOString() }));
  start = performance.now();
  await loadSnapshot(store);
  const reload = performance.now() - start;
  const nowMs = moment.getTime();
  const counts = {
    tasks: data.tasks.length,
    occurrences: [...data.occurrences.values()].reduce((n, l) => n + l.length, 0),
    habitLogs: [...data.habitLogs.values()].reduce((n, l) => n + l.length, 0),
  };

  // Budgets in milliseconds (this machine), each several times what was measured.
  const results: [string, number, number][] = [
    ['first load from the database', firstLoad, 4000],
    ['reload after ticking a task', reload, 1000],
    ['every task item (allItems)', time(() => allItems(data, now)), 400],
    ['Today screen', time(() => todayView(data, now, toLocal)), 400],
    ['Upcoming, 7 days', time(() => upcomingView(data, now, addDays(today, 1), addDays(today, 7))), 400],
    ['Plan my day', time(() => dayPlan(data, now, toLocal)), 600],
    ['Weekly review', time(() => weekReview(data, now, toLocal)), 800],
    ['Eisenhower matrix', time(() => matrixOf(data, now)), 400],
    ['Analytics: completion rate, 30 days', time(() => completionRate(data, addDays(today, -29), today)), 400],
    ['Analytics: done per day, 30 days', time(() => donePerDay(data, addDays(today, -29), today, toLocal)), 400],
    ['Analytics: focus totals', time(() => focusTotals(data.focusSessions, addDays(today, -29), today, nowMs, toLocal)), 100],
    ['Habit streaks (8 habits, a year each)', time(() => data.habits.forEach((h) => streakOf(h, data.habitLogs.get(h.id) ?? [], today))), 400],
    ['Notification plan, 30 days', time(() => planAlarms(data, { now, nowMs, summaries: { morning: '08:00', evening: '20:00' }, hour12: false, deviceId: DEVICE })), 1500],
    ['Widget data', time(() => widgetData(data, { now, nowMs, toLocal, hour12: false })), 600],
  ];

  if (process.env.PERF) {
    console.log(
      [`Large account: ${counts.tasks} tasks, ${counts.occurrences} occurrence records, ${counts.habitLogs} habit logs`]
        .concat(results.map(([name, ms, budget]) => `${name.padEnd(40)} ${ms.toFixed(1).padStart(8)} ms   (budget ${budget})`))
        .join('\n'),
    );
  }
  expect(counts.tasks).toBe(2000);
  for (const [name, ms, budget] of results) expect([name, ms <= budget]).toEqual([name, true]);
});
