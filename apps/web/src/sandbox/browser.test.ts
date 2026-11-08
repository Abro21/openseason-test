// @vitest-environment node
// The in-browser sandbox runs the real migrations and seed in PGlite. These
// tests drive it through the same transport the app uses.
import { ApiError, OpenSeasonClient } from '@openseason/api-client';
import { TEAMS } from '@openseason/db/src/seed-ids.js';
import { SANDBOX_STAFF_NOTE } from '@openseason/sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openSandbox, type BrowserSandbox } from './browser';

let sb: BrowserSandbox;
beforeAll(async () => { sb = await openSandbox({ dataDir: 'memory://' }); }, 60_000);
afterAll(async () => { await sb.close(); });

const as = (persona: string | null) => {
  const token = persona ? sb.tokenFor(persona) : null;
  return new OpenSeasonClient(sb.transport(() => token));
};

describe('in-browser sandbox', () => {
  it('lists the synthetic people and refuses unknown or missing sessions', async () => {
    expect(sb.personas().map((p) => p.id)).toContain('pat');
    expect(() => sb.tokenFor('root')).toThrow();
    await expect(as(null).rpc('my_contexts')).rejects.toMatchObject({ kind: 'unauthenticated' });
    await expect(new OpenSeasonClient(sb.transport(() => 'sandbox:00000000-0000-4000-8000-000000000999')).rpc('my_contexts'))
      .rejects.toBeInstanceOf(ApiError);
  });

  it('applies row-level security per person', async () => {
    const pat = await as('pat').contexts();
    expect(pat.family.map((f) => f.label).sort()).toEqual(['Leo L.', 'Mia L.']);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 86400e3).toISOString();
    await expect(as('quinn').rpc('team_schedule', { p_team: TEAMS.u12Blue, p_from: from, p_to: to })).rejects.toMatchObject({ kind: 'forbidden', code: '42501' });
  });

  it('pays an installment through the sandbox checkout', async () => {
    const pat = as('pat');
    const fees = await pat.rpc<any[]>('my_fees');
    const inst = fees[0].installments.find((i: any) => i.status !== 'paid');
    const start = await pat.rpc<any>('payment_start', { p_installment: inst.id, p_idempotency_key: 'sandbox-test-pay-1' });
    expect(start.checkout_url).toBe(`#sandbox-checkout/${start.provider_ref}`);
    expect((await sb.checkout(start.provider_ref))?.status).toBe('pending');
    await sb.completeCheckout(start.provider_ref, 'succeeded');
    const after = (await as('pat').rpc<any[]>('my_fees')).find((f) => f.invoice_id === fees[0].invoice_id);
    expect(after.paid_cents).toBe(fees[0].paid_cents + inst.amount_cents);
  });

  it('runs staff work end to end: prepare, propose, approve, send once through the sandbox', async () => {
    const casey = as('casey');
    const work = await casey.rpc<string>('staff_prepare', { p_kind: 'announcement', p_target: { team_id: TEAMS.u12Blue }, p_thread: null });
    const action = await casey.rpc<string>('prepared_work_propose', { p_id: work });
    const a = await casey.rpc<any>('action_get', { p_id: action });
    await casey.approve(action, a.revision, a.payload_hash, 'sandbox-test-approve-1');
    await sb.runWorkers();
    expect((await as('casey').rpc<any>('action_get', { p_id: action })).status).toBe('succeeded');

    const thread = await casey.rpc<string>('staff_thread_open', { p_role: 'practice_prep', p_context: { team_id: TEAMS.u12Blue }, p_title: 'Thursday' });
    await casey.rpc('staff_message_post', { p_thread: thread, p_body: 'Help me plan Thursday', p_input_mode: 'typed' });
    await sb.runWorkers();
    const page = await as('casey').rpc<any>('staff_thread_messages', { p_thread: thread, p_before: null, p_limit: 10 });
    expect(page.messages.find((m: any) => m.author === 'staff').body).toContain(SANDBOX_STAFF_NOTE);
  });
});
