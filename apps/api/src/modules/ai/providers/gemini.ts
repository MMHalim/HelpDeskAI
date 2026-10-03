/**
 * Google Gemini provider (REST — Generative Language API `generateContent`).
 *
 * Docs: https://ai.google.dev/api/generate-content
 * Adding a new provider only requires implementing `chat()` + `healthCheck()`.
 */
import type { AiProviderId } from '@helpdesk/shared';
import { BaseAIProvider, type RequestContext } from '../base.js';
import {
  AiProviderError,
  type AiRequest,
  type AiProviderResult,
  type HealthCheckResult,
  type ProviderConfig,
} from '../types.js';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

export class GeminiProvider extends BaseAIProvider {
  readonly id: AiProviderId = 'gemini';
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
      throw new AiProviderError(this.id, 'Gemini API key is not configured', {
        retryable: false,
        invalidRequest: true,
      });
    }
    return this.config.apiKey;
  }

  /** Tried in order when the configured model is unavailable (503/429). */
  private static readonly FALLBACK_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.8-flash',
  ];

  protected async send(request: AiRequest): Promise<AiProviderResult> {
    const models = [
      this.config.model,
      ...GeminiProvider.FALLBACK_MODELS.filter((model) => model !== this.config.model),
    ];

    let lastError: unknown;
    for (const model of models) {
      try {
        return await this.sendWithModel(request, model);
      } catch (error) {
        lastError = error;
        const unavailable =
          error instanceof AiProviderError &&
          (error.info.status === 503 ||
            error.info.status === 429 ||
            error.info.status === 404 ||
            /high demand|UNAVAILABLE|overloaded|not found/i.test(error.info.message));
        if (!unavailable) throw error;
      }
    }

    throw lastError instanceof AiProviderError
      ? lastError
      : new AiProviderError(this.id, 'Gemini request failed', { retryable: true });
  }

  private async sendWithModel(request: AiRequest, model: string): Promise<AiProviderResult> {
    const contents = request.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: message.parts.map((part) =>
        part.type === 'text'
          ? { text: part.text }
          : { inlineData: { mimeType: part.image.mimetype, data: part.image.data.toString('base64') } },
      ),
    }));

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents,
      generationConfig: {
        temperature: request.temperature ?? this.config.temperature,
        maxOutputTokens: request.maxOutputTokens ?? this.config.maxOutputTokens,
        ...(request.json
          ? {
              responseMimeType: 'application/json',
              ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
            }
          : {}),
      },
      safetySettings: [
        'HARM_CATEGORY_HARASSMENT',
        'HARM_CATEGORY_HATE_SPEECH',
        'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        'HARM_CATEGORY_DANGEROUS_CONTENT',
      ].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
    };

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(
      model,
    )}:generateContent`;

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new AiProviderError(this.id, `Gemini request failed: ${(error as Error).message}`, {
        retryable: true,
      });
    }

    const text = await response.text();
    const latencyMs = Date.now() - started;

    if (!response.ok) throw this.toError(response.status, text);

    let payload: GeminiResponse;
    try {
      payload = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new AiProviderError(this.id, 'Gemini returned a non-JSON response', { retryable: true });
    }

    if (payload.promptFeedback?.blockReason) {
      throw new AiProviderError(this.id, `Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`, {
        retryable: false,
        invalidRequest: true,
        code: 'BLOCKED',
      });
    }

    const candidate = payload.candidates?.[0];
    const reply = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!reply) {
      throw new AiProviderError(this.id, 'Gemini returned an empty response', {
        retryable: true,
        code: candidate?.finishReason ?? 'EMPTY',
      });
    }

    return {
      text: reply,
      json: undefined,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: payload.usageMetadata?.totalTokenCount ?? 0,
      },
      model,
      finishReason: candidate?.finishReason ?? null,
      raw: { latencyMs },
    };
  }

  private toError(status: number, body: string): AiProviderError {
    let message = `Gemini HTTP ${status}`;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
      message = parsed.error?.message ?? message;
      code = parsed.error?.status;
    } catch {
      message = `Gemini HTTP ${status}: ${body.slice(0, 300)}`;
    }

    const quotaExhausted =
      status === 429 || status === 403 || /RESOURCE_EXHAUSTED|QUOTA_EXCEEDED|rate limit|quota/i.test(message);

    return new AiProviderError(this.id, message, {
      status,
      code,
      retryable: quotaExhausted || status === 500 || status === 502 || status === 503 || status === 504,
      quotaExhausted,
      invalidRequest: status === 400 || status === 404,
      raw: body.slice(0, 2000),
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checkedAt = new Date().toISOString();
    if (!this.config.apiKey) {
      return { ok: false, status: 'unconfigured', latencyMs: 0, message: 'No API key stored for Gemini', checkedAt };
    }
    const started = Date.now();
    try {
      const response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(this.config.model)}`,
        { headers: { 'x-goog-api-key': this.apiKey }, signal: AbortSignal.timeout(15_000) },
      );
      const latencyMs = Date.now() - started;
      if (response.ok) return { ok: true, status: 'healthy', latencyMs, message: null, checkedAt };
      const body = await response.text();
      return {
        ok: false,
        status: 'degraded',
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
