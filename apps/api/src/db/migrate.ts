/**
 * Applies the Drizzle SQL migrations in `apps/api/drizzle`.
 * Run with: `pnpm db:migrate`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { logger } from '../lib/logger.js';
import { seedRolesPermissions } from '../modules/roles/service.js';
import { closeDatabase, db } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Locate `apps/api/drizzle` from either `src/` or the compiled `dist/src/` tree. */
function findMigrationsFolder(start: string): string {
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'drizzle');
    if (fs.existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start, '../../drizzle');
}

export async function runMigrations(): Promise<void> {
  const folder = findMigrationsFolder(__dirname);
  logger.info({ folder }, 'Applying database migrations');
  await migrate(db, { migrationsFolder: folder });
  await seedRolesPermissions();
  logger.info('Database migrations applied');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('db', 'migrate.ts'));
if (isMain) {
  runMigrations()
    .then(() => closeDatabase())
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error({ err: error }, 'Migration failed');
      await closeDatabase().catch(() => undefined);
      process.exit(1);
    });
}
