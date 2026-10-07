import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { slackRoutes } from './slack.js';
import { authRoutes } from './auth.js';
import { sessionRoutes } from './sessions.js';
import { knowledgeRoutes } from './knowledge.js';
import { aiRoutes } from './ai.js';
import { settingsRoutes } from './settings.js';
import { analyticsRoutes } from './analytics.js';
import { userRoutes } from './users.js';
import { categorizationRoutes } from './categorization.js';
import { roleRoutes } from './roles.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(slackRoutes);
  await app.register(authRoutes);
  await app.register(sessionRoutes);
  await app.register(knowledgeRoutes);
  await app.register(aiRoutes);
  await app.register(settingsRoutes);
  await app.register(analyticsRoutes);
  await app.register(userRoutes);
  await app.register(categorizationRoutes);
  await app.register(roleRoutes);
}
