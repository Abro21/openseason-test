// In-browser sandbox: the real schema, row-level security and RPCs, running in
// Postgres compiled to WebAssembly (PGlite) inside this tab. Each visitor gets
// their own synthetic database. Nothing is sent to a server.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { ApiError, type Transport } from '@openseason/api-client';
import { checkArgs, isRpcName, SERVER_ONLY_RPCS } from '@openseason/contracts';
import { AUTH, PERSONA_LABELS, type Persona } from '@openseason/db/src/seed-ids.js';
import {
  callFn, runDeliveries, runQueuedActions, runRefunds, runSandboxStaff, runStaffRoutines, withIdentity,
  type Queryable, type TxRunner,
} from '@openseason/sandbox';
import shim from '../../../../supabase/tests/local_supabase_shim.sql?raw';
import seed from '../../../../supabase/seed/seed.sql?raw';

const migrations = import.meta.glob('../../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SQL = [shim, ...Object.keys(migrations).sort().map((k) => migrations[k]!), seed];

/** Changes whenever the schema or seed changes, so an old saved sandbox is never reused with new code. */
function fingerprint(parts: string[]): string {
  let h = 0x811c9dc5;
  for (const p of parts) for (let i = 0; i < p.length; i++) h = Math.imul(h ^ p.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

const TOKEN_PREFIX = 'sandbox:';
const GENERATION_KEY = 'os.sandbox.generation';

export interface CheckoutInfo { amount_cents: number; currency: string; status: string }

export interface BrowserSandbox {
  personas(): { id: string; label: string }[];
  /** A session token for a synthetic person. There is no password: these people only exist in this browser. */
  tokenFor(persona: string): string;
  transport(getToken: () => string | null): Transport;
  checkout(ref: string): Promise<CheckoutInfo | null>;
  completeCheckout(ref: string, outcome: 'succeeded' | 'failed'): Promise<unknown>;
  /** Runs the sandbox providers (sends, refunds, staff replies) the way the gateway's timer does. */
  runWorkers(): Promise<void>;
  /** Throws this sandbox away; the next load starts from the seed again. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

function generation(): number {
  try { return Number(localStorage.getItem(GENERATION_KEY) ?? '0') || 0; } catch { return 0; }
}

/** Holds a lock for the life of the tab, so two tabs never open the same saved database. */
async function claimTab(): Promise<void> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return;
  const got = await new Promise<boolean>((resolve) => {
    void locks.request('openseason-sandbox', { ifAvailable: true }, (lock) => {
      resolve(Boolean(lock));
      return lock ? new Promise<void>(() => undefined) : undefined;
    });
  });
  if (!got) throw new Error('The sandbox is already open in another tab. Close that tab, or use it instead.');
}

export async function openSandbox(opts: { dataDir?: string } = {}): Promise<BrowserSandbox> {
  const name = `openseason-sandbox-${fingerprint(SQL)}-${generation()}`;
  const dataDir = opts.dataDir ?? `idb://${name}`;
  if (!opts.dataDir) await claimTab();
  const db = await PGlite.create(dataDir, { extensions: { pgcrypto } });
  const loaded = await db.query<{ t: string | null }>(`select to_regclass('public.people')::text as t`);
  if (!loaded.rows[0]?.t) for (const sql of SQL) await db.exec(sql);

  // One transaction at a time, like a single database connection.
  let queue: Promise<unknown> = Promise.resolve();
  const run: TxRunner = (fn) => {
    const next = queue.then(() => db.transaction((tx: Transaction) => fn(tx as unknown as Queryable)));
    queue = next.catch(() => undefined);
    return next;
  };

  const subs = new Set(Object.values(AUTH));
  // At most one pass runs and one waits; a caller always gets a pass that started after its call.
  let current: Promise<void> | null = null;
  let pending: Promise<void> | null = null;
  async function pass() {
    await runQueuedActions(run);
    await runDeliveries(run);
    await runRefunds(run, { refundOutcome: 'succeeded' });
    await runSandboxStaff(run);
    await runStaffRoutines(run);
  }
  function runWorkers(): Promise<void> {
    if (!current) {
      current = pass().finally(() => { current = null; });
      return current;
    }
    pending ??= current.catch(() => undefined).then(() => { pending = null; return runWorkers(); });
    return pending;
  }

  return {
    personas: () => Object.entries(PERSONA_LABELS).map(([id, label]) => ({ id, label })),
    tokenFor(persona) {
      if (!Object.prototype.hasOwnProperty.call(AUTH, persona)) throw new Error('unknown persona');
      return TOKEN_PREFIX + AUTH[persona as Persona];
    },
    transport: (getToken) => ({
      async call(fn, args) {
        const token = getToken();
        const sub = token?.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : null;
        if (!sub || !subs.has(sub)) throw new ApiError('unauthenticated', 'Please sign in.', '28000');
        if (!isRpcName(fn) || SERVER_ONLY_RPCS.includes(fn)) throw new ApiError('invalid_request', 'no such function', null);
        const bad = checkArgs(fn, args);
        if (bad) throw new ApiError('invalid_request', bad, null);
        let data: unknown;
        try {
          data = await withIdentity(run, { kind: 'person', sub }, (c) => callFn(c, 'public', fn, args));
        } catch (e) {
          const err = e as { code?: string; message?: string };
          if (err.code) throw ApiError.fromCode(err.code, err.message ?? 'error');
          console.error('[sandbox] unexpected error', err.message);
          throw new ApiError('unknown', 'Something went wrong in the sandbox.', null);
        }
        if (fn === 'payment_start' && data && typeof data === 'object') {
          const ref = (data as { provider_ref: string }).provider_ref;
          data = { ...data, checkout_url: `#sandbox-checkout/${encodeURIComponent(ref)}`, sandbox: true };
        }
        void runWorkers().catch((e: Error) => console.error('[sandbox] worker error', e.message));
        return data;
      },
    }),
    async checkout(ref) {
      const r = await withIdentity(run, { kind: 'service' }, (c) =>
        c.query<CheckoutInfo>('select amount_cents, currency, status from public.payments where provider_ref = $1', [ref]));
      return r.rows[0] ?? null;
    },
    completeCheckout: (ref, outcome) => withIdentity(run, { kind: 'service' }, (c) => callFn(c, 'app', 'payment_apply_provider_event', {
      p_provider: 'sandbox', p_event_id: `evt_${crypto.randomUUID()}`, p_provider_ref: ref, p_outcome: outcome,
    })),
    runWorkers,
    async reset() {
      await current?.catch(() => undefined);
      await db.close();
      try {
        localStorage.setItem(GENERATION_KEY, String(generation() + 1));
        indexedDB.deleteDatabase(`/pglite/${name}`);
      } catch { /* storage unavailable: the next load reuses the same sandbox */ }
    },
    async close() {
      await current?.catch(() => undefined);
      await pending?.catch(() => undefined);
      await db.close();
    },
  };
}
