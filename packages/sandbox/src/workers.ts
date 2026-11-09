// Background work the hosted system would run as scheduled jobs. Every
// provider here is a sandbox: nothing is sent anywhere.
import { callFn, withIdentity, type TxRunner } from './identity.js';

export interface WorkerConfig {
  /** What the sandbox refund provider answers: lets you rehearse the uncertain/reconcile path. */
  refundOutcome: 'succeeded' | 'failed' | 'uncertain';
}

/** Executes approved actions whose turn has come (revalidated as the approver inside the database). */
export async function runQueuedActions(run: TxRunner, limit = 20): Promise<unknown> {
  return withIdentity(run, { kind: 'service' }, (c) => callFn(c, 'app', 'process_queued_actions', { p_limit: limit }));
}

/** Sandbox push/email/SMS: marks queued deliveries as sandbox_delivered. Never contacts anyone. */
export async function runDeliveries(run: TxRunner, limit = 100): Promise<number> {
  return withIdentity(run, { kind: 'service' }, async (c) => {
    const { rows } = await c.query<{ id: string; payload: { message_id: string; person_id: string; channel: string } }>(
      `select id, payload from public.outbox where topic = 'delivery' and status = 'pending' and available_at <= now()
       order by id limit $1 for update skip locked`, [limit]);
    for (const r of rows) {
      await c.query(`update public.deliveries set status = 'sandbox_delivered', updated_at = now()
                     where message_id = $1 and person_id = $2 and channel = $3 and status = 'queued'`,
        [r.payload.message_id, r.payload.person_id, r.payload.channel]);
      await c.query(`update public.outbox set status = 'done', attempts = attempts + 1, provider_ref = 'sandbox', updated_at = now() where id = $1`, [r.id]);
    }
    return rows.length;
  });
}

/** Sandbox refund provider. An uncertain answer leaves the refund for reconciliation, as a real timeout would. */
export async function runRefunds(run: TxRunner, cfg: WorkerConfig, limit = 20): Promise<number> {
  return withIdentity(run, { kind: 'service' }, async (c) => {
    const { rows } = await c.query<{ id: string; payload: { refund_id: string } }>(
      `select id, payload from public.outbox where topic = 'refund' and status = 'pending' order by id limit $1 for update skip locked`, [limit]);
    for (const r of rows) {
      const ref = cfg.refundOutcome === 'uncertain' ? null : `sbx_re_${r.payload.refund_id.slice(0, 8)}`;
      await callFn(c, 'app', 'refund_apply_result', { p_refund: r.payload.refund_id, p_outcome: cfg.refundOutcome, p_provider_ref: ref });
      await c.query(`update public.outbox set status = $2, attempts = attempts + 1, provider_ref = $3, updated_at = now() where id = $1`,
        [r.id, cfg.refundOutcome === 'uncertain' ? 'uncertain' : 'done', ref]);
    }
    return rows.length;
  });
}

export const SANDBOX_STAFF_NOTE =
  'Sandbox staff reply. No AI provider is configured in this environment, so this is a fixed response, not a real answer.';

/**
 * Deterministic stand-in for the staff runtime: answers each unanswered
 * person message with a clearly labelled fixed reply, acting as the agent
 * for that thread's owner (so every database check still applies).
 */
export async function runSandboxStaff(run: TxRunner, limit = 20): Promise<number> {
  const pending = await withIdentity(run, { kind: 'service' }, async (c) => (await c.query<{ thread_id: string; sub: string; body: string }>(
    `select distinct on (m.thread_id) m.thread_id, p.auth_user_id as sub, m.body
     from public.staff_messages m join public.staff_threads t on t.id = m.thread_id join public.people p on p.id = t.owner_person_id
     where p.auth_user_id is not null
     order by m.thread_id, m.created_at desc`)).rows);
  let n = 0;
  for (const row of pending) {
    if (n >= limit) break;
    const last = await withIdentity(run, { kind: 'service' }, async (c) =>
      (await c.query<{ author: string }>(`select author from public.staff_messages where thread_id = $1 order by created_at desc limit 1`, [row.thread_id])).rows[0]);
    if (last?.author !== 'person') continue;
    const body = `${SANDBOX_STAFF_NOTE}\n\nYou wrote: "${row.body.slice(0, 200)}". Staff drafts appear on the task they belong to (Payments, Compliance, Schedule, Messages) for you to review.`;
    try {
      await withIdentity(run, { kind: 'person', sub: row.sub, agent: true }, (c) =>
        callFn(c, 'public', 'staff_message_reply', { p_thread: row.thread_id, p_body: body, p_status: 'complete' }));
      n++;
    } catch {
      // e.g. the owner's staff entitlement lapsed: the database refused, so nothing is written.
    }
  }
  return n;
}

/**
 * Staff routine pass: for each person with an active staff plan, in each club
 * they belong to, staff look for work and prepare drafts, acting as the agent
 * for that person (so every database permission check still applies). The
 * database runs it at most once an hour per club and person. Drafts only:
 * nothing is sent until the person approves it.
 */
export async function runStaffRoutines(run: TxRunner): Promise<number> {
  const people = await withIdentity(run, { kind: 'service' }, async (c) => (await c.query<{ sub: string }>(
    `select p.auth_user_id as sub from public.people p where p.auth_user_id is not null and app.staff_entitled(p.id)`)).rows);
  let n = 0;
  for (const { sub } of people) {
    try {
      n += await withIdentity(run, { kind: 'person', sub, agent: true }, async (c) => {
        const t = await callFn(c, 'public', 'my_tenants', {}) as { tenants: { id: string }[] };
        let made = 0;
        for (const x of t.tenants) made += Number(await callFn(c, 'public', 'staff_run_triggers', { p_tenant: x.id }));
        return made;
      });
    } catch {
      // e.g. the plan lapsed between the two reads: the database refused, so nothing is written.
    }
  }
  return n;
}
