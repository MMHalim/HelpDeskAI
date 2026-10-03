import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

const { Pool } = pg;

/**
 * Pool sizing notes:
 *  - Supabase's *transaction* pooler (port 6543) does not support session state,
 *    so prepared statements must be disabled (`prepare: false`).
 *  - The *session* pooler (port 5432) and self-hosted Postgres can use them.
 */
const useTransactionPooler =
  env.DATABASE_POOL_MODE === 'transaction' || /pgbouncer/i.test(env.DATABASE_URL);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: useTransactionPooler ? 8 : 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  ssl: env.DATABASE_SSL === 'ssl' ? { rejectUnauthorized: false } : undefined,
  ...(useTransactionPooler ? { prepare: false } : {}),
});

pool.on('error', (error) => {
  logger.error({ err: error }, 'Unexpected postgres pool error');
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export type Database = typeof db;

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export async function healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await pool.query('select 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
