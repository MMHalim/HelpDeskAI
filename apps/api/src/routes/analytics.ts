import type { FastifyInstance } from 'fastify';
import type { EscalationStatus } from '@helpdesk/shared';
import { analyticsQuerySchema, logQuerySchema } from '@helpdesk/shared';
import { requireAdmin, requireFeature } from '../plugins/auth.js';
import { parse } from './helpers.js';
import { getDashboardStats, listEscalations } from '../modules/troubleshooting/queries.js';
import { deleteLogsOlderThan, logCategories, queryLogs } from '../modules/logging/service.js';
import { queryAudit } from '../modules/audit/service.js';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/analytics', async (request) => {
    await requireFeature(request, 'dashboard');
    const { days } = parse(analyticsQuerySchema, request.query);
    return { stats: await getDashboardStats(days) };
  });

  app.get('/api/analytics/overview', async (request) => {
    await requireFeature(request, 'dashboard');
    const { days } = parse(analyticsQuerySchema, request.query);
    return { stats: await getDashboardStats(days) };
  });

  app.get('/api/analytics/escalations', async (request) => {
    await requireFeature(request, 'escalations');
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    return listEscalations({
      status: query.status as EscalationStatus | undefined,
      page: Number.isFinite(page) && page >= 1 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(pageSize, 100) : 20,
    });
  });

  app.get('/api/analytics/logs', async (request) => {
    await requireFeature(request, 'logs');
    const query = parse(logQuerySchema, request.query);
    return queryLogs(query);
  });

  app.get('/api/analytics/logs/categories', async (request) => {
    await requireFeature(request, 'issue-categories');
    return { categories: await logCategories() };
  });

  app.delete('/api/analytics/logs', async (request) => {
    await requireFeature(request, 'logs.clear');
    const days = Number((request.query as Record<string, string | undefined>).days ?? 30);
    const deleted = await deleteLogsOlderThan(Number.isFinite(days) && days > 0 ? days : 30);
    return { deleted };
  });

  app.get('/api/analytics/audit', async (request) => {
    await requireAdmin(request);
    const query = request.query as Record<string, string | undefined>;
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 50);
    return queryAudit({
      action: query.action,
      userId: query.userId,
      page: Number.isFinite(page) && page >= 1 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize >= 1 ? Math.min(pageSize, 200) : 50,
    });
  });
}
