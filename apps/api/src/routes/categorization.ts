/**
 * Incident taxonomy and categorization endpoints (§32).
 *
 *   GET   /api/categorization/taxonomy             categories + sub-categories
 *   GET   /api/categorization/report               most received issues
 *   PATCH /api/categorization/sessions/:id         manual override
 */
import type { FastifyInstance } from 'fastify';
import { idParamSchema, issueReportQuerySchema, updateCategorizationSchema } from '@helpdesk/shared';
import { requireFeature } from '../plugins/auth.js';
import { parse } from './helpers.js';
import {
  getCategorization,
  getIssueReport,
  listTaxonomy,
  upsertCategorization,
} from '../modules/categorization/service.js';

export async function categorizationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/categorization/taxonomy', async (request) => {
    await requireFeature(request, 'issue-categories');
    return { categories: await listTaxonomy() };
  });

  app.get('/api/categorization/report', async (request) => {
    await requireFeature(request, 'issue-categories');
    const query = parse(issueReportQuerySchema, request.query);
    return getIssueReport(query);
  });

  app.get('/api/categorization/sessions/:id', async (request) => {
    await requireFeature(request, 'issue-categories');
    const { id } = parse(idParamSchema, request.params);
    return { categorization: await getCategorization(id) };
  });

  app.patch('/api/categorization/sessions/:id', async (request) => {
    const user = await requireFeature(request, 'issue-categories.manage');
    const { id } = parse(idParamSchema, request.params);
    const body = parse(updateCategorizationSchema, request.body);
    return {
      categorization: await upsertCategorization({
        sessionId: id,
        subcategoryId: body.subcategoryId,
        source: 'manual',
        confidence: 1,
        rationale: body.rationale,
        userId: user.id,
      }),
    };
  });
}
