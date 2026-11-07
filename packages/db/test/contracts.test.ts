// The client's allowlist of callable functions must match what the database
// actually lets a signed-in person execute, in both directions.
import { RPC_ARGS } from '@openseason/contracts';
import { afterAll, expect, it } from 'vitest';
import { endPool, tx } from './harness.js';

afterAll(endPool);

it('RPC_ARGS matches the public functions executable by authenticated users', () =>
  tx(async (t) => {
    await t.asAdmin();
    const rows = await t.sql<{ name: string; args: string[] | null }>(`
      select p.proname as name, p.proargnames[1:p.pronargs] as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      order by 1`);
    const db = Object.fromEntries(rows.map((r) => [r.name, r.args ?? []]));
    expect(db).toEqual(Object.fromEntries(Object.entries(RPC_ARGS).map(([k, v]) => [k, [...v]])));
  }));

it('anonymous visitors can execute no public function', () =>
  tx(async (t) => {
    await t.asAdmin();
    const rows = await t.sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  }));
