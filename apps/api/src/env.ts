/**
 * Environment configuration.
 *
 * Secrets are read from the environment only. The dashboard never receives
 * them; the API stores provider keys encrypted in PostgreSQL instead.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this file to locate the workspace root (or the nearest `.env`). */
function findRepoRoot(start: string): string {
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, '.env')) || fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return start;
}

const repoRoot = findRepoRoot(__dirname);
for (const candidate of [path.join(repoRoot, '.env'), path.join(process.cwd(), '.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number.parseInt(v, 10)))
    .pipe(z.number().int());

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: int(Number.parseInt(process.env.PORT ?? '', 10) || 4000),
  API_HOST: z.string().default('0.0.0.0'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: csv,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MODE: z.enum(['transaction', 'session']).default('transaction'),
  DATABASE_SSL: z.enum(['ssl', 'disable']).default('disable'),

  FILE_STORAGE: z.enum(['local', 'supabase']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('helpdesk-ai'),

  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  SESSION_PEPPER: z.string().default('dev-only-session-pepper'),
  SESSION_TTL_HOURS: int(12),
  ADMIN_EMAIL: z.string().default('admin@example.com'),
  ADMIN_PASSWORD: z.string().default(''),

  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),
  SLACK_CHANNELS: csv,
  SLACK_TRIGGER_EMOJI: z.string().default(':troubleshoot:'),
  SLACK_ENABLE_MENTIONS: bool(false),
  SLACK_ALLOWED_USERS: csv,
  SLACK_VERIFY_SIGNATURE: bool(true),
  SLACK_SIGNATURE_MAX_AGE_SECONDS: int(300),

  AI_PRIMARY_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  AI_FALLBACK_PROVIDER: z.enum(['gemini', 'openai', 'none']).default('openai'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  GEMINI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com/v1beta'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),

  MAX_TROUBLESHOOTING_ATTEMPTS: int(6),
  ESCALATION_INFO_ITEMS: csv,
  SESSION_STALE_AFTER_HOURS: int(24),
  MAX_SCREENSHOTS_PER_MESSAGE: int(4),
  MAX_ATTACHMENT_BYTES: int(8 * 1024 * 1024),
  KB_MAX_ARTICLES: int(3),
  KB_MAX_STEPS: int(10),

  RATE_LIMIT_WINDOW_MS: int(60_000),
  RATE_LIMIT_MAX: int(120),
  SLACK_EVENT_RATE_LIMIT_MAX: int(600),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the values.\n`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

/**
 * Encryption key for provider API keys and Slack tokens.
 * In production a key MUST be supplied; in development we derive a stable
 * development key so the stack still boots, and log a loud warning.
 */
function resolveEncryptionKey(): Buffer {
  const provided = raw.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (provided) {
    const decoded = Buffer.from(provided, 'base64');
    if (decoded.length === 32) return decoded;
    if (provided.length === 32) return Buffer.from(provided, 'utf8');
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  if (isProduction) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is required in production.');
  }
  return crypto.createHash('sha256').update('helpdesk-ai-development-key').digest();
}

const storageDir = path.isAbsolute(raw.STORAGE_LOCAL_DIR)
  ? raw.STORAGE_LOCAL_DIR
  : path.resolve(repoRoot, raw.STORAGE_LOCAL_DIR);

export const env = {
  ...raw,
  isProduction,
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  repoRoot,
  storageDir,
  storagePublicBaseUrl:
    raw.STORAGE_PUBLIC_BASE_URL ?? `${raw.PUBLIC_API_URL.replace(/\/$/, '')}/api/files`,
  encryptionKey: resolveEncryptionKey(),
  /** True when the encryption key was auto-derived (development only). */
  usingDerivedEncryptionKey: !raw.CREDENTIAL_ENCRYPTION_KEY?.trim(),
  slack: {
    botToken: raw.SLACK_BOT_TOKEN?.trim() || null,
    signingSecret: raw.SLACK_SIGNING_SECRET?.trim() || null,
    appToken: raw.SLACK_APP_TOKEN?.trim() || null,
    channels: raw.SLACK_CHANNELS,
    triggerEmoji: raw.SLACK_TRIGGER_EMOJI,
    enableMentions: raw.SLACK_ENABLE_MENTIONS,
    allowedUserIds: raw.SLACK_ALLOWED_USERS,
    verifySignature: raw.SLACK_VERIFY_SIGNATURE,
    signatureMaxAgeSeconds: raw.SLACK_SIGNATURE_MAX_AGE_SECONDS,
  },
  ai: {
    primaryProvider: raw.AI_PRIMARY_PROVIDER,
    fallbackProvider: raw.AI_FALLBACK_PROVIDER === 'none' ? null : raw.AI_FALLBACK_PROVIDER,
    gemini: {
      apiKey: raw.GEMINI_API_KEY?.trim() || null,
      model: raw.GEMINI_MODEL,
      baseUrl: raw.GEMINI_BASE_URL,
    },
    openai: {
      apiKey: raw.OPENAI_API_KEY?.trim() || null,
      model: raw.OPENAI_MODEL,
      baseUrl: raw.OPENAI_BASE_URL,
    },
  },
  troubleshooting: {
    maxAttempts: raw.MAX_TROUBLESHOOTING_ATTEMPTS,
    escalationInfoItems:
      raw.ESCALATION_INFO_ITEMS.length > 0
        ? raw.ESCALATION_INFO_ITEMS
        : [
            'Screenshot of the current error',
            'Your device name and operating system version',
            'Your Slack username',
            'Approximate time the issue started',
          ],
    sessionStaleAfterHours: raw.SESSION_STALE_AFTER_HOURS,
    maxScreenshotsPerMessage: raw.MAX_SCREENSHOTS_PER_MESSAGE,
    maxAttachmentBytes: raw.MAX_ATTACHMENT_BYTES,
    kbMaxArticles: raw.KB_MAX_ARTICLES,
    kbMaxSteps: raw.KB_MAX_STEPS,
  },
  rateLimit: {
    windowMs: raw.RATE_LIMIT_WINDOW_MS,
    max: raw.RATE_LIMIT_MAX,
    slackEventsMax: raw.SLACK_EVENT_RATE_LIMIT_MAX,
  },
} as const;

export type Env = typeof env;
