/**
 * Read-side queries for the dashboard: sessions, timeline, escalations and
 * aggregate statistics (§22, §24, §30).
 */
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type {
  AiOperation,
  DashboardStats,
  EscalationDto,
  EscalationStatus,
  Paginated,
  SessionDetailDto,
  SessionDto,
  SessionStatus,
  SessionQuery,
  TimelineEntryDto,
} from '@helpdesk/shared';
import { db } from '../../db/client.js';
import {
  aiRequests,
  escalations,
  slackChannels,
  slackFiles,
  slackMessages,
  troubleshootingArticles,
  troubleshootingSessions,
  troubleshootingTimeline,
  users,
  type Session,
} from '../../db/schema.js';
import { sessionToDto } from './engine.js';
import { fileToDto } from '../slack/files.js';
import { getCategorization } from '../categorization/service.js';

function sessionSelect() {
  return {
    session: troubleshootingSessions,
    channelName: slackChannels.name,
  };
}

export async function listSessions(query: SessionQuery): Promise<Paginated<SessionDto>> {
  const conditions = [];
  if (query.status && query.status.length > 0) {
    conditions.push(inArray(troubleshootingSessions.status, query.status as SessionStatus[]));
  }
  if (query.channelId) conditions.push(eq(troubleshootingSessions.channelId, query.channelId));
  if (query.agentId) conditions.push(eq(troubleshootingSessions.slackUserId, query.agentId));
  if (query.provider) conditions.push(eq(troubleshootingSessions.aiProvider, query.provider));
  if (query.escalated !== undefined) {
    conditions.push(eq(troubleshootingSessions.escalationRequired, query.escalated));
  }
  if (query.from) conditions.push(gte(troubleshootingSessions.createdAt, new Date(query.from)));
  if (query.to) conditions.push(lte(troubleshootingSessions.createdAt, new Date(query.to)));
  if (query.q) {
    conditions.push(
      or(
        ilike(troubleshootingSessions.issueTitle, `%${query.q}%`),
        ilike(troubleshootingSessions.sessionCode, `%${query.q}%`),
        ilike(troubleshootingSessions.agentDisplayName, `%${query.q}%`),
      )!,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select(sessionSelect())
      .from(troubleshootingSessions)
      .leftJoin(slackChannels, eq(slackChannels.channelId, troubleshootingSessions.channelId))
      .where(where)
      .orderBy(desc(troubleshootingSessions.lastActivityAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(troubleshootingSessions).where(where),
  ]);

  const total = countRows[0]?.count ?? 0;
  return {
    items: rows.map((row) => sessionToDto({ ...row.session, channelName: row.channelName }, {})),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getSessionDetail(id: string): Promise<SessionDetailDto | null> {
  const rows = await db
    .select(sessionSelect())
    .from(troubleshootingSessions)
    .leftJoin(slackChannels, eq(slackChannels.channelId, troubleshootingSessions.channelId))
    .where(eq(troubleshootingSessions.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const session = { ...row.session, channelName: row.channelName };

  const [timelineRows, fileRows, messageRows, escalationRows, aiRows, articleRows, categorization] =
    await Promise.all([
      getTimelineRows(id),
      db.select().from(slackFiles).where(eq(slackFiles.channelId, session.channelId)).orderBy(desc(slackFiles.createdAt)).limit(50),
      db
        .select()
        .from(slackMessages)
        .where(and(eq(slackMessages.channelId, session.channelId), eq(slackMessages.threadTs, session.threadTs)))
        .orderBy(sql`${slackMessages.slackMessageTs}::double precision asc`)
        .limit(200),
      db.select().from(escalations).where(eq(escalations.sessionId, id)).orderBy(desc(escalations.createdAt)).limit(1),
      db.select().from(aiRequests).where(eq(aiRequests.sessionId, id)).orderBy(desc(aiRequests.createdAt)).limit(100),
      session.articleIds.length > 0
        ? db
            .select({
              id: troubleshootingArticles.id,
              title: troubleshootingArticles.title,
              category: troubleshootingArticles.category,
            })
            .from(troubleshootingArticles)
            .where(inArray(troubleshootingArticles.id, session.articleIds))
        : Promise.resolve([] as Array<{ id: string; title: string; category: string }>),
      getCategorization(id),
    ]);

  const articleById = new Map(articleRows.map((article) => [article.id, article]));
  const articlesUsed = session.articleIds
    .map((articleId) => articleById.get(articleId))
    .filter((article): article is { id: string; title: string; category: string } => Boolean(article));

  const escalation = escalationRows[0];
  return {
    ...sessionToDto(session, { articlesUsed }),
    categorization,
    originalMessage: session.originalMessage,
    files: fileRows.map((file) => fileToDto(file)),
    messages: messageRows.map((message) => ({
      ts: message.slackMessageTs,
      userId: message.userId ?? '',
      userName: message.userName,
      text: message.text,
      isBot: message.isBot,
      createdAt: message.createdAt.toISOString(),
      files: [],
    })),
    timeline: timelineRows,
    escalation: escalation
      ? {
          id: escalation.id,
          reason: escalation.reason,
          requiredInfo: escalation.requiredInfo,
          status: escalation.status as EscalationStatus,
          escalatedBy: escalation.escalatedBy,
          slackMessageTs: escalation.slackMessageTs,
          createdAt: escalation.createdAt.toISOString(),
        }
      : null,
    aiRequests: aiRows.map((request) => ({
      id: request.id,
      correlationId: request.correlationId,
      provider: request.provider,
      model: request.model,
      operation: request.operation as AiOperation,
      success: request.success,
      errorMessage: request.errorMessage,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      totalTokens: request.totalTokens,
      estimatedCost: request.estimatedCost,
      latencyMs: request.latencyMs,
      isFallback: request.isFallback,
      attempt: request.attempt,
      createdAt: request.createdAt.toISOString(),
    })),
  };
}

async function getTimelineRows(sessionId: string): Promise<TimelineEntryDto[]> {
  const rows = await db
    .select()
    .from(troubleshootingTimeline)
    .where(eq(troubleshootingTimeline.sessionId, sessionId))
    .orderBy(troubleshootingTimeline.seq);
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    role: row.role,
    kind: row.kind,
    summary: row.summary,
    content: row.content,
    metadata: row.metadata,
    provider: row.provider,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    createdAt: row.createdAt.toISOString(),
    slackUserName: row.slackUserName,
  }));
}

export async function listEscalations(options: {
  status?: EscalationStatus;
  page: number;
  pageSize: number;
}): Promise<Paginated<EscalationDto>> {
  const where = options.status ? eq(escalations.status, options.status) : undefined;
  const [rows, countRows] = await Promise.all([
    db
      .select({
        escalation: escalations,
        session: troubleshootingSessions,
        channelName: slackChannels.name,
      })
      .from(escalations)
      .innerJoin(troubleshootingSessions, eq(troubleshootingSessions.id, escalations.sessionId))
      .leftJoin(slackChannels, eq(slackChannels.channelId, troubleshootingSessions.channelId))
      .where(where)
      .orderBy(desc(escalations.createdAt))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(escalations).where(where),
  ]);

  const total = countRows[0]?.count ?? 0;
  return {
    items: rows.map((row) => ({
      id: row.escalation.id,
      sessionId: row.escalation.sessionId,
      sessionCode: row.session.sessionCode,
      reason: row.escalation.reason,
      requiredInfo: row.escalation.requiredInfo,
      status: row.escalation.status as EscalationStatus,
      escalatedBy: row.escalation.escalatedBy,
      channelId: row.session.channelId,
      channelName: row.channelName,
      agentName: row.session.agentDisplayName ?? row.session.agentName,
      issueTitle: row.session.issueTitle,
      slackMessageTs: row.escalation.slackMessageTs,
      createdAt: row.escalation.createdAt.toISOString(),
      acknowledgedAt: row.escalation.acknowledgedAt?.toISOString() ?? null,
      closedAt: row.escalation.closedAt?.toISOString() ?? null,
    })),
    page: options.page,
    pageSize: options.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / options.pageSize)),
  };
}

export async function findEscalation(id: string) {
  const rows = await db.select().from(escalations).where(eq(escalations.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findSession(id: string): Promise<Session | null> {
  const rows = await db.select().from(troubleshootingSessions).where(eq(troubleshootingSessions.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Aggregated dashboard statistics for the last `days` days. */
export async function getDashboardStats(days = 30): Promise<DashboardStats> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [statusRows, resolutionRows, escalationCount, issuesToday, issuesWeek, aiTotals, aiByProvider, daily, recent, durationRow] =
    await Promise.all([
      db
        .select({ status: troubleshootingSessions.status, count: sql<number>`count(*)::int` })
        .from(troubleshootingSessions)
        .where(gte(troubleshootingSessions.createdAt, since))
        .groupBy(troubleshootingSessions.status),
      db
        .select({ status: troubleshootingSessions.status, count: sql<number>`count(*)::int` })
        .from(troubleshootingSessions)
        .where(and(gte(troubleshootingSessions.createdAt, since), eq(troubleshootingSessions.status, 'resolved')))
        .groupBy(troubleshootingSessions.status),
      db.select({ count: sql<number>`count(*)::int` }).from(escalations).where(eq(escalations.status, 'open')),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(troubleshootingSessions)
        .where(gte(troubleshootingSessions.createdAt, startOfToday)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(troubleshootingSessions)
        .where(gte(troubleshootingSessions.createdAt, weekAgo)),
      db
        .select({
          requests: sql<number>`count(*)::int`,
          errors: sql<number>`count(*) filter (where not ${aiRequests.success})::int`,
          tokens: sql<number>`coalesce(sum(${aiRequests.totalTokens}), 0)::int`,
          cost: sql<number>`coalesce(sum(${aiRequests.estimatedCost}), 0)::float8`,
          fallbacks: sql<number>`count(*) filter (where ${aiRequests.isFallback})::int`,
        })
        .from(aiRequests)
        .where(gte(aiRequests.createdAt, since)),
      db
        .select({
          provider: aiRequests.provider,
          model: aiRequests.model,
          requests: sql<number>`count(*)::int`,
          errors: sql<number>`count(*) filter (where not ${aiRequests.success})::int`,
          tokens: sql<number>`coalesce(sum(${aiRequests.totalTokens}), 0)::int`,
          cost: sql<number>`coalesce(sum(${aiRequests.estimatedCost}), 0)::float8`,
        })
        .from(aiRequests)
        .where(gte(aiRequests.createdAt, since))
        .groupBy(aiRequests.provider, aiRequests.model),
      db
        .select({
          date: sql<string>`to_char(date_trunc('day', ${troubleshootingSessions.createdAt}), 'YYYY-MM-DD')`,
          sessions: sql<number>`count(*)::int`,
          resolved: sql<number>`count(*) filter (where ${troubleshootingSessions.status} = 'resolved')::int`,
          escalated: sql<number>`count(*) filter (where ${troubleshootingSessions.status} = 'escalated')::int`,
        })
        .from(troubleshootingSessions)
        .where(gte(troubleshootingSessions.createdAt, since))
        .groupBy(sql`date_trunc('day', ${troubleshootingSessions.createdAt})`)
        .orderBy(sql`date_trunc('day', ${troubleshootingSessions.createdAt})`),
      db
        .select({
          id: troubleshootingSessions.id,
          sessionCode: troubleshootingSessions.sessionCode,
          issueTitle: troubleshootingSessions.issueTitle,
          agentName: troubleshootingSessions.agentDisplayName,
          status: troubleshootingSessions.status,
          resolutionStatus: troubleshootingSessions.resolutionStatus,
          aiProvider: troubleshootingSessions.aiProvider,
          createdAt: troubleshootingSessions.createdAt,
          lastActivityAt: troubleshootingSessions.lastActivityAt,
          attemptCount: troubleshootingSessions.attemptCount,
        })
        .from(troubleshootingSessions)
        .orderBy(desc(troubleshootingSessions.lastActivityAt))
        .limit(8),
      db
        .select({
          avg: sql<number | null>`avg(extract(epoch from (${troubleshootingSessions.resolvedAt} - ${troubleshootingSessions.createdAt})))::float8`,
        })
        .from(troubleshootingSessions)
        .where(and(gte(troubleshootingSessions.createdAt, since), eq(troubleshootingSessions.status, 'resolved'))),
    ]);

  const byStatus = new Map(statusRows.map((row) => [row.status, row.count]));
  const totalSessions = statusRows.reduce((sum, row) => sum + row.count, 0);
  const resolved = resolutionRows[0]?.count ?? 0;
  const escalated = byStatus.get('escalated') ?? 0;
  const active = (byStatus.get('in_progress') ?? 0) + (byStatus.get('paused') ?? 0);
  const totals = aiTotals[0] ?? { requests: 0, errors: 0, tokens: 0, cost: 0, fallbacks: 0 };

  return {
    activeSessions: active,
    resolvedSessions: resolved,
    escalatedSessions: escalated,
    openEscalations: escalationCount[0]?.count ?? 0,
    issuesToday: issuesToday[0]?.count ?? 0,
    issuesThisWeek: issuesWeek[0]?.count ?? 0,
    aiRequests: totals.requests,
    aiErrors: totals.errors,
    averageResolutionSeconds: durationRow[0]?.avg ?? null,
    totalTokens: totals.tokens,
    estimatedCost: totals.cost,
    successRate: totalSessions > 0 ? resolved / totalSessions : null,
    escalationRate: totalSessions > 0 ? escalated / totalSessions : null,
    providerUsage: aiByProvider.map((row) => ({
      provider: row.provider,
      model: row.model,
      requests: row.requests,
      errors: row.errors,
      tokens: row.tokens,
      estimatedCost: row.cost,
    })),
    statusBreakdown: statusRows.map((row) => ({ status: row.status as SessionStatus, count: row.count })),
    daily: daily.map((row) => ({ date: row.date, sessions: row.sessions, resolved: row.resolved, escalated: row.escalated, tokens: 0 })),
    recentSessions: recent.map((row) => ({
      id: row.id,
      sessionCode: row.sessionCode,
      issueTitle: row.issueTitle,
      agentName: row.agentName,
      status: row.status as SessionStatus,
      resolutionStatus: row.resolutionStatus as SessionDto['resolutionStatus'],
      aiProvider: row.aiProvider,
      createdAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
      attemptCount: row.attemptCount,
    })),
  };
}

export async function countUsers(): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return rows[0]?.count ?? 0;
}
