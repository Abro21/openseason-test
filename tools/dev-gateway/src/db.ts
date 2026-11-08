import * as core from '@openseason/sandbox';
import type pg from 'pg';

export { callFn, type Identity } from '@openseason/sandbox';

/** Adapts a node-postgres pool to the shared transaction runner. */
export function pgRunner(pool: pg.Pool): core.TxRunner {
  return async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const query = ((sql: string, params?: unknown[]) => c.query(sql, params)) as core.Queryable['query'];
      const out = await fn({ query });
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  };
}

/** Runs fn in one transaction with the database identity set the way Supabase/PostgREST sets it. */
export function withIdentity<T>(pool: pg.Pool, who: core.Identity, fn: (c: core.Queryable) => Promise<T>): Promise<T> {
  return core.withIdentity(pgRunner(pool), who, fn);
}

/** Refuses to talk to anything but a database on this machine. */
export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`dev-gateway only runs against a local database (got host ${host})`);
  }
}
