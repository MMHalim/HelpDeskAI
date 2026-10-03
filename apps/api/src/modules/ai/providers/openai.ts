/**
 * OpenAI provider (REST — Chat Completions API).
 *
 * Docs: https://platform.openai.com/docs/api-reference/chat
 * Any OpenAI-compatible endpoint works by changing `baseUrl`
 * (Azure-compatible gateways, OpenRouter, vLLM, Ollama, ...).
 */
import type { AiProviderId } from '@helpdesk/shared';
import { BaseAIProvider, type RequestContext } from '../base.js';
import {
  AiProviderError,
  type AiChatMessage,
  type AiRequest,
  type AiProviderResult,
  type HealthCheckResult,
  type ProviderConfig,
} from '../types.js';

type OpenAIContent = string | Array<Record<string, unknown>>;

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: OpenAIContent | null; role?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; type?: string; code?: string };
}

function toOpenAIMessages(
  system: string,
  messages: AiChatMessage[],
): Array<{ role: string; content: OpenAIContent }> {
  return [
    { role: 'system', content: system },
    ...messages.map((message) => {
      const hasImage = message.parts.some((part) => part.type === 'image');
      if (!hasImage) {
        return {
          role: message.role,
          content: message.parts
            .map((part) => (part.type === 'text' ? part.text : `[image: ${part.image.label ?? 'screenshot'}]`))
            .join('\n'),
        };
      }
      return {
        role: message.role,
        content: message.parts.map((part) =>
          part.type === 'text'
            ? { type: 'text', text: part.text }
            : {
                type: 'image_url',
                image_url: {
                  url: `data:${part.image.mimetype};base64,${part.image.data.toString('base64')}`,
                  detail: 'high',
                },
              },
        ),
      };
    }),
  ];
}

export class OpenAIProvider extends BaseAIProvider {
  readonly id: AiProviderId = 'openai';
  readonly supportsVision = true;
  readonly label: string;
  readonly model: string;

  constructor(
    readonly config: ProviderConfig,
    context: RequestContext,
  ) {
    super(context);
    this.label = config.label;
    this.model = config.model;
  }

  private get apiKey(): string {
    if (!this.config.apiKey) {
      throw new AiProviderError(this.id, 'OpenAI API key is not configured', {
        retryable: false,
        invalidRequest: true,
      });
    }
    return this.config.apiKey;
  }

  protected async send(request: AiRequest): Promise<AiProviderResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: toOpenAIMessages(request.system, request.messages),
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
      ...(request.json ? { response_format: { type: 'json_object' } } : {}),
    };

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new AiProviderError(this.id, `OpenAI request failed: ${(error as Error).message}`, {
        retryable: true,
      });
    }

    const text = await response.text();
    const latencyMs = Date.now() - started;

    if (!response.ok) throw this.toError(response.status, text);

    let payload: OpenAIResponse;
    try {
      payload = JSON.parse(text) as OpenAIResponse;
    } catch {
      throw new AiProviderError(this.id, 'OpenAI returned a non-JSON response', { retryable: true });
    }

    const content = payload.choices?.[0]?.message?.content;
    const reply =
      typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((part) => (typeof part.text === 'string' ? part.text : ''))
              .join('')
              .trim()
          : '';

    if (!reply) {
      throw new AiProviderError(this.id, 'OpenAI returned an empty response', {
        retryable: true,
        code: payload.choices?.[0]?.finish_reason ?? 'EMPTY',
      });
    }

    return {
      text: reply,
      json: undefined,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
      model: this.config.model,
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
      raw: { latencyMs },
    };
  }

  private toError(status: number, body: string): AiProviderError {
    let message = `OpenAI HTTP ${status}`;
    let code: string | undefined;
    let type: string | undefined;
    try {
      const parsed = JSON.parse(body) as OpenAIResponse;
      message = parsed.error?.message ?? message;
      code = parsed.error?.code;
      type = parsed.error?.type;
    } catch {
      message = `OpenAI HTTP ${status}: ${body.slice(0, 300)}`;
    }

    const quotaExhausted =
      status === 429 ||
      code === 'insufficient_quota' ||
      code === 'rate_limit_exceeded' ||
      type === 'insufficient_quota' ||
      /quota|rate limit|insufficient/i.test(message);

    return new AiProviderError(this.id, message, {
      status,
      code,
      retryable: quotaExhausted || status === 408 || status === 500 || status === 502 || status === 503,
      quotaExhausted,
      invalidRequest: status === 400 || status === 404,
      raw: body.slice(0, 2000),
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    if (!this.config.apiKey) {
      return { ok: false, status: 'unconfigured', latencyMs: 0, message: 'No API key stored for OpenAI', checkedAt };
    }
    const started = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      const latencyMs = Date.now() - started;
      if (response.ok) return { ok: true, status: 'healthy', latencyMs, message: null, checkedAt };
      const body = await response.text();
      return {
        ok: false,
        status: response.status === 401 ? 'unconfigured' : 'degraded',
        latencyMs,
        message: `HTTP ${response.status}: ${body.slice(0, 200)}`,
        checkedAt,
      };
    } catch (error) {
      return {
        ok: false,
        status: 'degraded',
        latencyMs: Date.now() - started,
        message: (error as Error).message,
        checkedAt,
      };
    }
  }
}
