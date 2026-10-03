import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { env } from '../env.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }));

  app.get('/api/health', async () => {
    let database = false;
    try {
      await db.execute(sql`select 1`);
      database = true;
    } catch {
      database = false;
    }
    return {
      status: database ? 'ok' : 'degraded',
      database,
      environment: env.NODE_ENV,
      version: '1.0.0',
      time: new Date().toISOString(),
    };
  });
}
