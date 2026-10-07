/**
 * Slack conversation helpers: posting threaded replies, reading threads and
 * resolving user identities.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { slackMessages, slackUsers, type SlackMessageRow } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { log } from '../logging/service.js';
import { slackCall } from './client.js';
import type { SlackMessage, SlackUserInfo } from './types.js';

export interface PostMessageInput {
  channel: string;
  /** When present the reply is threaded (§16: never a new top-level message). */
  threadTs?: string | null;
  text: string;
  blocks?: unknown[];
  correlationId?: string;
  sessionId?: string;
}

/** Posts a message and returns its Slack timestamp. */
export async function postMessage(input: PostMessageInput): Promise<string> {
  const payload: Record<string, unknown> = {
    channel: input.channel,
    text: input.text,
    unfurl_links: false,
    unfurl_media: false,
    // Lets Slack rewrite `@handle` / `#channel` text into real mention tokens
    // (e.g. `@it-report` -> `<!subteam^S…>`), which is what actually notifies
    // people. Already-formed `<@U…>` tokens are left untouched.
    link_names: true,
  };
  if (input.threadTs) payload.thread_ts = input.threadTs;
  if (input.blocks && input.blocks.length > 0) payload.blocks = input.blocks;

  const result = await slackCall<{ ts?: string }>('chat.postMessage', payload);
  const ts = result.ts ?? null;
  if (!ts) {
    throw new AppError('Slack did not return a message timestamp', { kind: 'slack_api' });
  }

  await upsertSlackMessage({
    channelId: input.channel,
    ts,
    threadTs: input.threadTs ?? ts,
    text: input.text,
    isBot: true,
  }).catch((error: unknown) => {
    log.warn({ category: 'slack', error }, 'Could not persist posted Slack message');
  });

  return ts;
}

/** Adds a small status reaction to the message that triggered the session. */
export async function addReaction(
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  try {
    await slackCall('reactions.add', { channel, timestamp, name });
  } catch (error) {
    // Cosmetic only — never fail a troubleshooting turn over a reaction.
    log.debug({ category: 'slack', error }, 'Could not add status reaction');
  }
}

export async function removeReaction(
  channel: string,
  timestamp: string,
  name: string,
): Promise<void> {
  try {
    await slackCall('reactions.remove', { channel, timestamp, name });
  } catch (error) {
    log.debug({ category: 'slack', error }, 'Could not remove reaction');
  }
}

export async function fetchMessage(channel: string, ts: string): Promise<SlackMessage | null> {
  try {
    const result = await slackCall<{ messages?: SlackMessage[] }>('conversations.history', {
      channel,
      latest: ts,
      oldest: ts,
      inclusive: true,
      limit: 1,
    });
    return result.messages?.[0] ?? null;
  } catch (error) {
    if (error instanceof AppError && error.code === 'SLACK_MESSAGE_NOT_FOUND') return null;
    throw error;
  }
}

export interface ThreadReply {
  ts: string;
  userId: string;
  text: string;
  isBot: boolean;
  files: Array<{ id: string; name: string; mimetype?: string; url_private?: string; size?: number }>;
  threadTs?: string;
  createdAt: Date;
}

/** Reads every reply in a thread (paged), oldest first. */
export async function fetchThreadReplies(
  channel: string,
  threadTs: string,
  maxMessages = 200,
): Promise<ThreadReply[]> {
  const collected: ThreadReply[] = [];
  let cursor: string | undefined;

  do {
    const result = await slackCall<{
      messages?: SlackMessage[];
      response_metadata?: { next_cursor?: string };
    }>('conversations.replies', {
      channel,
      ts: threadTs,
      limit: Math.min(200, maxMessages - collected.length),
      ...(cursor ? { cursor } : {}),
    });
    const messages = result.messages ?? [];
    for (const message of messages) {
      if (collected.length >= maxMessages) break;
      if (!message.ts) continue;
      collected.push({
        ts: message.ts,
        userId: message.user ?? message.bot_id ?? 'unknown',
        text: message.text ?? '',
        isBot: Boolean(message.bot_id) || message.subtype === 'bot_message',
        files: (message.files ?? []) as ThreadReply['files'],
        threadTs: message.thread_ts,
        createdAt: new Date(Number.parseFloat(message.ts) * 1000),
      });
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor && collected.length < maxMessages);

  return collected;
}

export async function getPermalink(channel: string, ts: string): Promise<string | null> {
  try {
    const result = await slackCall<{ permalink?: string }>('chat.getPermalink', { channel, message_ts: ts });
    return result.permalink ?? null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export interface AgentIdentity {
  userId: string;
  name: string | null;
  displayName: string | null;
  realName: string | null;
  isBot: boolean;
}

/** Resolves and caches a Slack user profile. */
export async function getAgentIdentity(userId: string): Promise<AgentIdentity> {
  const cached = await db
    .select()
    .from(slackUsers)
    .where(eq(slackUsers.slackUserId, userId))
    .limit(1);

  let profile: SlackUserInfo | null = null;
  try {
    const result = await slackCall<{ user?: SlackUserInfo }>('users.info', { user: userId, include_locale: false });
    profile = result.user ?? null;
  } catch (error) {
    log.debug({ category: 'slack', error, userId }, 'users.info failed, using cached profile');
  }

  if (!profile) {
    const existing = cached[0];
    return {
      userId,
      name: existing?.name ?? null,
      displayName: existing?.displayName ?? null,
      realName: existing?.realName ?? null,
      isBot: existing?.isBot ?? false,
    };
  }

  const [row] = await db
    .insert(slackUsers)
    .values({
      slackUserId: profile.id,
      teamId: profile.team_id ?? null,
      name: profile.name ?? null,
      realName: profile.real_name ?? profile.profile?.real_name ?? null,
      displayName: profile.profile?.display_name || null,
      email: profile.profile?.email ?? null,
      isBot: Boolean(profile.is_bot),
      timezone: profile.tz ?? null,
      raw: profile as never,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: slackUsers.slackUserId,
      set: {
        name: profile.name ?? null,
        realName: profile.real_name ?? profile.profile?.real_name ?? null,
        displayName: profile.profile?.display_name || null,
        email: profile.profile?.email ?? null,
        isBot: Boolean(profile.is_bot),
        raw: profile as never,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  const identity = row ?? cached[0];
  return {
    userId,
    name: identity?.name ?? profile.name ?? null,
    displayName: identity?.displayName ?? null,
    realName: identity?.realName ?? null,
    isBot: identity?.isBot ?? false,
  };
}

/* -------------------------------------------------------------------------- */
/* Message persistence                                                         */
/* -------------------------------------------------------------------------- */

export interface UpsertMessageInput {
  channelId: string;
  ts: string;
  threadTs?: string | null;
  text: string;
  userId?: string | null;
  userName?: string | null;
  isBot?: boolean;
  subtype?: string | null;
  permalink?: string | null;
  hasFiles?: boolean;
  sessionId?: string | null;
  raw?: unknown;
}

export async function upsertSlackMessage(input: UpsertMessageInput): Promise<SlackMessageRow> {
  const [row] = await db
    .insert(slackMessages)
    .values({
      slackMessageTs: input.ts,
      channelId: input.channelId,
      threadTs: input.threadTs ?? input.ts,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      isBot: input.isBot ?? false,
      text: input.text,
      subtype: input.subtype ?? null,
      permalink: input.permalink ?? null,
      hasFiles: input.hasFiles ?? false,
      sessionId: input.sessionId ?? null,
      raw: (input.raw ?? null) as never,
    })
    .onConflictDoUpdate({
      target: [slackMessages.channelId, slackMessages.slackMessageTs],
      set: {
        text: input.text,
        userId: input.userId ?? null,
        userName: input.userName ?? null,
        isBot: input.isBot ?? false,
        threadTs: input.threadTs ?? input.ts,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    })
    .returning();
  return row!;
}

export async function listPersistedMessages(
  channelId: string,
  threadTs: string,
  limit = 100,
): Promise<SlackMessageRow[]> {
  return db
    .select()
    .from(slackMessages)
    .where(and(eq(slackMessages.channelId, channelId), eq(slackMessages.threadTs, threadTs)))
    .orderBy(sql`${slackMessages.slackMessageTs}::double precision asc`)
    .limit(limit);
}

interface SlackUserMember {
  id: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  is_app_user?: boolean;
  profile?: { display_name?: string; real_name?: string };
}

export interface SlackUserOption {
  id: string;
  /** `@username` — what an admin can type into a settings field. */
  handle: string;
  /** Real / display name shown next to the handle. */
  name: string;
}

let userCache: { at: number; users: SlackUserOption[] } | null = null;
const USER_CACHE_MS = 5 * 60 * 1000;

/** Active workspace members, used to turn a name into a real `<@U…>` mention. */
export async function listSlackUsers(): Promise<SlackUserOption[]> {
  if (userCache && Date.now() - userCache.at < USER_CACHE_MS) return userCache.users;

  const result = await slackCall<{ ok: boolean; error?: string; members?: SlackUserMember[] }>(
    'users.list',
    { limit: 200 },
  );
  if (!result.ok || !Array.isArray(result.members)) {
    throw new AppError('Slack did not return a user list', {
      kind: 'slack_api',
      cause: result.error ?? 'users.list failed',
    });
  }

  const users = result.members
    .filter((member) => !member.deleted && !member.is_bot && !member.is_app_user)
    .map((member) => ({
      id: member.id,
      handle: `@${member.name}`,
      name:
        member.profile?.display_name || member.profile?.real_name || member.name || member.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  userCache = { at: Date.now(), users };
  return users;
}
