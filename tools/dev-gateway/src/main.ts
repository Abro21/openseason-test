import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { assertLocalDatabase } from './db.js';
import { createGateway } from './server.js';
import { runDeliveries, runQueuedActions, runRefunds, runSandboxStaff, runStaffRoutines, type WorkerConfig } from './workers.js';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/openseason_local';
const PORT = Number(process.env.GATEWAY_PORT ?? 8787);
assertLocalDatabase(DATABASE_URL);

const refundOutcome = (process.env.SANDBOX_REFUND_OUTCOME ?? 'succeeded') as WorkerConfig['refundOutcome'];
if (!['succeeded', 'failed', 'uncertain'].includes(refundOutcome)) throw new Error('SANDBOX_REFUND_OUTCOME must be succeeded, failed or uncertain');

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
const server = createGateway({
  pool,
  // Per-process random secrets unless set: tokens stop working when the gateway restarts.
  jwtSecret: process.env.DEV_GATEWAY_JWT_SECRET ?? randomBytes(32).toString('hex'),
  webhookSecret: process.env.SANDBOX_WEBHOOK_SECRET ?? randomBytes(32).toString('hex'),
  publicUrl: process.env.GATEWAY_PUBLIC_URL ?? `http://localhost:${PORT}`,
  allowedOrigins: (process.env.GATEWAY_ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
});

server.listen(PORT, () => console.log(`[gateway] sandbox gateway on http://localhost:${PORT} (local database only)`));

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await runQueuedActions(pool);
    await runDeliveries(pool);
    await runRefunds(pool, { refundOutcome });
    await runSandboxStaff(pool);
    await runStaffRoutines(pool);
  } catch (e) {
    console.error('[gateway] worker error', (e as Error).message);
  } finally {
    busy = false;
  }
}, Number(process.env.GATEWAY_WORKER_INTERVAL_MS ?? 2000));
