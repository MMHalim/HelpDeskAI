/**
 * AI runner: retries, provider fallback and usage accounting (§10, §11).
 *
 * Order of execution for every AI operation:
 *   primary provider
 *     ├─ succeeds                       -> record usage, return
 *     └─ retryable / quota / 5xx
 *          ├─ retry up to `maxRetries` (exponential backoff, bounded)
 *          └─ still failing             -> fallback provider (one pass)
 *               ├─ succeeds             -> record usage with isFallback = true
 *               └─ fails                -> throw, caller posts a safe Slack error
 *
 * Every attempt is written to `ai_requests` so the dashboard can show which
 * provider actually answered, the token usage and the error trail.
 */
import type { AiOperation, AiProviderId } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { aiRequests, troubleshootingSessions } from '../../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { sleep } from '../../lib/async.js';
import { log } from '../logging/service.js';
import { markProviderResult } from './config-service.js';
import { createProvider, type RequestContext } from './registry.js';
import { AiProviderError, type AIProvider, type ProviderConfig } from './types.js';
import { getProviderConfigs } from './config-service.js';

export type RunContext = RequestContext;

export interface RunOptions {
  /** Skip providers that cannot accept images. */
  requiresVision?: boolean;
  /** Override the primary provider for this call. */
  preferProvider?: AiProviderId;
}

export interface RunOutcome<T> {
  result: T;
  provider: AiProviderId;
  model: string;
  isFallback: boolean;
  attempts: Array<{ provider: AiProviderId; model: string; success: boolean; error?: string; latencyMs: number }>;
}

export class AiRunner {
  private readonly config: ProviderConfig[];
  private readonly context: RunContext;

  constructor(configs: ProviderConfig[], context: RunContext) {
    this.config = configs;
    this.context = context;
  }

  static async create(context: RunContext): Promise<AiRunner> {
    return new AiRunner(await getProviderConfigs(), context);
  }

  /** Candidate providers in fallback order. */
  private candidates(options: RunOptions = {}): ProviderConfig[] {
    const usable = this.config.filter((config) => {
      if (!config.enabled || !config.apiKey) return false;
      if (options.requiresVision && !config.visionEnabled) return false;
      return true;
    });

    const byRole = (role: ProviderConfig['role']) =>
      usable.filter((config) => config.role === role);

    const ordered: ProviderConfig[] = [];
    const push = (config: ProviderConfig | undefined) => {
      if (config && !ordered.some((item) => item.provider === config.provider)) ordered.push(config);
    };

    if (options.preferProvider) {
      push(usable.find((config) => config.provider === options.preferProvider));
    }
    push(byRole('primary')[0]);
    push(byRole('fallback')[0]);
    for (const config of usable) push(config);

    return ordered;
  }

  async run<T>(
    operation: AiOperation,
    fn: (provider: AIProvider) => Promise<T>,
    options: RunOptions = {},
  ): Promise<RunOutcome<T>> {
    const candidates = this.candidates(options);

    if (candidates.length === 0) {
      throw new AiProviderError('openai', 'No AI provider is configured. Add an API key in Settings → AI Providers.', {
        invalidRequest: true,
        retryable: false,
      });
    }

    const attempts: RunOutcome<T>['attempts'] = [];
    const errors: AiProviderError[] = [];
    const startedAt = Date.now();

    for (const [index, config] of candidates.entries()) {
      const provider = createProvider(config, this.context);
      const maxAttempts = Math.max(1, Math.min(5, config.maxRetries + 1));

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const isFallback = index > 0;
        const attemptStart = Date.now();
        try {
          const result = await fn(provider);
          const latencyMs = Date.now() - attemptStart;
          const usedModel = provider.resolvedModel ?? config.model;
          attempts.push({ provider: config.provider, model: usedModel, success: true, latencyMs });
          await this.record({
            operation,
            provider: config.provider,
            model: usedModel,
            success: true,
            isFallback,
            attempt,
            latencyMs,
            totalLatencyMs: Date.now() - startedAt,
            usage: provider.lastUsage ?? undefined,
          });
          void markProviderResult(config.provider, 'success').catch(() => undefined);
          return { result, provider: config.provider, model: usedModel, isFallback, attempts };
        } catch (error) {
          const latencyMs = Date.now() - attemptStart;
          const providerError = this.toProviderError(error, config.provider);
          errors.push(providerError);
          attempts.push({
            provider: config.provider,
            model: config.model,
            success: false,
            error: providerError.info.message,
            latencyMs,
          });

          log.warn(
            {
              category: 'ai',
              provider: config.provider,
              model: config.model,
              operation,
              attempt,
              isFallback,
              status: providerError.info.status,
              error: providerError.info.message,
              correlationId: this.context.correlationId,
            },
            'AI provider attempt failed',
          );

          await this.record({
            operation,
            provider: config.provider,
            model: config.model,
            success: false,
            isFallback,
            attempt,
            latencyMs,
            totalLatencyMs: Date.now() - startedAt,
            error: providerError,
          });
          void markProviderResult(config.provider, 'failure', providerError.info.message).catch(() => undefined);

          const canRetry = providerError.info.retryable && attempt < maxAttempts;
          if (!canRetry) break;
          // Exponential backoff with a 4 second ceiling.
          await sleep(Math.min(4000, 500 * 2 ** (attempt - 1)));
        }
      }
    }

    log.error(
      {
        category: 'ai',
        operation,
        correlationId: this.context.correlationId,
        attempts,
      },
      'All AI providers failed',
    );

    const last = errors[errors.length - 1];
    throw new AiProviderError(last?.provider ?? 'openai', last?.info.message ?? 'All AI providers failed', {
      status: last?.info.status,
      code: last?.info.code,
      retryable: false,
      quotaExhausted: last?.info.quotaExhausted,
      invalidRequest: last?.info.invalidRequest,
    });
  }

  private toProviderError(error: unknown, provider: AiProviderId): AiProviderError {
    if (error instanceof AiProviderError) return error;
    const message = error instanceof Error ? error.message : String(error);
    // Unknown failures are treated as retryable: a transient network fault
    // should reach the fallback provider rather than fail the request.
    return new AiProviderError(provider, message, { retryable: true });
  }

  private async record(input: {
    operation: AiOperation;
    provider: AiProviderId;
    model: string;
    success: boolean;
    isFallback: boolean;
    attempt: number;
    latencyMs: number;
    totalLatencyMs: number;
    error?: AiProviderError;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }): Promise<void> {
    const config = this.config.find((item) => item.provider === input.provider);
    const inputTokens = input.usage?.inputTokens ?? 0;
    const outputTokens = input.usage?.outputTokens ?? 0;
    const estimatedCost = config
      ? (inputTokens / 1_000_000) * config.inputCostPerMillion +
        (outputTokens / 1_000_000) * config.outputCostPerMillion
      : 0;

    try {
      await db.insert(aiRequests).values({
        correlationId: this.context.correlationId,
        sessionId: this.context.sessionId ?? null,
        sessionCode: this.context.sessionCode ?? null,
        provider: input.provider,
        model: input.model,
        operation: input.operation,
        success: input.success,
        isFallback: input.isFallback,
        attempt: input.attempt,
        errorCode: input.error?.info.code ?? input.error?.info.status?.toString() ?? null,
        errorMessage: input.error?.info.message.slice(0, 2000) ?? null,
        errorKind: input.error?.info.quotaExhausted
          ? 'quota'
          : input.error?.info.invalidRequest
            ? 'invalid_request'
            : input.error
              ? 'error'
              : null,
        inputTokens,
        outputTokens,
        totalTokens: input.usage?.totalTokens ?? inputTokens + outputTokens,
        estimatedCost,
        latencyMs: input.latencyMs,
        channelId: this.context.channelId ?? null,
        threadTs: this.context.threadTs ?? null,
        slackUserId: this.context.slackUserId ?? null,
      });

      if (this.context.sessionId && input.usage) {
        await db
          .update(troubleshootingSessions)
          .set({
            totalInputTokens: sql`${troubleshootingSessions.totalInputTokens} + ${inputTokens}`,
            totalOutputTokens: sql`${troubleshootingSessions.totalOutputTokens} + ${outputTokens}`,
            totalTokens: sql`${troubleshootingSessions.totalTokens} + ${input.usage.totalTokens}`,
            estimatedCost: sql`${troubleshootingSessions.estimatedCost} + ${estimatedCost}`,
          })
          .where(eq(troubleshootingSessions.id, this.context.sessionId));
      }
    } catch (error) {
      log.error({ category: 'ai', error }, 'Failed to record AI usage');
    }
  }

  /** Records token usage for a successful call (called by the engine wrapper). */
  async attachUsage(
    provider: AiProviderId,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    context: { operation: AiOperation; latencyMs: number; isFallback: boolean },
  ): Promise<void> {
    const config = this.config.find((item) => item.provider === provider);
    const estimatedCost = config
      ? (usage.inputTokens / 1_000_000) * config.inputCostPerMillion +
        (usage.outputTokens / 1_000_000) * config.outputCostPerMillion
      : 0;

    try {
      await db.insert(aiRequests).values({
        correlationId: this.context.correlationId,
        sessionId: this.context.sessionId ?? null,
        sessionCode: this.context.sessionCode ?? null,
        provider,
        model: config?.model ?? 'unknown',
        operation: context.operation,
        success: true,
        isFallback: context.isFallback,
        attempt: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCost,
        latencyMs: context.latencyMs,
        channelId: this.context.channelId ?? null,
        threadTs: this.context.threadTs ?? null,
        slackUserId: this.context.slackUserId ?? null,
      });
      if (this.context.sessionId) {
        await db
          .update(troubleshootingSessions)
          .set({
            totalInputTokens: sql`${troubleshootingSessions.totalInputTokens} + ${usage.inputTokens}`,
            totalOutputTokens: sql`${troubleshootingSessions.totalOutputTokens} + ${usage.outputTokens}`,
            totalTokens: sql`${troubleshootingSessions.totalTokens} + ${usage.totalTokens}`,
            estimatedCost: sql`${troubleshootingSessions.estimatedCost} + ${estimatedCost}`,
          })
          .where(eq(troubleshootingSessions.id, this.context.sessionId));
      }
    } catch (error) {
      log.error({ category: 'ai', error }, 'Failed to record AI token usage');
    }
  }
}
