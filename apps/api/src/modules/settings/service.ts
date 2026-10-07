/**
 * System settings: the single source of truth for runtime configuration that
 * an administrator can change from the dashboard (Slack, troubleshooting
 * thresholds). Values are JSONB rows in `system_settings`.
 *
 * Secrets are stored in a separate, `is_secret` row, encrypted with
 * AES-256-GCM, and are never returned to the browser.
 */
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_TRIGGER_EMOJI,
  type AiProviderId,
  type SlackConfigInput,
  type TroubleshootingSettingsInput,
} from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { systemSettings } from '../../db/schema.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { maskCredential } from '../../lib/redact.js';
import { env } from '../../env.js';
import type { User } from '../../db/schema.js';

const SLACK_KEY = 'slack.config';
const SLACK_SECRETS_KEY = 'slack.secrets';
const TROUBLESHOOTING_KEY = 'troubleshooting.config';
const CACHE_TTL_MS = 5_000;

export interface SlackChannelConfig {
  channelId: string;
  name: string;
  isActive: boolean;
}

export interface SlackConfig {
  channels: SlackChannelConfig[];
  triggerEmoji: string;
  enableMentions: boolean;
  allowedUserIds: string[];
  verifySignature: boolean;
  threadOnly: boolean;
  redactSecrets: boolean;
  hasBotToken: boolean;
  hasSigningSecret: boolean;
  hasAppToken: boolean;
  botTokenPreview: string | null;
  signingSecretPreview: string | null;
  appTokenPreview: string | null;
}

export interface SlackSecrets {
  botToken: string | null;
  signingSecret: string | null;
  appToken: string | null;
}

/** The non-secret part of the Slack config that is persisted as JSONB. */
export type SlackConfigValues = Pick<
  SlackConfig,
  | 'channels'
  | 'triggerEmoji'
  | 'enableMentions'
  | 'allowedUserIds'
  | 'verifySignature'
  | 'threadOnly'
  | 'redactSecrets'
>;

export interface TroubleshootingConfig {
  maxAttempts: number;
  escalationInfoItems: string[];
  sessionStaleAfterHours: number;
  maxScreenshotsPerMessage: number;
  maxAttachmentBytes: number;
  kbMaxArticles: number;
  kbMaxSteps: number;
  escalationContact: string | null;
  itTechnicianUserId: string | null;
  escalationCcGroup: string | null;
  escalationSlaHours: number;
  escalationNotifyUserIds: string[];
}

type CacheEntry = { value: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet(key: string, value: unknown, ttl = CACHE_TTL_MS): void {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export function invalidateSettingsCache(): void {
  cache.clear();
}

async function readRow<T>(key: string): Promise<T | null> {
  const rows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return (rows[0]?.value as T) ?? null;
}

async function writeRow(
  key: string,
  value: unknown,
  options: { userId?: string | null; isSecret?: boolean; description?: string } = {},
): Promise<void> {
  await db
    .insert(systemSettings)
    .values({
      key,
      value: value as never,
      isSecret: options.isSecret ?? false,
      description: options.description,
      updatedBy: options.userId ?? null,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: value as never,
        isSecret: options.isSecret ?? false,
        updatedBy: options.userId ?? null,
        updatedAt: new Date(),
      },
    });
  invalidateSettingsCache();
}

/* -------------------------------------------------------------------------- */
/* Slack                                                                       */
/* -------------------------------------------------------------------------- */

function defaultsFromEnv(): { config: SlackConfigValues; secrets: SlackSecrets } {
  return {
    config: {
      channels: env.slack.channels.map((channelId) => ({ channelId, name: '', isActive: true })),
      triggerEmoji: env.slack.triggerEmoji || DEFAULT_TRIGGER_EMOJI,
      enableMentions: env.slack.enableMentions,
      allowedUserIds: env.slack.allowedUserIds,
      verifySignature: env.slack.verifySignature,
      threadOnly: true,
      redactSecrets: true,
    },
    secrets: {
      botToken: env.slack.botToken,
      signingSecret: env.slack.signingSecret,
      appToken: env.slack.appToken,
    },
  };
}

export async function getSlackConfig(): Promise<SlackConfig> {
  const cached = cacheGet<SlackConfig>('slack');
  if (cached) return cached;

  const defaults = defaultsFromEnv();
  const stored = await readRow<Partial<SlackConfig>>(SLACK_KEY);
  const secretsRow = await readRow<{
    botToken?: string | null;
    signingSecret?: string | null;
    appToken?: string | null;
  }>(SLACK_SECRETS_KEY);

  const secrets: SlackSecrets = {
    botToken: decryptSecret(secretsRow?.botToken ?? null) ?? defaults.secrets.botToken,
    signingSecret: decryptSecret(secretsRow?.signingSecret ?? null) ?? defaults.secrets.signingSecret,
    appToken: decryptSecret(secretsRow?.appToken ?? null) ?? defaults.secrets.appToken,
  };

  const merged: SlackConfig = {
    channels: stored?.channels ?? defaults.config.channels,
    triggerEmoji: stored?.triggerEmoji ?? defaults.config.triggerEmoji,
    enableMentions: stored?.enableMentions ?? defaults.config.enableMentions,
    allowedUserIds: stored?.allowedUserIds ?? defaults.config.allowedUserIds,
    verifySignature: stored?.verifySignature ?? defaults.config.verifySignature,
    threadOnly: stored?.threadOnly ?? defaults.config.threadOnly,
    redactSecrets: stored?.redactSecrets ?? defaults.config.redactSecrets,
    hasBotToken: Boolean(secrets.botToken),
    hasSigningSecret: Boolean(secrets.signingSecret),
    hasAppToken: Boolean(secrets.appToken),
    botTokenPreview: maskCredential(secrets.botToken),
    signingSecretPreview: maskCredential(secrets.signingSecret),
    appTokenPreview: maskCredential(secrets.appToken),
  };

  cacheSet('slack', merged);
  return merged;
}

export async function getSlackSecrets(): Promise<SlackSecrets> {
  await getSlackConfig(); // ensures cache warm
  const row = await readRow<{
    botToken?: string | null;
    signingSecret?: string | null;
    appToken?: string | null;
  }>(SLACK_SECRETS_KEY);
  const defaults = defaultsFromEnv();
  return {
    botToken: decryptSecret(row?.botToken ?? null) ?? defaults.secrets.botToken,
    signingSecret: decryptSecret(row?.signingSecret ?? null) ?? defaults.secrets.signingSecret,
    appToken: decryptSecret(row?.appToken ?? null) ?? defaults.secrets.appToken,
  };
}

export async function updateSlackConfig(
  input: SlackConfigInput,
  user: Pick<User, 'id' | 'email'> | null,
): Promise<SlackConfig> {
  const current = await getSlackConfig();
  const currentSecrets = await getSlackSecrets();

  const next: SlackConfigValues = {
    channels: input.channels.map((c) => ({
      channelId: c.channelId,
      name: c.name ?? '',
      isActive: c.isActive,
    })),
    triggerEmoji: input.triggerEmoji || current.triggerEmoji || DEFAULT_TRIGGER_EMOJI,
    enableMentions: input.enableMentions,
    allowedUserIds: input.allowedUserIds,
    verifySignature: input.verifySignature,
    threadOnly: input.threadOnly,
    redactSecrets: input.redactSecrets,
  };

  if (!input.verifySignature && env.isProduction) {
    throw AppError.configuration('Signature verification cannot be disabled in production.');
  }

  await writeRow(SLACK_KEY, next, { userId: user?.id ?? null, description: 'Slack integration settings' });

  const encode = (value: string | null | undefined): string | null =>
    value ? JSON.stringify(encryptSecret(value)) : null;

  const secrets = {
    botToken: encode(input.botToken?.trim() || currentSecrets.botToken),
    signingSecret: encode(input.signingSecret?.trim() || currentSecrets.signingSecret),
    appToken: encode(input.appToken?.trim() || currentSecrets.appToken),
  };

  await writeRow(SLACK_SECRETS_KEY, secrets, {
    userId: user?.id ?? null,
    isSecret: true,
    description: 'Slack credentials (encrypted)',
  });

  invalidateSettingsCache();
  return getSlackConfig();
}

export async function isChannelAllowed(channelId: string): Promise<boolean> {
  const config = await getSlackConfig();
  const entry = config.channels.find((c) => c.channelId === channelId);
  return Boolean(entry?.isActive);
}

export async function isUserAllowed(slackUserId: string): Promise<boolean> {
  const config = await getSlackConfig();
  if (config.allowedUserIds.length === 0) return true;
  return config.allowedUserIds.includes(slackUserId);
}

export async function getTriggerEmoji(): Promise<string> {
  const config = await getSlackConfig();
  return config.triggerEmoji;
}

/* -------------------------------------------------------------------------- */
/* Troubleshooting                                                             */
/* -------------------------------------------------------------------------- */

export function defaultTroubleshootingConfig(): TroubleshootingConfig {
  return {
    maxAttempts: env.troubleshooting.maxAttempts,
    escalationInfoItems: env.troubleshooting.escalationInfoItems,
    sessionStaleAfterHours: env.troubleshooting.sessionStaleAfterHours,
    maxScreenshotsPerMessage: env.troubleshooting.maxScreenshotsPerMessage,
    maxAttachmentBytes: env.troubleshooting.maxAttachmentBytes,
    kbMaxArticles: env.troubleshooting.kbMaxArticles,
    kbMaxSteps: env.troubleshooting.kbMaxSteps,
    escalationContact: null,
    escalationNotifyUserIds: [],
    itTechnicianUserId: null,
    escalationCcGroup: null,
    escalationSlaHours: 24,
  };
}

export async function getTroubleshootingConfig(): Promise<TroubleshootingConfig> {
  const cached = cacheGet<TroubleshootingConfig>('troubleshooting');
  if (cached) return cached;
  const stored = await readRow<Partial<TroubleshootingConfig>>(TROUBLESHOOTING_KEY);
  const merged = { ...defaultTroubleshootingConfig(), ...(stored ?? {}) };
  cacheSet('troubleshooting', merged);
  return merged;
}

export async function updateTroubleshootingConfig(
  input: TroubleshootingSettingsInput,
  user: Pick<User, 'id' | 'email'> | null,
): Promise<TroubleshootingConfig> {
  const current = await getTroubleshootingConfig();
  const next: TroubleshootingConfig = {
    ...current,
    ...input,
    // `nullish()` inputs arrive as `undefined` when omitted, so treat an absent
    // key as "leave as is" and an explicit `null` as "clear".
    itTechnicianUserId: Object.hasOwn(input, 'itTechnicianUserId')
      ? (input.itTechnicianUserId ?? null)
      : current.itTechnicianUserId,
    escalationCcGroup: Object.hasOwn(input, 'escalationCcGroup')
      ? (input.escalationCcGroup ?? null)
      : current.escalationCcGroup,
  };
  await writeRow(TROUBLESHOOTING_KEY, next, {
    userId: user?.id ?? null,
    description: 'Troubleshooting engine thresholds',
  });
  invalidateSettingsCache();
  return getTroubleshootingConfig();
}

/* -------------------------------------------------------------------------- */
/* Generic accessors used by other modules                                    */
/* -------------------------------------------------------------------------- */

export async function getAiDefaults(): Promise<{ primaryProvider: AiProviderId; fallbackProvider: AiProviderId | null }> {
  const row = await readRow<{ primaryProvider: AiProviderId; fallbackProvider: AiProviderId | null }>('ai.defaults');
  return (
    row ?? {
      primaryProvider: env.ai.primaryProvider,
      fallbackProvider: env.ai.fallbackProvider,
    }
  );
}

export async function setAiDefaults(
  value: { primaryProvider: AiProviderId; fallbackProvider: AiProviderId | null },
  userId: string | null,
): Promise<void> {
  await writeRow('ai.defaults', value, { userId, description: 'AI provider routing' });
}

export async function getSystemFlags(): Promise<Record<string, unknown>> {
  return (await readRow<Record<string, unknown>>('system.config')) ?? {};
}

export async function setSystemFlags(
  patch: Record<string, unknown>,
  userId: string | null,
): Promise<Record<string, unknown>> {
  const next = { ...(await getSystemFlags()), ...patch };
  await writeRow('system.config', next, { userId, description: 'System flags' });
  return next;
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(systemSettings).where(and(eq(systemSettings.key, key)));
  invalidateSettingsCache();
}
