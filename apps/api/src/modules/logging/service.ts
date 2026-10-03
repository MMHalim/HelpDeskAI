/**
 * Structured application logs (§24).
 *
 * Everything goes to the console through pino *and* to the `app_logs` table so
 * the dashboard's Logs page can show it. Every troubleshooting request carries
 * a `correlationId` that ties Slack events, AI calls and database writes
 * together.
 */
import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import type { LogLevel, Paginated } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { appLogs } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { redactSecretValues } from '../../lib/redact.js';
import { toAppError } from '../../lib/errors.js';

export interface LogInput {
  level?: LogLevel;
  category: string;
  message: string;
  correlationId?: string | null;
  sessionId?: string | null;
  sessionCode?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown> | null;
  error?: unknown;
  /** Set to false for high-volume events that should not hit the database. */
  persist?: boolean;
}

const pinoLevel: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error' | 'fatal'> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

export function writeLog(input: LogInput): void {
  const level = input.level ?? 'info';
  const metadata = {
    category: input.category,
    correlationId: input.correlationId ?? undefined,
    sessionId: input.sessionId ?? undefined,
    sessionCode: input.sessionCode ?? undefined,
    provider: input.provider ?? undefined,
    ...(input.metadata ? { data: redactSecretValues(input.metadata) } : {}),
  };

  const appError = input.error ? toAppError(input.error) : null;
  if (appError) {
    logger[pinoLevel[level]](
      { ...metadata, err: { message: appError.message, kind: appError.kind, stack: appError.stack } },
      input.message,
    );
  } else {
    logger[pinoLevel[level]](metadata, input.message);
  }

  if (input.persist === false) return;

  void db
    .insert(appLogs)
    .values({
      level,
      category: input.category.slice(0, 60),
      message: input.message.slice(0, 8000),
      correlationId: input.correlationId ?? null,
      sessionId: input.sessionId ?? null,
      sessionCode: input.sessionCode ?? null,
      provider: (input.provider as never) ?? null,
      errorStack: appError?.stack ?? null,
      metadata: (input.metadata ? redactSecretValues(input.metadata) : null) as never,
    })
    .catch((error: unknown) => {
      // Never let logging break the request path.
      logger.error({ err: error }, 'Failed to persist application log');
    });
}

type LogArgs = Partial<Omit<LogInput, 'level'>> & Record<string, unknown>;

const KNOWN_LOG_KEYS = new Set([
  'category',
  'message',
  'correlationId',
  'sessionId',
  'sessionCode',
  'provider',
  'metadata',
  'error',
  'persist',
  'level',
]);

/**
 * Accepts both `log.info({ category, message })` and the pino-style
 * `log.info({ category, correlationId, ...extra }, 'message')`.
 */
function toLogInput(args: LogArgs | string, message?: string): LogInput {
  if (typeof args === 'string') return { category: 'app', message: args };

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!KNOWN_LOG_KEYS.has(key) && value !== undefined) extra[key] = value;
  }

  const baseMetadata = (args.metadata as Record<string, unknown> | null | undefined) ?? null;
  const metadata =
    baseMetadata || Object.keys(extra).length > 0
      ? { ...(baseMetadata ?? {}), ...extra }
      : null;

  const category = typeof args.category === 'string' && args.category ? args.category : 'app';
  const resolvedMessage =
    message ?? (typeof args.message === 'string' ? args.message : category);

  return {
    category,
    message: resolvedMessage,
    correlationId: (args.correlationId as string | null | undefined) ?? null,
    sessionId: (args.sessionId as string | null | undefined) ?? null,
    sessionCode: (args.sessionCode as string | null | undefined) ?? null,
    provider: (args.provider as string | null | undefined) ?? null,
    metadata,
    error: args.error,
    persist: args.persist as boolean | undefined,
  };
}

function makeLogger(level: LogLevel) {
  return (args: LogArgs | string, message?: string) => writeLog({ ...toLogInput(args, message), level });
}

export const log = {
  debug: makeLogger('debug'),
  info: makeLogger('info'),
  warn: makeLogger('warn'),
  error: makeLogger('error'),
  fatal: makeLogger('fatal'),
};

export interface LogQuery {
  level?: string;
  category?: string;
  correlationId?: string;
  sessionId?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export async function queryLogs(query: LogQuery): Promise<Paginated<Record<string, unknown>>> {
  const conditions = [];
  if (query.level) conditions.push(eq(appLogs.level, query.level as never));
  if (query.category) conditions.push(eq(appLogs.category, query.category));
  if (query.correlationId) conditions.push(eq(appLogs.correlationId, query.correlationId));
  if (query.sessionId) conditions.push(eq(appLogs.sessionId, query.sessionId));
  if (query.q) {
    conditions.push(or(ilike(appLogs.message, `%${query.q}%`), ilike(appLogs.sessionCode, `%${query.q}%`))!);
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(appLogs)
    .where(where)
    .orderBy(desc(appLogs.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(appLogs)
    .where(where);

  const total = countRows[0]?.count ?? 0;
  return {
    items: rows.map((row) => ({
      id: row.id,
      level: row.level,
      category: row.category,
      message: row.message,
      correlationId: row.correlationId,
      sessionId: row.sessionId,
      sessionCode: row.sessionCode,
      provider: row.provider,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function logCategories(): Promise<string[]> {
  const rows = await db.selectDistinct({ category: appLogs.category }).from(appLogs);
  return rows.map((r) => r.category).sort();
}

export async function deleteLogsOlderThan(days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(appLogs)
    .where(and(gte(appLogs.createdAt, new Date(0)), sql`${appLogs.createdAt} < ${cutoff}`))
    .returning({ id: appLogs.id });
  return deleted.length;
}
