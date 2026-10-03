/**
 * Slack Web API client wrapper.
 *
 * Wraps `@slack/web-api` with:
 *  - lazy token resolution (database first, environment as fallback),
 *  - a per-process cache so the token is not decrypted on every call,
 *  - error normalisation into `AppError`s,
 *  - a tiny in-memory rate limiter that respects Slack's `Retry-After`.
 */
import { WebClient } from '@slack/web-api';
import { AppError, errorMessage } from '../../lib/errors.js';
import { log } from '../logging/service.js';
import { getSlackSecrets } from '../settings/service.js';

/** Loose shape covering the fields we inspect on Slack Web API failures. */
interface SlackErrorLike {
  data?: { error?: string };
  code?: string;
  message?: string;
  headers?: { get?(name: string): string | null };
}

let client: WebClient | null = null;
let cachedToken: string | null = null;
let tokenLoadedAt = 0;
const TOKEN_TTL_MS = 60_000;

const throttleUntil = new Map<string, number>();

export async function getSlackClient(): Promise<WebClient> {
  const now = Date.now();
  if (client && cachedToken && now - tokenLoadedAt < TOKEN_TTL_MS) return client;

  const { botToken } = await getSlackSecrets();
  if (!botToken) {
    throw AppError.configuration(
      'No Slack bot token configured. Add it in Settings → Slack configuration (or set SLACK_BOT_TOKEN).',
    );
  }
  if (cachedToken !== botToken || !client) {
    client = new WebClient(botToken, {
      headers: { 'User-Agent': 'HelpDeskAI/1.0 (+troubleshooting-bot)' },
    });
    cachedToken = botToken;
  }
  tokenLoadedAt = now;
  return client;
}

export function resetSlackClient(): void {
  client = null;
  cachedToken = null;
  tokenLoadedAt = 0;
}

function isRateLimited(error: SlackErrorLike): boolean {
  return error.data?.error === 'ratelimited' || error.code === 'slack_webapi_rate_limited_error';
}

function delayFor(error: SlackErrorLike): number {
  const retryAfter = error.headers?.get?.('retry-after');
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : 1;
  return Math.min(30, Math.max(1, Number.isFinite(seconds) ? seconds : 1)) * 1000;
}

export interface SlackCallOptions {
  method: string;
  /** Logical operation name used in logs, e.g. `chat.postMessage`. */
  operation?: string;
  correlationId?: string;
  sessionId?: string;
  /** Suppress the error log for optional/best-effort calls (e.g. channel name enrichment). */
  quiet?: boolean;
}

/**
 * Single entry point for every Slack Web API call.
 * Throws `AppError` (kind `slack_api`) with a message safe to log.
 */
export async function slackCall<T = Record<string, unknown>>(
  method: string,
  payload: Record<string, unknown> = {},
  options: SlackCallOptions = { method },
): Promise<T & { ok: boolean }> {
  const key = method;
  const wait = throttleUntil.get(key) ?? 0;
  if (wait > Date.now()) {
    await new Promise((resolve) => setTimeout(resolve, wait - Date.now()));
  }

  const slack = await getSlackClient();
  const attempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = (await slack.apiCall(method, payload)) as T & { ok: boolean };
      throttleUntil.delete(key);
      return result;
    } catch (error) {
      lastError = error;
      if (isRateLimited(error as SlackErrorLike)) {
        const pause = delayFor(error as SlackErrorLike);
        throttleUntil.set(key, Date.now() + pause);
        log.warn(
          { category: 'slack', method, attempt, pause },
          'Slack rate limited, backing off',
        );
        await new Promise((resolve) => setTimeout(resolve, pause));
        continue;
      }
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        continue;
      }
      break;
    }
  }

  const slackError = lastError as SlackErrorLike | undefined;
  const dataError = slackError?.data?.error;
  if (!options.quiet) {
    log.error(
      {
        category: 'slack',
        method,
        error: errorMessage(lastError),
        slackError: dataError,
        correlationId: options.correlationId,
      },
      `Slack API call failed: ${options.operation ?? method}`,
    );
  }

  if (dataError === 'not_in_channel' || dataError === 'is_archived' || dataError === 'channel_not_found') {
    throw new AppError(`The bot cannot post in this channel (${dataError}). Add the bot to the channel.`, {
      kind: 'slack_api',
      userMessage:
        'I could not reply in this channel. Please add the troubleshooting bot to the channel, or contact IT.',
      code: 'SLACK_CHANNEL_ACCESS',
    });
  }
  if (dataError === 'message_not_found') {
    throw new AppError('The Slack message could not be found (it may have been deleted).', {
      kind: 'slack_api',
      userMessage: 'I could not find the original message. Please repost the issue with the 🔧 reaction.',
      code: 'SLACK_MESSAGE_NOT_FOUND',
    });
  }

  throw new AppError(`Slack API error${dataError ? `: ${dataError}` : ''}`, {
    kind: 'slack_api',
    cause: lastError,
    code: 'SLACK_API_ERROR',
  });
}

/* -------------------------------------------------------------------------- */
/* Convenience wrappers                                                        */
/* -------------------------------------------------------------------------- */

export interface AuthTestResult {
  ok: boolean;
  userId: string | null;
  teamId: string | null;
  team: string | null;
  botId: string | null;
  error: string | null;
}

export async function authTest(): Promise<AuthTestResult> {
  try {
    const slack = await getSlackClient();
    const result = (await slack.auth.test()) as { user_id?: string; team_id?: string; team?: string; bot_id?: string };
    return {
      ok: true,
      userId: result.user_id ?? null,
      teamId: result.team_id ?? null,
      team: result.team ?? null,
      botId: result.bot_id ?? null,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      userId: null,
      teamId: null,
      team: null,
      botId: null,
      error: errorMessage(error),
    };
  }
}

export interface ReactionName {
  name: string;
  count: number;
  users: string[];
}

export async function getReactions(
  channel: string,
  timestamp: string,
): Promise<ReactionName[]> {
  const result = await slackCall<{ message?: { reactions?: ReactionName[] } }>('reactions.get', {
    channel,
    timestamp,
    full: true,
  });
  return result.message?.reactions ?? [];
}

export interface SlackChannelInfo {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

export async function getChannelInfo(channel: string): Promise<SlackChannelInfo | null> {
  try {
    const result = await slackCall<{
      channel: { id: string; name?: string; is_private?: boolean; is_member?: boolean };
    }>('conversations.info', { channel }, { method: 'conversations.info', quiet: true });
    const ch = result.channel;
    return {
      id: ch.id,
      name: ch.name ?? ch.id,
      isPrivate: Boolean(ch.is_private),
      isMember: ch.is_member !== false,
    };
  } catch {
    return null;
  }
}
