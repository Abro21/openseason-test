import {
  checkArgs, Contexts, Fee, isRpcName, PreparedWork, ScheduleEvent, SERVER_ONLY_RPCS, StaffRoom, StaffThreadPage,
  type RpcName,
} from '@openseason/contracts';
import { z } from 'zod';
import { ScopedCache } from './cache.js';
import { ApiError } from './errors.js';
import type { Transport } from './transport.js';

type Args = Record<string, unknown>;

/** Reads that are safe to cache briefly; every write clears the cache. */
const CACHEABLE = new Set<RpcName>(['my_contexts', 'team_schedule', 'team_roster', 'my_fees', 'my_forms', 'staff_room', 'my_entitlement']);

export class OpenSeasonClient {
  readonly cache = new ScopedCache();
  constructor(private readonly transport: Transport) {}

  /** Call any client-callable RPC by name. Unknown names and arguments are refused before they leave the device. */
  async rpc<T = unknown>(fn: string, args: Args = {}): Promise<T> {
    if (!isRpcName(fn)) throw new ApiError('invalid_request', `unknown function ${fn}`);
    if (SERVER_ONLY_RPCS.includes(fn)) throw new ApiError('forbidden', `${fn} can only run on the server`);
    const bad = checkArgs(fn, args);
    if (bad) throw new ApiError('invalid_request', bad);

    const key = CACHEABLE.has(fn) ? `${fn}:${JSON.stringify(args)}` : null;
    if (key) {
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit as T;
    }
    const out = await this.transport.call(fn, args);
    if (key) this.cache.set(key, out);
    else this.cache.invalidate();
    return out as T;
  }

  /** Signed in as someone else, or switched context: forget everything cached. */
  setScope(personId: string | null, contextKey: string | null) {
    this.cache.setScope(personId, contextKey);
  }

  signOut() {
    this.cache.clear();
  }

  private async parsed<S extends z.ZodTypeAny>(schema: S, fn: RpcName, args: Args = {}): Promise<z.infer<S>> {
    const raw = await this.rpc(fn, args);
    const r = schema.safeParse(raw);
    if (!r.success) throw new ApiError('unknown', `unexpected response from ${fn}: ${r.error.issues[0]?.message ?? 'invalid'}`);
    return r.data;
  }

  contexts() { return this.parsed(Contexts, 'my_contexts'); }
  teamSchedule(team: string, from: Date, to: Date) {
    return this.parsed(z.array(ScheduleEvent), 'team_schedule', { p_team: team, p_from: from.toISOString(), p_to: to.toISOString() });
  }
  rsvp(event: string, athlete: string, status: 'yes' | 'no' | 'maybe') {
    return this.rpc('rsvp_set', { p_event: event, p_athlete: athlete, p_status: status });
  }
  myFees() { return this.parsed(z.array(Fee), 'my_fees'); }
  staffRoom() { return this.parsed(StaffRoom, 'staff_room'); }
  preparedWork(id: string) { return this.parsed(PreparedWork, 'prepared_work_get', { p_id: id }); }
  staffThread(thread: string, before?: string, limit = 30) {
    return this.parsed(StaffThreadPage, 'staff_thread_messages', { p_thread: thread, p_before: before ?? null, p_limit: limit });
  }
  /** Approves exactly the revision and payload the person looked at. */
  approve(id: string, revision: number, hash: string, approvalKey: string) {
    return this.rpc('action_approve', { p_id: id, p_expected_revision: revision, p_expected_hash: hash, p_approval_key: approvalKey });
  }
  approveBatch(items: { id: string; revision: number; hash: string }[], batchKey: string) {
    return this.rpc<{ results: { id: string; ok: boolean; error?: string }[] }>('actions_approve_batch', { p_items: items, p_batch_key: batchKey });
  }
  reject(id: string, reason: string) { return this.rpc('action_reject', { p_id: id, p_reason: reason }); }
}

/** A fresh idempotency key for one deliberate press of a button. */
export function idempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!c?.randomUUID) throw new Error('crypto.randomUUID is required for idempotency keys');
  return c.randomUUID();
}
