// The workers live in @openseason/sandbox so the in-browser sandbox runs the same code.
import * as core from '@openseason/sandbox';
import type pg from 'pg';
import { pgRunner } from './db.js';

export { SANDBOX_STAFF_NOTE, type WorkerConfig } from '@openseason/sandbox';

export const runQueuedActions = (pool: pg.Pool, limit?: number) => core.runQueuedActions(pgRunner(pool), limit);
export const runDeliveries = (pool: pg.Pool, limit?: number) => core.runDeliveries(pgRunner(pool), limit);
export const runRefunds = (pool: pg.Pool, cfg: core.WorkerConfig, limit?: number) => core.runRefunds(pgRunner(pool), cfg, limit);
export const runSandboxStaff = (pool: pg.Pool, limit?: number) => core.runSandboxStaff(pgRunner(pool), limit);
export const runStaffRoutines = (pool: pg.Pool) => core.runStaffRoutines(pgRunner(pool));
