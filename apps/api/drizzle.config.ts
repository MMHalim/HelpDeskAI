import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import path from 'node:path';

// drizzle-kit runs this file with the app directory as CWD.
const apiDir = process.cwd();
const repoRoot = path.resolve(apiDir, '../..');

config({ path: path.join(repoRoot, '.env') });
config({ path: path.join(apiDir, '.env') });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/helpdesk_ai',
  },
  strict: true,
  verbose: true,
});
