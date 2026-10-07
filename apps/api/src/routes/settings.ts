import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { slackConfigInputSchema, troubleshootingSettingsInputSchema } from '@helpdesk/shared';
import type { SlackConfigDto, SystemSettingsDto } from '@helpdesk/shared';
import { db } from '../db/client.js';
import { slackChannels, troubleshootingSessions } from '../db/schema.js';
import { env } from '../env.js';
import { requireAdmin, requireUser } from '../plugins/auth.js';
import { listSlackUsers } from '../modules/slack/service.js';
import { parse } from './helpers.js';
import {
  getAiDefaults,
  getSlackConfig,
  getSystemFlags,
  getTroubleshootingConfig,
  setSystemFlags,
  updateSlackConfig,
  updateTroubleshootingConfig,
} from '../modules/settings/service.js';

const startedAt = new Date().toISOString();

async function buildSlackDto(): Promise<SlackConfigDto> {
  const config = await getSlackConfig();
  const [rows, counts] = await Promise.all([
    db.select().from(slackChannels).orderBy(slackChannels.createdAt),
    db
      .select({ channelId: troubleshootingSessions.channelId, count: sql<number>`count(*)::int` })
      .from(troubleshootingSessions)
      .groupBy(troubleshootingSessions.channelId),
  ]);
  const countMap = new Map(counts.map((row) => [row.channelId, row.count]));
  const stored = new Map(config.channels.map((channel) => [channel.channelId, channel]));

  const channels = rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    name: row.name || stored.get(row.channelId)?.name || row.channelId,
    isActive: stored.get(row.channelId)?.isActive ?? row.isActive,
    createdAt: row.createdAt.toISOString(),
    lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
    sessionCount: countMap.get(row.channelId) ?? 0,
  }));

  for (const channel of config.channels) {
    if (!channels.some((row) => row.channelId === channel.channelId)) {
      channels.push({
        id: channel.channelId,
        channelId: channel.channelId,
        name: channel.name || channel.channelId,
        isActive: channel.isActive,
        createdAt: new Date(0).toISOString(),
        lastTriggeredAt: null,
        sessionCount: countMap.get(channel.channelId) ?? 0,
      });
    }
  }

  return {
    hasBotToken: config.hasBotToken,
    botTokenPreview: config.botTokenPreview,
    hasSigningSecret: config.hasSigningSecret,
    signingSecretPreview: config.signingSecretPreview,
    hasAppToken: config.hasAppToken,
    appTokenPreview: config.appTokenPreview,
    channels,
    triggerEmoji: config.triggerEmoji,
    enableMentions: config.enableMentions,
    allowedUserIds: config.allowedUserIds,
    verifySignature: config.verifySignature,
    threadOnly: config.threadOnly,
    redactSecrets: config.redactSecrets,
    connected: config.hasBotToken && config.hasSigningSecret,
    workspaceName: null,
    botId: null,
    teamId: null,
    lastVerifiedAt: null,
    lastError: null,
    events: { subscribed: ['reaction_added', 'message.channels', 'message.groups', 'app_mention'], missing: [] },
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async (request) => {
    await requireUser(request);
    const [troubleshooting, ai, slack] = await Promise.all([
      getTroubleshootingConfig(),
      getAiDefaults(),
      buildSlackDto(),
    ]);
    const settings: SystemSettingsDto = {
      troubleshooting,
      ai,
      slack,
      environment: {
        nodeEnv: env.NODE_ENV,
        logLevel: env.LOG_LEVEL,
        fileStorage: env.FILE_STORAGE,
        version: '1.0.0',
        startedAt,
      },
    };
    return { settings };
  });

  app.put('/api/settings/slack', async (request) => {
    const user = await requireAdmin(request);
    const input = parse(slackConfigInputSchema, request.body);
    await updateSlackConfig(input, user);
    return { slack: await buildSlackDto() };
  });

  app.put('/api/settings/troubleshooting', async (request) => {
    const user = await requireAdmin(request);
    const input = parse(troubleshootingSettingsInputSchema, request.body);
    const troubleshooting = await updateTroubleshootingConfig(input, user);
    return { troubleshooting };
  });

  app.get('/api/settings/flags', async (request) => {
    await requireUser(request);
    return { flags: await getSystemFlags() };
  });

  // Workspace members, so the escalation technician field can offer real
  // handles/IDs instead of asking an admin to hunt for a Slack user ID.
  app.get('/api/slack/users', async (request) => {
    await requireUser(request);
    return { users: await listSlackUsers() };
  });

  app.put('/api/settings/flags', async (request) => {
    const user = await requireAdmin(request);
    const flags = (request.body ?? {}) as Record<string, unknown>;
    await setSystemFlags(flags, user.id);
    return { flags: await getSystemFlags() };
  });
}
