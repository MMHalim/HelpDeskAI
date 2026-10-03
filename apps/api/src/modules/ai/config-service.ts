/**
 * AI provider configuration and instructions (§8, §9, §10).
 *
 * API keys are stored AES-256-GCM encrypted; the API layer decrypts them only
 * when a request is about to be sent, and never returns them to the browser.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  DEFAULT_AI_INSTRUCTIONS,
  PROVIDER_META,
  type AiInstructionsDto,
  type AiProviderConfigInput,
  type AiProviderDto,
  type AiProviderId,
  type AiProviderUpdateInput,
} from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { aiInstructions, aiProviders, aiRequests, users as usersTable, type AiProviderRow } from '../../db/schema.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { env } from '../../env.js';
import { recordAudit } from '../audit/service.js';
import { getAiDefaults, setAiDefaults } from '../settings/service.js';
import type { User } from '../../db/schema.js';
import type { ProviderConfig } from './types.js';

const CONFIG_TTL_MS = 5_000;
let cached: { at: number; configs: ProviderConfig[] } | null = null;

function envFallback(provider: AiProviderId): ProviderConfig {
  const meta = PROVIDER_META[provider];
  const fromEnv = provider === 'gemini' ? env.ai.gemini : env.ai.openai;
  return {
    provider,
    label: meta.label,
    model: fromEnv.model,
    apiKey: fromEnv.apiKey,
    baseUrl: fromEnv.baseUrl,
    temperature: 0.2,
    maxOutputTokens: 2048,
    maxRetries: 2,
    timeoutMs: 90_000,
    visionEnabled: true,
    role: 'primary',
    enabled: true,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
  };
}

function rowToConfig(
  row: AiProviderRow,
  defaults: { primaryProvider: AiProviderId; fallbackProvider: AiProviderId | null },
): ProviderConfig {
  let apiKey: string | null = null;
  try {
    apiKey = decryptSecret(row.apiKeyEncrypted);
  } catch {
    // A key encrypted with a different master key must not break the dashboard.
    apiKey = null;
  }
  const meta = PROVIDER_META[row.provider];
  const envConfig = envFallback(row.provider);

  return {
    provider: row.provider,
    label: row.label || meta.label,
    model: row.model,
    apiKey: apiKey ?? (row.apiKeyEncrypted ? null : envConfig.apiKey),
    baseUrl: row.baseUrl ?? envConfig.baseUrl,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    maxRetries: row.maxRetries,
    timeoutMs: row.timeoutMs,
    visionEnabled: row.visionEnabled,
    role: row.role,
    enabled: row.enabled,
    inputCostPerMillion: row.inputCostPerMillion,
    outputCostPerMillion: row.outputCostPerMillion,
    // The routing flags in `ai.defaults` win over the per-row role.
    ...(row.provider === defaults.primaryProvider ? { role: 'primary' as const } : {}),
    ...(defaults.fallbackProvider &&
    row.provider === defaults.fallbackProvider &&
    row.provider !== defaults.primaryProvider
      ? { role: 'fallback' as const }
      : {}),
  };
}

export async function getProviderConfigs(): Promise<ProviderConfig[]> {
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.configs;

  const defaults = await getAiDefaults();
  const rows = await db.select().from(aiProviders);
  const configs = rows.map((row) => rowToConfig(row, defaults));

  // A provider that only exists in the environment is still usable.
  for (const provider of ['gemini', 'openai'] as AiProviderId[]) {
    if (!configs.some((config) => config.provider === provider)) {
      const fallback = envFallback(provider);
      configs.push({
        ...fallback,
        role:
          provider === defaults.primaryProvider
            ? 'primary'
            : defaults.fallbackProvider === provider
              ? 'fallback'
              : 'disabled',
        enabled: Boolean(fallback.apiKey),
      });
    }
  }

  cached = { at: Date.now(), configs };
  return configs;
}

export function invalidateProviderCache(): void {
  cached = null;
}

export function toProviderDto(config: ProviderConfig, updatedAt: Date | null): AiProviderDto {
  return {
    provider: config.provider,
    label: config.label,
    role: config.role,
    enabled: config.enabled,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    apiKeyPreview: config.apiKey ? `${config.apiKey.slice(0, 6)}…${config.apiKey.slice(-4)}` : null,
    baseUrl: config.baseUrl,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    visionEnabled: config.visionEnabled,
    inputCostPerMillion: config.inputCostPerMillion,
    outputCostPerMillion: config.outputCostPerMillion,
    updatedAt: updatedAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

export async function listProviderDtos(): Promise<AiProviderDto[]> {
  const configs = await getProviderConfigs();
  const rows = await db
    .select({ provider: aiProviders.provider, updatedAt: aiProviders.updatedAt })
    .from(aiProviders);
  const updatedMap = new Map(rows.map((row) => [row.provider, row.updatedAt]));
  return configs.map((config) => toProviderDto(config, updatedMap.get(config.provider) ?? null));
}

export async function updateProviderConfigs(
  input: AiProviderUpdateInput,
  user: Pick<User, 'id' | 'email'>,
): Promise<AiProviderDto[]> {
  const before = await listProviderDtos();

  for (const provider of input.providers) {
    await upsertProvider(provider, user.id);
  }

  if (input.primaryProvider) {
    const primary = input.providers.find((p) => p.provider === input.primaryProvider);
    await setAiDefaults(
      { primaryProvider: input.primaryProvider, fallbackProvider: input.fallbackProvider ?? null },
      user.id,
    );
    if (primary) await db.update(aiProviders).set({ role: 'primary', enabled: true }).where(eq(aiProviders.provider, input.primaryProvider));
  } else if (input.fallbackProvider !== undefined) {
    const current = await getAiDefaults();
    await setAiDefaults(
      { primaryProvider: current.primaryProvider, fallbackProvider: input.fallbackProvider },
      user.id,
    );
  }

  // Exactly one primary, at most one fallback.
  if (input.primaryProvider) {
    await db
      .update(aiProviders)
      .set({ role: 'fallback' })
      .where(
        and(
          eq(aiProviders.role, 'primary'),
          sql`${aiProviders.provider} <> ${input.primaryProvider}`,
        ),
      );
  }
  if (input.fallbackProvider) {
    await db
      .update(aiProviders)
      .set({ role: 'fallback' })
      .where(eq(aiProviders.provider, input.fallbackProvider));
    await db
      .update(aiProviders)
      .set({ role: 'disabled' })
      .where(
        and(
          sql`${aiProviders.provider} <> ${input.fallbackProvider}`,
          sql`${aiProviders.provider} <> ${input.primaryProvider}`,
          eq(aiProviders.role, 'fallback'),
        ),
      );
  }

  invalidateProviderCache();
  const after = await listProviderDtos();
  await recordAudit({
    user,
    action: 'ai.providers.update',
    entityType: 'ai_provider',
    summary: `Provider routing updated (primary: ${input.primaryProvider ?? 'unchanged'})`,
    before,
    after,
  });
  return after;
}

async function upsertProvider(input: AiProviderConfigInput, userId: string): Promise<void> {
  const meta = PROVIDER_META[input.provider];
  const existing = await db
    .select({ id: aiProviders.id, apiKeyEncrypted: aiProviders.apiKeyEncrypted })
    .from(aiProviders)
    .where(eq(aiProviders.provider, input.provider))
    .limit(1);

  const apiKeyEncrypted = input.apiKey?.trim()
    ? JSON.stringify(encryptSecret(input.apiKey.trim()))
    : (existing[0]?.apiKeyEncrypted ?? null);

  const values = {
    provider: input.provider,
    label: input.label?.trim() || meta.label,
    role: input.role,
    enabled: input.enabled,
    model: input.model,
    apiKeyEncrypted,
    apiKeyPreview: input.apiKey?.trim()
      ? `${input.apiKey.trim().slice(0, 6)}…${input.apiKey.trim().slice(-4)}`
      : null,
    baseUrl: input.baseUrl ?? meta.defaultBaseUrl,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: input.maxRetries,
    timeoutMs: input.timeoutMs,
    visionEnabled: input.visionEnabled,
    inputCostPerMillion: input.inputCostPerMillion,
    outputCostPerMillion: input.outputCostPerMillion,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(aiProviders)
      .set(values)
      .where(eq(aiProviders.id, existing[0].id));
  } else {
    await db.insert(aiProviders).values(values);
  }
}

export async function deleteProviderKey(provider: AiProviderId): Promise<void> {
  await db
    .update(aiProviders)
    .set({ apiKeyEncrypted: null, apiKeyPreview: null, updatedAt: new Date() })
    .where(eq(aiProviders.provider, provider));
  invalidateProviderCache();
  await recordAudit({
    action: 'ai.provider.key.delete',
    entityType: 'ai_provider',
    entityId: provider,
    summary: `API key removed for ${provider}`,
  });
}

/* -------------------------------------------------------------------------- */
/* Health / usage aggregation                                                  */
/* -------------------------------------------------------------------------- */

export interface ProviderHealthRow extends AiProviderDto {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbacksUsed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  configured: boolean;
  status: 'healthy' | 'degraded' | 'unconfigured' | 'disabled' | 'unknown';
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getProviderHealth(days = 30): Promise<ProviderHealthRow[]> {
  const configs = await getProviderConfigs();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      provider: aiRequests.provider,
      model: aiRequests.model,
      requests: sql<number>`count(*)::int`,
      successful: sql<number>`count(*) filter (where ${aiRequests.success})::int`,
      failed: sql<number>`count(*) filter (where not ${aiRequests.success})::int`,
      fallbacks: sql<number>`count(*) filter (where ${aiRequests.isFallback})::int`,
      inputTokens: sql<number>`coalesce(sum(${aiRequests.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiRequests.outputTokens}), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(${aiRequests.totalTokens}), 0)::int`,
      cost: sql<number>`coalesce(sum(${aiRequests.estimatedCost}), 0)`,
      avgLatency: sql<number | null>`avg(${aiRequests.latencyMs})`,
      lastError: sql<string | null>`(array_agg(${aiRequests.errorMessage} order by ${aiRequests.createdAt} desc) filter (where ${aiRequests.errorMessage} is not null))[1]`,
      lastErrorAt: sql<Date | null>`max(${aiRequests.createdAt}) filter (where ${aiRequests.errorMessage} is not null)`,
      lastSuccessAt: sql<Date | null>`max(${aiRequests.createdAt}) filter (where ${aiRequests.success})`,
    })
    .from(aiRequests)
    .where(gte(aiRequests.createdAt, since))
    .groupBy(aiRequests.provider, aiRequests.model);

  const storeRows = await db.select().from(aiProviders);
  const storeMap = new Map(storeRows.map((row) => [row.provider, row]));

  return configs.map((config) => {
    const usage = rows.find((row) => row.provider === config.provider);
    const store = storeMap.get(config.provider);
    const requests = usage?.requests ?? 0;
    const successful = usage?.successful ?? 0;
    const failed = usage?.failed ?? 0;
    const configured = Boolean(config.apiKey);

    let status: ProviderHealthRow['status'];
    if (!config.enabled) status = 'disabled';
    else if (!configured) status = 'unconfigured';
    else if (requests === 0) status = 'unknown';
    else if (failed > 0 && successful === 0) status = 'degraded';
    else status = 'healthy';

    return {
      ...toProviderDto(config, store?.updatedAt ?? null),
      requests,
      successfulRequests: successful,
      failedRequests: failed,
      fallbacksUsed: usage?.fallbacks ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      estimatedCost: Number(usage?.cost ?? 0),
      successRate: requests > 0 ? successful / requests : null,
      avgLatencyMs: usage?.avgLatency === null || usage?.avgLatency === undefined ? null : Math.round(usage.avgLatency),
      lastError: usage?.lastError ?? null,
      lastErrorAt: toIsoString(usage?.lastErrorAt),
      lastSuccessAt: toIsoString(usage?.lastSuccessAt),
      configured,
      status,
    };
  });
}

export async function markProviderResult(
  provider: AiProviderId,
  result: 'success' | 'failure',
  error?: string,
): Promise<void> {
  await db
    .update(aiProviders)
    .set({
      lastCheckedAt: new Date(),
      lastError: result === 'failure' ? (error ?? 'Unknown error') : null,
      lastSuccessAt: result === 'success' ? new Date() : undefined,
    })
    .where(eq(aiProviders.provider, provider));
}

/* -------------------------------------------------------------------------- */
/* AI instructions                                                             */
/* -------------------------------------------------------------------------- */

export async function getActiveInstructions(): Promise<string> {
  const rows = await db
    .select({ content: aiInstructions.content })
    .from(aiInstructions)
    .where(eq(aiInstructions.isActive, true))
    .orderBy(desc(aiInstructions.version))
    .limit(1);
  return rows[0]?.content ?? DEFAULT_AI_INSTRUCTIONS;
}

export async function getInstructionsDto(): Promise<AiInstructionsDto> {
  const rows = await db.select().from(aiInstructions).orderBy(desc(aiInstructions.version)).limit(20);
  const active = rows.find((row) => row.isActive) ?? null;
  const users = await db
    .select({ id: aiInstructions.updatedBy, name: sql<string | null>`coalesce(${usersTable.name}, '')` })
    .from(aiInstructions)
    .leftJoin(usersTable, eq(aiInstructions.updatedBy, usersTable.id));

  const nameMap = new Map(users.map((row) => [row.id, row.name || null]));

  if (!active) {
    return {
      id: '',
      content: DEFAULT_AI_INSTRUCTIONS,
      version: 0,
      isActive: true,
      changeNote: null,
      updatedByName: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      history: [],
    };
  }

  return {
    id: active.id,
    content: active.content,
    version: active.version,
    isActive: active.isActive,
    changeNote: active.changeNote,
    updatedByName: active.updatedBy ? (nameMap.get(active.updatedBy) ?? null) : null,
    createdAt: active.createdAt.toISOString(),
    updatedAt: active.updatedAt.toISOString(),
    history: rows.map((row) => ({
      id: row.id,
      version: row.version,
      changeNote: row.changeNote,
      isActive: row.isActive,
      updatedByName: row.updatedBy ? (nameMap.get(row.updatedBy) ?? null) : null,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}

export async function updateInstructions(
  content: string,
  changeNote: string | undefined,
  activate: boolean,
  user: Pick<User, 'id' | 'email'>,
): Promise<AiInstructionsDto> {
  const rows = await db
    .select({ max: sql<number>`coalesce(max(${aiInstructions.version}), 0)::int` })
    .from(aiInstructions);
  const nextVersion = (rows[0]?.max ?? 0) + 1;

  const [created] = await db
    .insert(aiInstructions)
    .values({
      content,
      version: nextVersion,
      isActive: activate,
      changeNote: changeNote ?? null,
      updatedBy: user.id,
    })
    .returning();

  if (activate) {
    await db
      .update(aiInstructions)
      .set({ isActive: false })
      .where(and(eq(aiInstructions.isActive, true), sql`${aiInstructions.id} <> ${created!.id}`));
  }

  if (!created) throw AppError.internal('Failed to save AI instructions');
  await recordAudit({
    user,
    action: 'ai.instructions.update',
    entityType: 'ai_instructions',
    entityId: created.id,
    summary: `AI instructions v${nextVersion} saved${activate ? ' and activated' : ''}`,
    before: { version: nextVersion - 1 },
    after: { version: nextVersion, activate, changeNote: changeNote ?? null },
  });
  return getInstructionsDto();
}
