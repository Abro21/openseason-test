import { afterAll, describe, expect, it } from 'vitest';
import { AUTH, ATHLETES, EVENTS, INVOICES, ORGS, PEOPLE, TEAMS } from '../src/seed-ids.js';
import { connect, endPool, tx, type Tx } from './harness.js';

afterAll(endPool);

const key = (s: string) => `approval-${s}-${'x'.repeat(16)}`.slice(0, 60);

async function prepareAnnouncement(t: Tx) {
  await t.as('casey', { agent: true });
  const work = await t.rpc('staff_prepare', { p_kind: 'announcement', p_target: { team_id: TEAMS.u12Blue } });
  const action = await t.rpc('prepared_work_propose', { p_id: work });
  await t.as('casey');
  const a = await t.rpc('action_get', { p_id: action });
  return { work, action, a };
}

async function runWorker(t: Tx) {
  await t.asService();
  return t.rpc('process_queued_actions', { p_limit: 20 }, 'app');
}

async function teamMessagesFromAction(t: Tx, action: string) {
  await t.asAdmin();
  return t.sql('select id, body from public.messages where source_action_id = $1', [action]);
}

describe('staff preparation', () => {
  it('lets the staff runtime prepare work only with an active staff plan', () =>
    tx(async (t) => {
      await t.as('jordan', { agent: true });
      expect(await t.fails('staff_prepare', { p_kind: 'practice_plan', p_target: { team_id: TEAMS.u15Red } })).toMatch(/not active on your plan/);
      // The free tools still work for the person.
      await t.as('jordan');
      await t.rpc('team_schedule', { p_team: TEAMS.u15Red, p_from: new Date(), p_to: new Date(Date.now() + 864e6) });
    }));

  it('prepares only from what the person may see', () =>
    tx(async (t) => {
      await t.as('casey', { agent: true });
      expect(await t.fails('staff_prepare', { p_kind: 'practice_plan', p_target: { team_id: TEAMS.u15Red } })).toMatch(/not allowed/);
      expect(await t.fails('staff_prepare', { p_kind: 'fee_reminder', p_target: { org_id: ORGS.frontRange } })).toMatch(/not allowed/);
    }));

  it('keeps prepared work durable, deduplicated and private to its owner', () =>
    tx(async (t) => {
      await t.as('casey', { agent: true });
      const a = await t.rpc('staff_prepare', { p_kind: 'practice_plan', p_target: { team_id: TEAMS.u12Blue } });
      const b = await t.rpc('staff_prepare', { p_kind: 'practice_plan', p_target: { team_id: TEAMS.u12Blue } });
      expect(b).toBe(a);
      await t.as('casey');
      const room = await t.rpc('staff_room');
      expect(room.work.map((w: any) => w.role_id)).toEqual(['practice_prep']);
      expect(await t.fails('prepared_work_propose', { p_id: a })).toMatch(/saved from the planner/);
      await t.as('dana');
      expect(await t.rpc('prepared_work_get', { p_id: a })).toBeNull();
    }));

  it('saves a prepared practice plan through the normal planner', () =>
    tx(async (t) => {
      await t.as('casey', { agent: true });
      const w = await t.rpc('staff_prepare', { p_kind: 'practice_plan', p_target: { team_id: TEAMS.u12Blue, focus: 'Passing' } });
      await t.as('casey');
      const work = await t.rpc('prepared_work_get', { p_id: w });
      const saved = await t.rpc('practice_plan_save', { p_plan: { ...work.artifact, source_prepared_work_id: w } });
      await t.rpc('prepared_work_mark_saved', { p_id: w, p_plan: saved.id });
      const plan = await t.rpc('practice_plan_get', { p_plan: saved.id });
      expect(plan.blocks).toHaveLength(5);
      expect(plan.focus).toBe('Passing');
      await t.as('alex');
      expect((await t.rpc('team_practice_plans', { p_team: TEAMS.u12Blue })).length).toBe(1);
    }));

  it('stores staff thread messages with honest status and pages older history', () =>
    tx(async (t) => {
      await t.as('casey');
      const th = await t.rpc('staff_thread_open', { p_role: 'practice_prep', p_context: { team_id: TEAMS.u12Blue } });
      for (let i = 0; i < 3; i++) await t.rpc('staff_message_post', { p_thread: th, p_body: `note ${i}`, p_input_mode: i === 2 ? 'dictated' : 'typed' });
      expect(await t.fails('staff_message_reply', { p_thread: th, p_body: 'fake staff reply', p_status: 'complete' })).toMatch(/only the staff runtime/);
      await t.as('casey', { agent: true });
      await t.rpc('staff_message_reply', { p_thread: th, p_body: 'Partial answer…', p_status: 'interrupted' });
      await t.as('casey');
      const page = await t.rpc('staff_thread_messages', { p_thread: th, p_limit: 2 });
      expect(page.messages).toHaveLength(2);
      expect(page.has_more).toBe(true);
      await t.as('pat');
      expect(await t.fails('staff_thread_messages', { p_thread: th })).toMatch(/not allowed/);
    }));
});

describe('approval', () => {
  it('never lets the staff runtime approve', () =>
    tx(async (t) => {
      const { action, a } = await prepareAnnouncement(t);
      await t.as('casey', { agent: true });
      expect(await t.fails('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('agent') })).toMatch(/needs a person/);
      expect(await t.fails('actions_approve_batch', { p_items: [{ id: action, revision: a.revision, hash: a.payload_hash }], p_batch_key: key('agent-batch') })).toMatch(/needs a person/);
    }));

  it('only the owner can approve their staff work', () =>
    tx(async (t) => {
      const { action, a } = await prepareAnnouncement(t);
      await t.as('alex');
      expect(await t.fails('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('alex') })).toMatch(/not allowed/);
    }));

  it('approves exactly what was reviewed, sends once, and labels the preparing role', () =>
    tx(async (t) => {
      const { action, a } = await prepareAnnouncement(t);
      expect(a.status).toBe('in_review');
      expect(a.summary.recipients).toEqual(expect.arrayContaining(['Pat Parent', 'Jordan Multi']));
      const r1 = await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('one') });
      const r2 = await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('one') });
      expect(r1).toEqual({ status: 'queued', replayed: false });
      expect(r2).toMatchObject({ replayed: true });
      expect(await t.fails('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('two') })).toMatch(/cannot be approved/);
      await runWorker(t);
      await runWorker(t);
      const msgs = await teamMessagesFromAction(t, action);
      expect(msgs).toHaveLength(1);
      await t.asAdmin();
      const [m] = await t.sql<{ prepared_by_role: string; sender_person_id: string }>('select prepared_by_role, sender_person_id from public.messages where source_action_id = $1', [action]);
      expect(m).toEqual({ prepared_by_role: 'admin', sender_person_id: PEOPLE.casey });
      await t.as('casey');
      expect((await t.rpc('action_get', { p_id: action })).status).toBe('succeeded');
    }));

  it('rejects approval of a stale revision or a changed payload', () =>
    tx(async (t) => {
      const { work, action, a } = await prepareAnnouncement(t);
      const w = await t.rpc('prepared_work_get', { p_id: work });
      // An edit (even by the staff runtime) creates a new revision and resets review.
      await t.as('casey', { agent: true });
      await t.rpc('prepared_work_update', { p_id: work, p_expected_revision: w.revision, p_artifact: { ...w.artifact, body: w.artifact.body + '\nBring water.' } });
      await t.as('casey');
      expect(await t.fails('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('stale') })).toMatch(/changed since you reviewed/);
      const fresh = await t.rpc('action_get', { p_id: action });
      expect(fresh.revision).toBe(a.revision + 1);
      expect(fresh.status_reason).toMatch(/edited/);
      await t.rpc('action_approve', { p_id: action, p_expected_revision: fresh.revision, p_expected_hash: fresh.payload_hash, p_approval_key: key('fresh') });
    }));

  it('lets recipients be removed but never added by editing', () =>
    tx(async (t) => {
      const { work } = await prepareAnnouncement(t);
      await t.as('casey');
      const w = await t.rpc('prepared_work_get', { p_id: work });
      const extra = [...w.artifact.recipients, { person_id: PEOPLE.olivia, name: 'Olivia Other' }];
      expect(await t.fails('prepared_work_update', { p_id: work, p_expected_revision: w.revision, p_artifact: { ...w.artifact, recipients: extra } })).toMatch(/removed but not added/);
      await t.rpc('prepared_work_update', { p_id: work, p_expected_revision: w.revision, p_artifact: { ...w.artifact, recipients: w.artifact.recipients.slice(1) } });
    }));

  it('marks work needing refresh when its sources change, and recovers on refresh', () =>
    tx(async (t) => {
      const { action, a } = await prepareAnnouncement(t);
      await t.as('casey');
      // The schedule changes after preparation.
      const [e] = await t.sql<{ starts_at: Date; ends_at: Date; version: number }>('select starts_at, ends_at, version from public.events where id = $1', [EVENTS.blueGame]);
      await t.rpc('event_update', { p_event: EVENTS.blueGame, p_expected_version: e!.version, p_starts: e!.starts_at, p_ends: e!.ends_at, p_location: 'Field 9' });
      const res = await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('src') });
      expect(res).toMatchObject({ status: 'needs_refresh', reason: expect.stringMatching(/changed since this was prepared/) });
      expect((await t.rpc('staff_room')).work[0].stale).toBe(true);
      expect(await t.rpc('action_refresh', { p_id: action })).toBe('ok');
      const fresh = await t.rpc('action_get', { p_id: action });
      expect(fresh.status).toBe('in_review');
    }));

  it('re-checks authority at execution: a grant revoked after approval stops the send', () =>
    tx(async (t) => {
      const { action, a } = await prepareAnnouncement(t);
      await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('revoke') });
      await t.asAdmin();
      await t.sql(`update public.team_staff set revoked_at = now() where person_id = $1 and team_id = $2`, [PEOPLE.casey, TEAMS.u12Blue]);
      const out = await runWorker(t);
      expect(out[0].result).toBe('needs_refresh');
      expect(await teamMessagesFromAction(t, action)).toEqual([]);
    }));

  it('re-checks the staff plan at execution for staff-prepared work', () =>
    tx(async (t) => {
      const { action, a } = await prepareAnnouncement(t);
      await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('plan') });
      await t.asAdmin();
      await t.sql(`update public.entitlements set status = 'canceled' where person_id = $1`, [PEOPLE.casey]);
      expect((await runWorker(t))[0].result).toBe('needs_refresh');
    }));

  it('never dispatches a rejected action; retry makes a new revision; end closes it', () =>
    tx(async (t) => {
      const { action } = await prepareAnnouncement(t);
      await t.rpc('action_reject', { p_id: action, p_reason: 'Too long' });
      expect(await runWorker(t)).toEqual([]);
      expect(await teamMessagesFromAction(t, action)).toEqual([]);
      await t.as('casey');
      const before = await t.rpc('action_get', { p_id: action });
      expect(before.status).toBe('rejected');
      await t.rpc('action_retry', { p_id: action });
      const after = await t.rpc('action_get', { p_id: action });
      expect(after.status).toBe('in_review');
      expect(after.revision).toBe(before.revision + 1);
      await t.rpc('action_reject', { p_id: action, p_reason: 'No' });
      await t.rpc('action_end', { p_id: action });
      expect((await t.rpc('action_get', { p_id: action })).status).toBe('ended');
      expect(await t.fails('action_retry', { p_id: action })).toMatch(/only rejected/);
    }));

  it('approves a batch item by item and reports partial failures', () =>
    tx(async (t) => {
      const one = await prepareAnnouncement(t);
      await t.as('casey', { agent: true });
      const w2 = await t.rpc('staff_prepare', { p_kind: 'attendance_reminder', p_target: { event_id: EVENTS.blueGame } });
      const a2 = await t.rpc('prepared_work_propose', { p_id: w2 });
      await t.as('casey');
      const two = await t.rpc('action_get', { p_id: a2 });
      const items = [
        { id: one.action, revision: one.a.revision, hash: one.a.payload_hash },
        { id: a2, revision: two.revision + 7, hash: two.payload_hash }, // reviewed an older revision
      ];
      const res = await t.rpc('actions_approve_batch', { p_items: items, p_batch_key: key('batch') });
      expect(res.results.map((r: any) => [r.id, r.ok])).toEqual([[one.action, true], [a2, false]]);
      expect(res.results[1].reason).toMatch(/changed since you reviewed/);
      const again = await t.rpc('actions_approve_batch', { p_items: items, p_batch_key: key('batch') });
      expect(again.replayed).toBe(true);
      await runWorker(t);
      expect(await teamMessagesFromAction(t, one.action)).toHaveLength(1);
    }));

  it('sends an attendance reminder privately to each family that has not replied', () =>
    tx(async (t) => {
      await t.as('casey', { agent: true });
      const w = await t.rpc('staff_prepare', { p_kind: 'attendance_reminder', p_target: { event_id: EVENTS.blueGame } });
      const action = await t.rpc('prepared_work_propose', { p_id: w });
      await t.as('casey');
      const a = await t.rpc('action_get', { p_id: action });
      expect(a.summary.recipients).toEqual(['Pat Parent']); // Jordan already replied for Ava; Noah is not active
      await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('rem') });
      await runWorker(t);
      await t.as('pat');
      const convs = await t.rpc('my_conversations', { p_search: null, p_archived: false });
      expect(JSON.stringify(convs)).toContain('Casey Coach');
    }));

  it('shares private player feedback only with that athlete’s guardians', () =>
    tx(async (t) => {
      await t.as('casey', { agent: true });
      const w = await t.rpc('staff_prepare', { p_kind: 'player_feedback', p_target: { team_id: TEAMS.u12Blue, athlete_id: ATHLETES.mia } });
      const action = await t.rpc('prepared_work_propose', { p_id: w });
      await t.as('casey');
      const a = await t.rpc('action_get', { p_id: action });
      expect(a.kind).toBe('share_player_feedback');
      expect(a.summary.recipients).toEqual(['Pat Parent']);
      await t.rpc('action_approve', { p_id: action, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('fb') });
      await runWorker(t);
      await t.as('jordan');
      expect(JSON.stringify(await t.rpc('my_conversations', { p_search: null, p_archived: false }))).not.toContain('Feedback for Mia');
    }));
});

describe('refunds through approval', () => {
  async function paidPayment(t: Tx) {
    await t.asAdmin();
    const [n] = await t.sql<{ id: string }>('select id from public.installments where invoice_id = $1 and seq = 1', [INVOICES.mia]);
    await t.as('pat');
    const p = await t.rpc('payment_start', { p_installment: n!.id, p_idempotency_key: 'refund-test-payment-001' });
    await t.asService();
    await t.rpc('payment_apply_provider_event', { p_provider: 'sandbox', p_event_id: 'evt_refund_test', p_provider_ref: p.provider_ref, p_outcome: 'succeeded' }, 'app');
    return p.payment_id as string;
  }

  it('refuses refunds above the refundable amount and records uncertain provider results honestly', () =>
    tx(async (t) => {
      const payment = await paidPayment(t);
      await t.as('dana');
      const tooMuch = await t.rpc('action_propose', { p_kind: 'refund', p_payload: { payment_id: payment, amount_cents: 99999, currency: 'USD' } });
      expect((await t.rpc('action_get', { p_id: tooMuch })).status).toBe('needs_refresh');
      const act = await t.rpc('action_propose', { p_kind: 'refund', p_payload: { payment_id: payment, amount_cents: 5000, currency: 'USD' } });
      const a = await t.rpc('action_get', { p_id: act });
      expect(a.summary.effect).toBe('Refund 50.00 USD to the original payment method');
      await t.as('casey');
      expect(await t.fails('action_approve', { p_id: act, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('casey-refund') })).toMatch(/not allowed/);
      await t.as('dana');
      await t.rpc('action_approve', { p_id: act, p_expected_revision: a.revision, p_expected_hash: a.payload_hash, p_approval_key: key('dana-refund') });
      expect((await runWorker(t))[0].result).toBe('processing');
      expect((await runWorker(t))).toEqual([]); // not re-run while processing
      await t.asAdmin();
      const [rf] = await t.sql<{ id: string }>('select id from public.refunds where action_id = $1', [act]);
      const outbox = await t.sql(`select * from public.outbox where topic = 'refund' and ref_id = $1`, [rf!.id]);
      expect(outbox).toHaveLength(1);
      await t.asService();
      await t.rpc('refund_apply_result', { p_refund: rf!.id, p_outcome: 'uncertain', p_provider_ref: null }, 'app');
      await t.as('dana');
      expect((await t.rpc('action_get', { p_id: act })).status).toBe('uncertain');
      // Reconciliation confirms the provider did process it.
      await t.asService();
      await t.rpc('refund_apply_result', { p_refund: rf!.id, p_outcome: 'succeeded', p_provider_ref: 'sbx_re_1' }, 'app');
      expect(await t.rpc('refund_apply_result', { p_refund: rf!.id, p_outcome: 'succeeded', p_provider_ref: 'sbx_re_1' }, 'app')).toBe('already_succeeded');
      await t.as('pat');
      const [fee] = await t.rpc('my_fees');
      expect(fee.paid_cents).toBe(10000);
      await t.as('dana');
      expect((await t.rpc('action_get', { p_id: act })).status).toBe('succeeded');
    }));
});

describe('concurrency (committed transactions)', () => {
  it('lets only one of two simultaneous approvals win, and two workers send once', async () => {
    const setup = await connect();
    const claims = (who: keyof typeof AUTH, agent = false) => JSON.stringify({ sub: AUTH[who], role: 'authenticated', ...(agent ? { os_actor: 'agent' } : {}) });
    let actionId = '';
    let workId = '';
    try {
      await setup.query('begin');
      await setup.query(`select set_config('request.jwt.claims', $1, true)`, [claims('casey', true)]);
      await setup.query('set local role authenticated');
      workId = (await setup.query(`select public.staff_prepare('announcement', $1::jsonb) id`, [JSON.stringify({ team_id: TEAMS.u12Blue })])).rows[0].id;
      actionId = (await setup.query('select public.prepared_work_propose($1) id', [workId])).rows[0].id;
      await setup.query('commit');
      const a = (await setup.query('select revision, payload_hash from public.pending_actions where id = $1', [actionId])).rows[0];

      const approve = async (k: string) => {
        const c = await connect();
        try {
          await c.query('begin');
          await c.query(`select set_config('request.jwt.claims', $1, true)`, [claims('casey')]);
          await c.query('set local role authenticated');
          const r = await c.query('select public.action_approve($1, $2, $3, $4) r', [actionId, a.revision, a.payload_hash, k]);
          await c.query('commit');
          return r.rows[0].r.status as string;
        } catch (e) {
          await c.query('rollback');
          return `error: ${(e as Error).message}`;
        } finally {
          c.release();
        }
      };
      const results = await Promise.all([approve(key('race-a')), approve(key('race-b'))]);
      expect(results.filter((r) => r === 'queued')).toHaveLength(1);
      expect(results.filter((r) => r.startsWith('error'))).toHaveLength(1);

      const work = async () => {
        const c = await connect();
        try {
          await c.query('begin');
          await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
          await c.query('set local role service_role');
          const r = await c.query('select app.execute_action($1) r', [actionId]);
          await c.query('commit');
          return r.rows[0].r as string;
        } finally {
          c.release();
        }
      };
      const outs = await Promise.all([work(), work()]);
      expect(outs.filter((o) => o === 'succeeded')).toHaveLength(1);
      const n = (await setup.query('select count(*)::int n from public.messages where source_action_id = $1', [actionId])).rows[0].n;
      expect(n).toBe(1);
    } finally {
      // Clean up the committed rows from this test only.
      await setup.query('reset role');
      await setup.query(`delete from public.deliveries where message_id in (select id from public.messages where source_action_id = $1)`, [actionId]);
      await setup.query(`delete from public.outbox where ref_id in (select id::text from public.messages where source_action_id = $1)`, [actionId]);
      await setup.query(`delete from public.messages where source_action_id = $1`, [actionId]);
      await setup.query(`delete from public.action_attempts where action_id = $1`, [actionId]);
      await setup.query(`delete from public.pending_actions where id = $1`, [actionId]);
      await setup.query(`delete from public.prepared_work where id = $1`, [workId]);
      setup.release();
    }
  });
});
