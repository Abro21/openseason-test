// Recreate the local test database from migrations + synthetic seed.
// Local/CI only. Refuses to run against anything but localhost.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const admin = process.env.DATABASE_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const dbName = process.env.OPENSEASON_DB ?? 'openseason_local';
const host = new URL(admin).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`db-reset only runs against localhost, not ${host}`);

const psql = (url, args) => execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { stdio: 'inherit' });
psql(admin, ['-c', `drop database if exists ${dbName} with (force)`, '-c', `create database ${dbName}`]);
const url = admin.replace(/\/[^/]*$/, `/${dbName}`);
const root = new URL('..', import.meta.url).pathname;
psql(url, ['-f', join(root, 'supabase/tests/local_supabase_shim.sql')]);
for (const f of readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  psql(url, ['-f', join(root, 'supabase/migrations', f)]);
}
if (process.argv.includes('--seed') || !process.argv.includes('--no-seed')) {
  psql(url, ['-f', join(root, 'supabase/seed/seed.sql')]);
}
console.log(`reset ${dbName}`);
