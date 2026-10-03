/**
 * Slack Events API dispatcher (§2, §3, §16).
 *
 * The transport layer only forwards `event_callback` envelopes here; this module
 * decides whether an event is a troubleshooting trigger, a follow-up agent
 * reply, or something we ignore.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { slackChannels } from '../../db/schema.js';
import { log } from '../logging/service.js';
import { getChannelInfo } from '../slack/client.js';
import { getSlackConfig } from '../settings/service.js';
import { onTrigger, handleAgentMessage } from '../troubleshooting/engine.js';
import type {
  AppMentionEvent,
  MessageEvent,
  ReactionAddedEvent,
  SlackEventEnvelope,
  SlackFileObject,
} from './types.js';
import { correlationId as newCorrelationId } from '../../lib/ids.js';

/** Normalises `:troubleshoot:` and `troubleshoot` to the same token. */
function normalizeEmoji(value: string): string {
  return value.replace(/:/g, '').trim().toLowerCase();
}

export async function handleSlackEvent(envelope: SlackEventEnvelope): Promise<void> {
  const correlationId = newCorrelationId();
  const event = envelope.event;

  switch (event.type) {
    case 'reaction_added':
      await handleReaction(event, envelope.team_id, correlationId);
      break;
    case 'message':
      await handleMessage(event, envelope.team_id, correlationId);
      break;
    case 'app_mention':
      await handleAppMention(event, envelope.team_id, correlationId);
      break;
    case 'file_shared':
    case 'file_change':
      // Screenshots arrive as message files; nothing to do on their own.
      log.debug({ category: 'slack', correlationId }, `Ignoring ${event.type} event`);
      break;
    default:
      log.debug(
        { category: 'slack', correlationId },
        `Ignoring unsupported event type: ${String((event as { type?: string }).type)}`,
      );
  }
}

/* -------------------------------------------------------------------------- */
/* reaction_added                                                              */
/* -------------------------------------------------------------------------- */

async function handleReaction(
  event: ReactionAddedEvent,
  teamId: string,
  correlationId: string,
): Promise<void> {
  const channelId = event.item?.channel ?? event.channel;
  const messageTs = event.item?.ts;
  if (!channelId || !messageTs || event.item?.type !== 'message') return;
  if (event.item_user && event.item_user === event.user) return;

  const config = await getSlackConfig();
  if (normalizeEmoji(event.reaction) !== normalizeEmoji(config.triggerEmoji)) return;

  await rememberChannel(channelId, teamId);

  log.info(
    {
      category: 'slack',
      channelId,
      messageTs,
      reaction: event.reaction,
      userId: event.user,
      correlationId,
    },
    'Troubleshooting trigger reaction detected',
  );

  await onTrigger({
    channelId,
    messageTs,
    agentId: event.user ?? 'unknown',
    eventId: `reaction:${channelId}:${messageTs}:${event.user ?? 'unknown'}:${event.reaction}`,
    correlationId,
    trigger: 'reaction',
  });
}

/* -------------------------------------------------------------------------- */
/* message                                                                     */
/* -------------------------------------------------------------------------- */

async function handleMessage(
  event: MessageEvent,
  teamId: string,
  correlationId: string,
): Promise<void> {
  if (!event.channel || !event.ts) return;
  // Never react to our own or other bots' messages — that would loop forever.
  if (event.bot_id || event.subtype === 'bot_message') return;

  const threadTs = event.thread_ts;
  // Only replies inside an existing thread can continue a session.
  if (!threadTs || threadTs === event.ts) return;

  const config = await getSlackConfig();
  const mentionsTriggerWord =
    config.enableMentions && /<@[A-Z0-9]+>/.test(event.text ?? '') && /troubleshoot|help/i.test(event.text ?? '');

  await rememberChannel(event.channel, teamId);

  // A mention in a thread is treated as a fresh trigger for that thread.
  if (mentionsTriggerWord) {
    await onTrigger({
      channelId: event.channel,
      messageTs: event.ts,
      threadTs,
      agentId: event.user ?? 'unknown',
      eventId: `message:${event.channel}:${event.ts}`,
      correlationId,
      text: event.text ?? '',
      files: (event.files ?? []) as SlackFileObject[],
      trigger: 'mention',
    });
    return;
  }

  await handleAgentMessage({
    channelId: event.channel,
    threadTs,
    messageTs: event.ts,
    agentId: event.user ?? 'unknown',
    text: event.text ?? '',
    files: (event.files ?? []) as SlackFileObject[],
    eventId: `message:${event.channel}:${event.ts}`,
    correlationId,
  });
}

/* -------------------------------------------------------------------------- */
/* app_mention                                                                 */
/* -------------------------------------------------------------------------- */

async function handleAppMention(
  event: AppMentionEvent,
  teamId: string,
  correlationId: string,
): Promise<void> {
  if (!event.channel || !event.ts) return;
  const config = await getSlackConfig();
  if (!config.enableMentions) {
    log.debug({ category: 'slack', correlationId }, 'Ignoring @mention (disabled in settings)');
    return;
  }

  await rememberChannel(event.channel, teamId);

  await onTrigger({
    channelId: event.channel,
    messageTs: event.ts,
    threadTs: event.thread_ts ?? event.ts,
    agentId: event.user ?? 'unknown',
    eventId: `app_mention:${event.channel}:${event.ts}`,
    correlationId,
    text: event.text ?? '',
    files: (event.files ?? []) as SlackFileObject[],
    trigger: 'mention',
  });
}

/* -------------------------------------------------------------------------- */
/* Channel bookkeeping                                                         */
/* -------------------------------------------------------------------------- */

async function rememberChannel(channelId: string, teamId: string): Promise<void> {
  try {
    const existing = await db
      .select({ id: slackChannels.id })
      .from(slackChannels)
      .where(and(eq(slackChannels.channelId, channelId)))
      .limit(1);

    if (existing.length > 0) return;

    const info = await getChannelInfo(channelId);
    await db
      .insert(slackChannels)
      .values({
        channelId,
        name: info?.name ?? '',
        isPrivate: info?.isPrivate ?? false,
      })
      .onConflictDoNothing({ target: slackChannels.channelId });

    log.debug({ category: 'slack', channelId, teamId }, 'Discovered Slack channel');
  } catch (error) {
    log.debug({ category: 'slack', channelId, error }, 'Could not remember Slack channel');
  }
}
