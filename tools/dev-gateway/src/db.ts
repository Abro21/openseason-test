import { JSON_ARGS } from '@openseason/contracts';
import pg from 'pg';

export type Identity =
  | { kind: 'person'; sub: string; agent?: boolean }
  | { kind: 'service' };

/** Runs fn in one transaction with the database identity set the way Supabase/PostgREST sets it. */
export async function withIdentity<T>(pool: pg.Pool, who: Identity, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const claims = who.kind === 'service'
      ? { role: 'service_role' }
      : { sub: who.sub, role: 'authenticated', ...(who.agent ? { os_actor: 'agent' } : {}) };
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(`set local role ${who.kind === 'service' ? 'service_role' : 'authenticated'}`);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Calls schema.fn with named arguments; jsonb arguments are sent as JSON text. Scalar results are unwrapped. */
export async function callFn(c: pg.PoolClient, schema: 'public' | 'app', fn: string, args: Record<string, unknown>): Promise<unknown> {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error('bad function name');
  const keys = Object.keys(args);
  for (const k of keys) if (!/^p_[a-z0-9_]+$/.test(k)) throw new Error('bad argument name');
  const sql = `select * from ${schema}.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
  const r = await c.query(sql, keys.map((k) => (JSON_ARGS.has(k) && args[k] !== null ? JSON.stringify(args[k]) : args[k])));
  if (r.fields.length === 1 && r.fields[0]!.name === fn) return r.rows[0]?.[fn] ?? null;
  return r.rows;
}

/** Refuses to talk to anything but a database on this machine. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`dev-gateway only runs against a local database (got host ${host})`);
  }
}
