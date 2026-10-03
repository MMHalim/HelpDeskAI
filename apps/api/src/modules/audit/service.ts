/**
 * Audit trail for administrator actions (§21, §32 PHASE 7).
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Paginated } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';
import { redactSecretValues } from '../../lib/redact.js';
import type { User } from '../../db/schema.js';

export interface AuditInput {
  user?: Pick<User, 'id' | 'email'> | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  correlationId?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      userId: input.user?.id ?? null,
      userEmail: input.user?.email ?? null,
      action: input.action.slice(0, 120),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      before: input.before === undefined ? null : (redactSecretValues(input.before) as never),
      after: input.after === undefined ? null : (redactSecretValues(input.after) as never),
      ipAddress: input.ipAddress ?? null,
      correlationId: input.correlationId ?? null,
    });
  } catch {
    // Auditing must never break the request it is describing.
  }
}

export interface AuditQuery {
  action?: string;
  userId?: string;
  page: number;
  pageSize: number;
}

export async function queryAudit(query: AuditQuery): Promise<Paginated<Record<string, unknown>>> {
  const conditions = [];
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.userId) conditions.push(eq(auditLogs.userId, query.userId));

  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(where);
  const total = countRows[0]?.count ?? 0;
  return {
    items: rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      before: row.before,
      after: row.after,
      ipAddress: row.ipAddress,
      correlationId: row.correlationId,
      createdAt: row.createdAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
