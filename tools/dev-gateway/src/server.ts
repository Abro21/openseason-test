import { checkArgs, isRpcName, SERVER_ONLY_RPCS } from '@openseason/contracts';
import { AUTH, PERSONA_LABELS, type Persona } from '@openseason/db';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type pg from 'pg';
import { hmac, signJwt, verifyJwt, verifyWebhook } from './crypto.js';
import { callFn, withIdentity } from './db.js';

export interface GatewayConfig {
  pool: pg.Pool;
  jwtSecret: string;
  webhookSecret: string;
  /** Where browsers reach this gateway, used to build sandbox checkout links. */
  publicUrl: string;
  /** Origins allowed to call from a browser (the web app in dev). */
  allowedOrigins: string[];
}

const STATUS: Record<string, number> = { '28000': 401, '42501': 403, '40001': 409, '53400': 429, '55000': 409, P0001: 400, '22023': 400, '22P02': 400 };

type Json = Record<string, unknown>;

function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
}

async function readBody(req: http.IncomingMessage, max = 256 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function pgError(e: unknown): { status: number; error: { code: string | null; message: string } } {
  const err = e as { code?: string; message?: string; status?: number };
  if (err.status) return { status: err.status, error: { code: null, message: err.message ?? 'error' } };
  const code = err.code ?? null;
  if (code && STATUS[code]) return { status: STATUS[code]!, error: { code, message: err.message ?? 'error' } };
  // Unknown database failures are not echoed to clients.
  console.error('[gateway] unexpected error', err.message);
  return { status: 500, error: { code: null, message: 'Something went wrong on the server.' } };
}

export function createGateway(cfg: GatewayConfig): http.Server {
  const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

  async function applyWebhook(raw: string, signature: string | undefined) {
    if (!verifyWebhook(raw, signature, cfg.webhookSecret)) return { status: 401, body: { error: { code: null, message: 'bad signature' } } };
    const ev = JSON.parse(raw) as { event_id: string; provider_ref: string; outcome: string };
    const result = await withIdentity(cfg.pool, { kind: 'service' }, (c) => callFn(c, 'app', 'payment_apply_provider_event', {
      p_provider: 'sandbox', p_event_id: ev.event_id, p_provider_ref: ev.provider_ref, p_outcome: ev.outcome,
    }));
    return { status: 200, body: { data: result } };
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const origin = req.headers.origin;
    if (origin && cfg.allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST');
    }
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');

    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { data: { ok: true, sandbox: true } });

      // Synthetic personas only. There is no password: this exists for local demos and tests.
      if (req.method === 'GET' && url.pathname === '/auth/personas') {
        return send(res, 200, { data: Object.entries(PERSONA_LABELS).map(([id, label]) => ({ id, label })) });
      }
      if (req.method === 'POST' && url.pathname === '/auth/dev-sign-in') {
        const { persona } = JSON.parse(await readBody(req)) as { persona?: string };
        if (!persona || !Object.prototype.hasOwnProperty.call(AUTH, persona)) return send(res, 400, { error: { code: null, message: 'unknown persona' } });
        // Never mints the agent claim: staff-runtime identity is server-side only.
        const token = signJwt({ sub: AUTH[persona as Persona], role: 'authenticated' }, cfg.jwtSecret);
        return send(res, 200, { data: { token, persona } });
      }

      const rpc = url.pathname.match(/^\/rpc\/([a-z_]+)$/);
      if (req.method === 'POST' && rpc) {
        const fn = rpc[1]!;
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const claims = token ? verifyJwt(token, cfg.jwtSecret) : null;
        if (!claims || typeof claims.sub !== 'string') return send(res, 401, { error: { code: '28000', message: 'Please sign in.' } });
        if (!isRpcName(fn) || SERVER_ONLY_RPCS.includes(fn)) return send(res, 404, { error: { code: null, message: 'no such function' } });
        const raw = await readBody(req);
        const args = (raw ? JSON.parse(raw) : {}) as Json;
        if (typeof args !== 'object' || args === null || Array.isArray(args)) return send(res, 400, { error: { code: null, message: 'arguments must be an object' } });
        const bad = checkArgs(fn, args);
        if (bad) return send(res, 400, { error: { code: null, message: bad } });
        let data = await withIdentity(cfg.pool, { kind: 'person', sub: claims.sub }, (c) => callFn(c, 'public', fn, args));
        if (fn === 'payment_start' && data && typeof data === 'object') {
          const ref = (data as Json).provider_ref as string;
          data = { ...(data as Json), checkout_url: `${cfg.publicUrl}/sandbox/checkout/${encodeURIComponent(ref)}`, sandbox: true };
        }
        return send(res, 200, { data });
      }

      // Sandbox payment provider: a hosted checkout page that moves no money.
      const checkout = url.pathname.match(/^\/sandbox\/checkout\/(sbx_cs_[0-9a-f]+)$/);
      if (checkout) {
        const ref = checkout[1]!;
        if (req.method === 'GET') {
          const [p] = await withIdentity(cfg.pool, { kind: 'service' }, async (c) =>
            (await c.query<{ amount_cents: number; currency: string; status: string }>('select amount_cents, currency, status from public.payments where provider_ref = $1', [ref])).rows);
          if (!p) return send(res, 404, 'Unknown checkout', 'text/plain');
          const amount = `${(p.amount_cents / 100).toFixed(2)} ${escape(p.currency.toUpperCase())}`;
          return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sandbox checkout</title>
<body style="font-family:system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<p style="background:#fff4d6;padding:8px 12px;border-radius:8px"><strong>Sandbox.</strong> No card is collected and no money moves.</p>
<h1>Pay ${amount}</h1><p>Status: ${escape(p.status)}</p>
<form method="post"><button name="outcome" value="succeeded">Simulate success</button> <button name="outcome" value="failed">Simulate decline</button></form>`, 'text/html; charset=utf-8');
        }
        if (req.method === 'POST') {
          const form = new URLSearchParams(await readBody(req));
          const outcome = form.get('outcome');
          if (outcome !== 'succeeded' && outcome !== 'failed') return send(res, 400, 'bad outcome', 'text/plain');
          // The simulated provider signs its webhook exactly as a real one would; the webhook handler verifies it.
          const raw = JSON.stringify({ event_id: `evt_${randomUUID()}`, provider_ref: ref, outcome });
          const out = await applyWebhook(raw, hmac(cfg.webhookSecret, raw).toString('hex'));
          return send(res, out.status, `Sandbox payment ${escape(outcome)} (${escape(String((out.body as Json).data ?? 'error'))}). You can close this page.`, 'text/plain; charset=utf-8');
        }
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/sandbox') {
        const out = await applyWebhook(await readBody(req), req.headers['x-sandbox-signature'] as string | undefined);
        return send(res, out.status, out.body);
      }

      return send(res, 404, { error: { code: null, message: 'not found' } });
    } catch (e) {
      if (e instanceof SyntaxError) return send(res, 400, { error: { code: null, message: 'invalid JSON' } });
      const { status, error } = pgError(e);
      return send(res, status, { error });
    }
  });
}
