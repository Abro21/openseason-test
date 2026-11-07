// End-to-end through HTTP against the local database. These calls commit, so
// run after `pnpm db:reset` (the test:db script does).
import { TEAMS } from '@openseason/db';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmac } from '../src/crypto.js';
import { createGateway } from '../src/server.js';
import { runDeliveries, runQueuedActions, runSandboxStaff, SANDBOX_STAFF_NOTE } from '../src/workers.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/openseason_local' });
const server = createGateway({ pool, jwtSecret: 'test-jwt', webhookSecret: 'test-hook', publicUrl: 'http://gw', allowedOrigins: [] });
let base = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
});

async function signIn(persona: string): Promise<string> {
  const r = await fetch(`${base}/auth/dev-sign-in`, { method: 'POST', body: JSON.stringify({ persona, os_actor: 'agent' }) });
  return ((await r.json()) as { data: { token: string } }).data.token;
}
async function rpc(token: string | null, fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${base}/rpc/${fn}`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(args) });
  return { status: r.status, ...((await r.json()) as { data?: any; error?: { code: string | null; message: string } }) };
}

describe('dev gateway', () => {
  it('requires sign-in, refuses server-only functions and unknown arguments, and never mints the agent claim', async () => {
    expect((await rpc(null, 'my_contexts')).status).toBe(401);
    expect((await rpc('forged.token.value', 'my_contexts')).status).toBe(401);
    const pat = await signIn('pat');
    const payload = JSON.parse(Buffer.from(pat.split('.')[1]!, 'base64url').toString());
    expect(payload.os_actor).toBeUndefined();
    expect((await rpc(pat, 'staff_message_reply', { p_thread: '00000000-0000-4000-8000-000000000000', p_body: 'x', p_status: 'complete' })).status).toBe(404);
    expect((await rpc(pat, 'my_fees', { p_person: 'someone-else' })).status).toBe(400);
    expect((await fetch(`${base}/auth/dev-sign-in`, { method: 'POST', body: JSON.stringify({ persona: 'root' }) })).status).toBe(400);
  });

  it('applies database authorization per request', async () => {
    const quinn = await signIn('quinn');
    const r = await rpc(quinn, 'team_schedule', { p_team: TEAMS.u12Blue, p_from: new Date().toISOString(), p_to: new Date(Date.now() + 86400e3).toISOString() });
    expect(r.status).toBe(403);
    expect(r.error?.code).toBe('42501');
  });

  it('pays an installment through the sandbox checkout and ignores a replayed webhook', async () => {
    const pat = await signIn('pat');
    const fees = (await rpc(pat, 'my_fees')).data as any[];
    const inst = fees[0].installments.find((i: any) => i.status !== 'paid');
    const start = await rpc(pat, 'payment_start', { p_installment: inst.id, p_idempotency_key: 'gateway-test-pay-0001' });
    expect(start.data.checkout_url).toBe(`http://gw/sandbox/checkout/${start.data.provider_ref}`);
    const page = await fetch(`${base}/sandbox/checkout/${start.data.provider_ref}`);
    expect(await page.text()).toMatch(/No card is collected/);

    const raw = JSON.stringify({ event_id: 'evt_gateway_test_1', provider_ref: start.data.provider_ref, outcome: 'succeeded' });
    const hook = (sig: string) => fetch(`${base}/webhooks/sandbox`, { method: 'POST', headers: { 'x-sandbox-signature': sig }, body: raw });
    expect((await hook(hmac('wrong', raw).toString('hex'))).status).toBe(401);
    const ok = (await (await hook(hmac('test-hook', raw).toString('hex'))).json()) as { data: string };
    const again = (await (await hook(hmac('test-hook', raw).toString('hex'))).json()) as { data: string };
    expect(again.data).not.toBe(ok.data);

    const after = ((await rpc(pat, 'my_fees')).data as any[]).find((f) => f.invoice_id === fees[0].invoice_id);
    expect(after.paid_cents).toBe(fees[0].paid_cents + inst.amount_cents);
    expect(after.receipts.some((x: any) => x.status === 'succeeded')).toBe(true);
  });

  it('delivers announcements only through the sandbox, and the sandbox staff reply says what it is', async () => {
    const casey = await signIn('casey');
    expect((await rpc(casey, 'announcement_post', { p_team: TEAMS.u12Blue, p_title: 'Field change', p_body: 'Practice moves to Field 2.', p_emergency: false, p_reason: null })).status).toBe(200);
    await runQueuedActions(pool);
    expect(await runDeliveries(pool)).toBeGreaterThan(0);
    const { rows } = await pool.query(`select count(*)::int n from public.deliveries where status = 'delivered' and channel <> 'in_app'`);
    expect(rows[0].n).toBe(0);

    const thread = (await rpc(casey, 'staff_thread_open', { p_role: 'practice_prep', p_context: { team_id: TEAMS.u12Blue }, p_title: 'Thursday' })).data;
    await rpc(casey, 'staff_message_post', { p_thread: thread, p_body: 'Help me plan Thursday', p_input_mode: 'typed' });
    expect(await runSandboxStaff(pool)).toBeGreaterThan(0);
    const page = (await rpc(casey, 'staff_thread_messages', { p_thread: thread, p_before: null, p_limit: 10 })).data;
    expect(page.messages.find((m: any) => m.author === 'staff').body).toContain(SANDBOX_STAFF_NOTE);
  });
});
