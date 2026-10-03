/**
 * API process entrypoint: runs migrations, starts Fastify and handles signals.
 */
import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { log } from './modules/logging/service.js';
import { closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { purgeExpiredSessions } from './modules/auth/service.js';

async function main(): Promise<void> {
  if (!env.isTest) {
    await runMigrations();
  }

  const app = await buildApp();

  const purgeTimer = setInterval(
    () => {
      void purgeExpiredSessions().catch((error: unknown) => {
        log.warn({ category: 'auth', error }, 'Failed to purge expired sessions');
      });
    },
    60 * 60 * 1000,
  );
  purgeTimer.unref?.();

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ category: 'http', signal }, 'Shutting down');
    clearInterval(purgeTimer);
    try {
      await app.close();
      await closeDatabase();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  log.info({ category: 'http', port: env.API_PORT, host: env.API_HOST }, 'HelpDesk AI API listening');
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Fatal startup error');
  process.exit(1);
});
