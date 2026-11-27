/**
 * The sync engine: sends this device's waiting edits, then brings in every
 * change made elsewhere since the last time.
 *
 *   1. push  the outbox, oldest first, in batches, through sync_push. The
 *            server merges each edit field by field by its timestamp. Every
 *            edit it answers for (applied, stale, missing or rejected) leaves
 *            the outbox; rejected ones are kept in a short problem list.
 *   2. pull  through sync_pull, page by page, from the last revision seen.
 *            When the server says this device is too far behind (or ahead,
 *            after a database restore), it drops its copy and pulls it all.
 *   3. groups through sync_pull_groups, each group from its own revision
 *            (group rows are numbered per group, not per account). Groups
 *            the account is no longer in are dropped from the device, and
 *            open invitations are kept so the Groups screen can show them.
 *
 * Pushing first means a pull never brings back a row whose edit from here
 * was refused for being older: the outbox no longer holds that edit, so the
 * row simply becomes the server's.
 *
 * The transport is passed in, so tests can run this against real Postgres.
 */
import { GROUP_TABLES, type TableName } from './schema';
import type { OutboxOp, RemoteChanges, RemoteRow, Store } from './store';

export type PushStatus = 'applied' | 'stale' | 'missing' | 'rejected';

export type PushOp = {
  op_id: string;
  table: string;
  id: string;
  kind: OutboxOp['kind'];
  patch: Record<string, unknown>;
  ts: string;
};

export type PushReply = { results: { op_id?: string | null; status: PushStatus; error?: string }[]; rev: number };

export type PullReply =
  | { reset: true; rev: number }
  | { reset: false; changes: RemoteChanges; next_since: number; rev: number; has_more: boolean };

export type GroupPage =
  | { id: string; reset: true; rev: number }
  | { id: string; reset: false; changes: RemoteChanges; next_since: number; rev: number; has_more: boolean };

export type GroupPullReply = {
  pages: GroupPage[];
  /** Every group the account is an active member of. */
  member_of: string[];
  /** Open invitations: the group rows and the account's own (invited) membership rows. */
  invites: { groups: RemoteRow[]; group_members: RemoteRow[] };
};

export interface SyncTransport {
  push(deviceId: string, ops: PushOp[]): Promise<PushReply>;
  pull(since: number, limit: number): Promise<PullReply>;
  pullGroups(cursors: Record<string, number>, limit: number): Promise<GroupPullReply>;
}

export type SyncProblem = { at: string; table: string; id: string; error: string };

export type SyncReport = {
  pushed: number;
  rejected: number;
  pulled: number;
  /** The server's revision for this account after the sync. */
  rev: number;
  /** Everything was dropped and pulled again. */
  reset: boolean;
};

export const PULL_SINCE_KEY = 'pull_since';
/** { "<group id>": last revision pulled } */
export const GROUP_CURSORS_KEY = 'group_cursors';
export const PROBLEMS_KEY = 'sync_problems';
const MAX_PROBLEMS = 20;

export class SyncEngine {
  constructor(
    private readonly store: Store,
    private readonly transport: SyncTransport,
    private readonly opts: { deviceId: string; pushBatch?: number; pullLimit?: number; now?: () => Date },
  ) {}

  async run(): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, rejected: 0, pulled: 0, rev: 0, reset: false };
    await this.push(report);

    let since = Number((await this.store.getMeta(PULL_SINCE_KEY)) ?? 0) || 0;
    for (let page = 0; page < 1000; page += 1) {
      const reply = await this.transport.pull(since, this.opts.pullLimit ?? 1000);
      report.rev = reply.rev;
      if (reply.reset) {
        if (report.reset) throw new Error('The server asked to start over twice in one sync.');
        report.reset = true;
        // Send anything still waiting first, so a fresh copy cannot lose it.
        await this.push(report);
        await this.store.clearSynced();
        await this.store.setMeta(PULL_SINCE_KEY, '0');
        since = 0;
        continue;
      }
      report.pulled += await this.store.applyRemote(reply.changes);
      since = reply.next_since;
      await this.store.setMeta(PULL_SINCE_KEY, String(since));
      if (!reply.has_more) break;
    }
    await this.pullGroups(report);
    return report;
  }

  /** Groups whose copy here is known to be wrong (the server refused an edit in it). */
  private readonly refetch = new Set<string>();

  private async pullGroups(report: SyncReport): Promise<void> {
    let cursors: Record<string, number> = {};
    if (!report.reset) {
      try {
        const raw = JSON.parse((await this.store.getMeta(GROUP_CURSORS_KEY)) ?? '{}') as unknown;
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'number') cursors[k] = v;
        }
      } catch {
        cursors = {};
      }
    }
    for (const id of this.refetch) {
      await this.store.dropGroup(id);
      delete cursors[id];
    }
    this.refetch.clear();

    const resets = new Map<string, number>();
    for (let round = 0; round < 1000; round += 1) {
      const reply = await this.transport.pullGroups(cursors, this.opts.pullLimit ?? 1000);
      const member = new Set(reply.member_of ?? []);
      const invites = reply.invites ?? { groups: [], group_members: [] };
      const invited = new Set((invites.groups ?? []).map((g) => g.id));

      if (round === 0) {
        for (const id of await this.store.localGroupIds()) {
          if (!member.has(id) && !invited.has(id)) await this.store.dropGroup(id);
        }
        for (const id of Object.keys(cursors)) if (!member.has(id)) delete cursors[id];
        if (invited.size) {
          report.pulled += await this.store.applyRemote({ groups: invites.groups, group_members: invites.group_members });
        }
      }

      let more = false;
      for (const page of reply.pages ?? []) {
        if (page.reset) {
          const n = (resets.get(page.id) ?? 0) + 1;
          resets.set(page.id, n);
          if (n > 1) throw new Error('The server asked to start a group over twice in one sync.');
          await this.store.dropGroup(page.id);
          cursors[page.id] = 0;
          more = true;
          continue;
        }
        report.pulled += await this.store.applyRemote(page.changes);
        cursors[page.id] = page.next_since;
        if (page.has_more) more = true;
      }
      await this.store.setMeta(GROUP_CURSORS_KEY, JSON.stringify(cursors));
      if (!more) return;
    }
  }

  /**
   * After the server refused an edit to a row in a group: a refused move into
   * a group leaves the task personal here too; anything else means this
   * device's copy of the group is off, so the group is pulled again.
   */
  private async afterRejection(op: OutboxOp): Promise<void> {
    if (!GROUP_TABLES.includes(op.table as TableName)) return;
    const groupId = await this.store.groupIdOf(op.table, op.id);
    if (!groupId) return;
    if (op.table === 'tasks' && 'group_id' in op.patch) {
      await this.store.correct('tasks', op.id, { group_id: null, owner_id: null, is_private: false });
      return;
    }
    this.refetch.add(groupId);
  }

  private async push(report: SyncReport): Promise<void> {
    const batch = this.opts.pushBatch ?? 200;
    for (;;) {
      const ops = await this.store.pendingOps(batch);
      if (ops.length === 0) return;
      const reply = await this.transport.push(
        this.opts.deviceId,
        ops.map((o) => ({ op_id: o.op_id, table: o.table, id: o.id, kind: o.kind, patch: o.patch, ts: o.ts })),
      );
      report.rev = reply.rev;

      const byId = new Map(ops.map((o) => [o.op_id, o]));
      const done: number[] = [];
      const problems: SyncProblem[] = [];
      for (const r of reply.results ?? []) {
        const op = r.op_id ? byId.get(r.op_id) : undefined;
        if (!op) continue;
        done.push(op.seq);
        if (r.status === 'rejected') {
          problems.push({ at: (this.opts.now ?? (() => new Date()))().toISOString(), table: op.table, id: op.id, error: r.error ?? 'Refused' });
          await this.afterRejection(op);
        }
      }
      if (done.length === 0) throw new Error('The server did not answer for any of the changes sent.');
      await this.store.acknowledge(done);
      report.pushed += done.length;
      report.rejected += problems.length;
      if (problems.length) await this.addProblems(problems);
      // Ops the server did not answer for stay queued; stop rather than resend forever.
      if (done.length < ops.length) throw new Error('The server answered for only some of the changes sent.');
    }
  }

  private async addProblems(problems: SyncProblem[]): Promise<void> {
    const saved = await readProblems(this.store);
    await this.store.setMeta(PROBLEMS_KEY, JSON.stringify([...problems, ...saved].slice(0, MAX_PROBLEMS)));
  }
}

/** Edits the server refused, newest first (kept so the user can be told). */
export async function readProblems(store: Store): Promise<SyncProblem[]> {
  try {
    const raw = await store.getMeta(PROBLEMS_KEY);
    return raw ? (JSON.parse(raw) as SyncProblem[]) : [];
  } catch {
    return [];
  }
}
