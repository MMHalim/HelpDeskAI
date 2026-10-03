import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { adminSessionActionSchema, idParamSchema, sessionQuerySchema } from '@helpdesk/shared';
import { db } from '../db/client.js';
import { escalations, troubleshootingSessions } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { correlationId as newCorrelationId } from '../lib/ids.js';
import { requireAdmin, requireUser } from '../plugins/auth.js';
import {
  addAdminNote,
  resolveSession,
  sessionToDto,
  setSessionPaused,
  setSessionStatus,
} from '../modules/troubleshooting/engine.js';
import { addTimelineEntry, emptyState } from '../modules/troubleshooting/state.js';
import { findSession, getSessionDetail, listSessions } from '../modules/troubleshooting/queries.js';
import { recordAudit } from '../modules/audit/service.js';
import { parse } from './helpers.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions', async (request) => {
    await requireUser(request);
    const query = parse(sessionQuerySchema, request.query);
    return listSessions(query);
  });

  app.get('/api/sessions/:id', async (request) => {
    await requireUser(request);
    const { id } = parse(idParamSchema, request.params);
    const session = await getSessionDetail(id);
    if (!session) throw AppError.notFound('Session');
    return { session };
  });

  app.post('/api/sessions/:id/actions', async (request) => {
    const user = await requireAdmin(request);
    const { id } = parse(idParamSchema, request.params);
    const action = parse(adminSessionActionSchema, request.body);
    const session = await findSession(id);
    if (!session) throw AppError.notFound('Session');
    const correlationId = newCorrelationId();

    switch (action.action) {
      case 'pause':
        await setSessionPaused(session, true, action.note);
        break;
      case 'resume':
        await setSessionPaused(session, false);
        break;
      case 'resolve':
        await resolveSession({ session, actor: 'admin', correlationId, note: action.note });
        break;
      case 'close': {
        const now = new Date();
        await db
          .update(troubleshootingSessions)
          .set({ status: 'closed', closedAt: now, lastActivityAt: now })
          .where(eq(troubleshootingSessions.id, id));
        await db
          .update(escalations)
          .set({ status: 'closed', closedAt: now, updatedAt: now })
          .where(eq(escalations.sessionId, id));
        break;
      }
      case 'escalate':
        await db
          .update(troubleshootingSessions)
          .set({
            status: 'escalated',
            resolutionStatus: 'escalated',
            escalationRequired: true,
            escalatedAt: new Date(),
            lastActivityAt: new Date(),
          })
          .where(eq(troubleshootingSessions.id, id));
        await db
          .insert(escalations)
          .values({
            sessionId: id,
            reason: action.note ?? 'Manually escalated by an administrator',
            escalatedBy: 'admin',
          })
          .onConflictDoNothing();
        break;
      case 'reopen':
        await db
          .update(troubleshootingSessions)
          .set({
            status: 'in_progress',
            resolutionStatus: 'in_progress',
            escalationRequired: false,
            resolvedAt: null,
            escalatedAt: null,
            closedAt: null,
            adminPaused: false,
            lastActivityAt: new Date(),
          })
          .where(eq(troubleshootingSessions.id, id));
        break;
      case 'note':
        if (!action.note) throw AppError.validation('A note is required');
        await addAdminNote(session, action.note, user);
        break;
      case 'set_article':
        await db
          .update(troubleshootingSessions)
          .set({ pinnedArticleId: action.articleId ?? null, lastActivityAt: new Date() })
          .where(eq(troubleshootingSessions.id, id));
        break;
      case 'reset_state':
        await db
          .update(troubleshootingSessions)
          .set({ state: emptyState() as never, lastActivityAt: new Date() })
          .where(eq(troubleshootingSessions.id, id));
        break;
      case 'set_status':
        if (!action.status) throw AppError.validation('A status is required');
        await setSessionStatus({
          session,
          status: action.status,
          note: action.note,
          correlationId,
        });
        break;
    }

    await addTimelineEntry({
      sessionId: id,
      role: 'admin',
      kind: 'admin_action',
      summary:
        action.action === 'set_status'
          ? `Status changed to ${action.status}`
          : `Administrator action: ${action.action}`,
      content: action.note ?? '',
      slackUserName: user.name,
    });
    await recordAudit({
      action: `session.${action.action}`,
      entityType: 'session',
      entityId: id,
      user,
      correlationId,
      summary: action.note ?? null,
    });

    const updated = await findSession(id);
    return { session: updated ? sessionToDto(updated) : null };
  });
}
