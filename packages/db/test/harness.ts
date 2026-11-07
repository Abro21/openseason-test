import pg from 'pg';
import { AUTH, type Persona } from '../src/seed-ids.js';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/openseason_local';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 });
export const endPool = () => pool.end();

type Args = Record<string, unknown>;

/** Marks a value to be sent as JSON (for jsonb parameters that are arrays). */
export class Json {
  constructor(readonly value: unknown) {}
}
export const j = (value: unknown) => new Json(value);

function encode(v: unknown): unknown {
  if (v instanceof Json) return JSON.stringify(v.value);
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
  if (Array.isArray(v) && v.some((x) => x !== null && typeof x === 'object')) return JSON.stringify(v);
  return v;
}

/** One database transaction acting as a chosen identity. Rolled back by tx(). */
export class Tx {
  private sp = 0;
  constructor(readonly client: pg.PoolClient) {}

  /** Act as a signed-in person, optionally through the staff (agent) runtime. */
  async as(who: Persona, opts: { agent?: boolean } = {}) {
    const claims = { sub: AUTH[who], role: 'authenticated', ...(opts.agent ? { os_actor: 'agent' } : {}) };
    await this.client.query('reset role');
    await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await this.client.query('set local role authenticated');
    return this;
  }

  async asAnon() {
    await this.client.query('reset role');
    await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
    await this.client.query('set local role anon');
    return this;
  }

  /** The trusted server runtime (webhooks, workers). */
  async asService() {
    await this.client.query('reset role');
    await this.client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    await this.client.query('set local role service_role');
    return this;
  }

  /** Superuser, for test setup and assertions only. */
  async asAdmin() {
    await this.client.query('reset role');
    await this.client.query(`select set_config('request.jwt.claims', '', true)`);
    return this;
  }

  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    const name = `s${++this.sp}`;
    await this.client.query(`savepoint ${name}`);
    try {
      const out = await run();
      await this.client.query(`release savepoint ${name}`);
      return out;
    } catch (e) {
      await this.client.query(`rollback to savepoint ${name}`);
      throw e;
    }
  }

  async sql<T = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
    return this.guarded(async () => (await this.client.query(text, params.map(encode))).rows as T[]);
  }

  /** Call an RPC by name with named arguments. Scalar results are unwrapped. */
  async rpc<T = any>(fn: string, args: Args = {}, schema = 'public'): Promise<T> {
    const keys = Object.keys(args);
    const call = `${schema}.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    return this.guarded(async () => {
      const r = await this.client.query(`select * from ${call}`, keys.map((k) => encode(args[k])));
      if (r.fields.length === 1 && r.fields[0]!.name === fn) return r.rows[0]?.[fn] as T;
      return r.rows as T;
    });
  }

  /** Expect a call to fail; returns the error message. */
  async fails(fn: string, args: Args = {}, schema = 'public'): Promise<string> {
    try {
      await this.rpc(fn, args, schema);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`expected ${fn} to fail, but it succeeded`);
  }

  async sqlFails(text: string, params: unknown[] = []): Promise<string> {
    try {
      await this.sql(text, params);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error(`expected SQL to fail: ${text}`);
  }
}

/** Run fn in a transaction that is rolled back afterwards, so tests never leak state. */
export async function tx(fn: (t: Tx) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(new Tx(client));
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

/** A raw connection, for concurrency tests that need real commits. */
export async function connect(): Promise<pg.PoolClient> {
  return pool.connect();
}
