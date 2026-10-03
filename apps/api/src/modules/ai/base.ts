/**
 * Shared provider behaviour.
 *
 * Concrete providers only implement the transport (`chat`); the product-level
 * methods live here so every provider produces the same structured output.
 */
import { troubleshootingStateSchema, type TroubleshootingState } from '@helpdesk/shared';
import {
  parseJsonLoose,
  type AIProvider,
  type AnalyzeImageInput,
  type AnalyzeMessageInput,
  type AiChatMessage,
  type AiRequest,
  type AiProviderResult,
  type AiUsage,
  type ClassifyIssueInput,
  type DetectEscalationInput,
  type DetectResolutionInput,
  type HealthCheckResult,
  type IssueClassification,
  type MessageAnalysisResult,
  type ProviderConfig,
  type ScreenshotAnalysisResult,
  type SummarizeThreadInput,
  type TroubleshootingOption,
  type TroubleshootingResponseInput,
  type TroubleshootingResponseResult,
} from './types.js';
import {
  buildSystemPrompt,
  classificationPrompt,
  imageAnalysisPrompt,
  messageAnalysisPrompt,
  resolutionPrompt,
  escalationPrompt,
  summarizePrompt,
  troubleshootingResponsePrompt,
} from './prompts.js';
import type { AiProviderId } from '@helpdesk/shared';

export interface RequestContext {
  correlationId: string;
  sessionId?: string | null;
  sessionCode?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  slackUserId?: string | null;
  /** Administrator override injected into the next reply (§29). */
  adminDirection?: string | null;
  maxStepsPerArticle: number;
  escalationInfoItems: string[];
  agentName: string;
  instructions: string;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.toLowerCase());
  return fallback;
}

function strArray(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, max);
}

/** Normalises the model's clickable clarifying-question options. */
export function parseOptions(value: unknown, max = 5): TroubleshootingOption[] {
  if (!Array.isArray(value)) return [];
  const options: TroubleshootingOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const label = text(record.label).trim();
    if (!label) continue;
    const rawValue = text(record.value).trim();
    options.push({
      label: label.slice(0, 75),
      value: (rawValue || label).slice(0, 1800),
    });
    if (options.length >= max) break;
  }
  return options;
}

/** True when the agent's reply is asking the user something. */
export function looksLikeQuestion(reply: string): boolean {
  return reply.includes('?');
}

/** A yes/no question can always be answered with two fixed buttons. */
const YES_NO_STARTERS =
  /^\s*(did|do|does|is|are|was|were|can|could|would|will|should|have|has|had|any)\b/i;

/** Deterministic buttons for questions with an obvious fixed answer set. */
export function quickReplyOptions(reply: string): TroubleshootingOption[] {
  const questionLines = reply
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('?'));
  const question = (questionLines.at(-1) ?? reply).toLowerCase();
  const yesNo = /\byes\s*\/\s*no\b/.test(question) || YES_NO_STARTERS.test(question);
  if (yesNo) {
    return [
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' },
    ];
  }
  return [];
}

const DERIVED_OPTIONS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
  },
  required: ['options'],
};

const DERIVED_OPTIONS_SYSTEM =
  "You turn an IT support agent's question into 2-5 short clickable answer buttons for a Slack user. " +
  'Use "Yes"/"No" for yes/no questions. For a small set of known choices (operating system, browser, app, error code) list the likely choices and put "Not sure" or "Other" last. ' +
  'Each item is {label, value} where label is the button text (<= 40 chars) and value is the answer sent back (usually the same as label). ' +
  'Return JSON only.';

/** Keys a model might use for the Slack reply, in priority order. */
const REPLY_KEYS = ['reply', 'slack_message', 'slackMessage', 'message', 'response'] as const;
function pickReply(parsed: Record<string, unknown>): string {
  for (const key of REPLY_KEYS) {
    const value = text(parsed[key]).trim();
    if (value) return value;
  }
  // Last resort: models occasionally rename the field (e.g. slack_reply). Treat
  // the longest top-level string value as the reply rather than leaking JSON.
  let longest = '';
  for (const value of Object.values(parsed)) {
    if (typeof value === 'string' && value.trim().length > longest.length) longest = value.trim();
  }
  return longest;
}

/**
 * Structured-output schema for the troubleshooting reply. Enforcing this at the
 * provider level guarantees the `reply` key regardless of model quirks.
 */
const TROUBLESHOOTING_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    state: {
      type: 'object',
      properties: {
        issue: { type: 'string' },
        diagnosis: { type: 'string' },
        stepsCompleted: { type: 'array', items: { type: 'string' } },
        stepsFailed: { type: 'array', items: { type: 'string' } },
        currentStep: { type: 'string' },
        observations: { type: 'array', items: { type: 'string' } },
        possibleCauses: { type: 'array', items: { type: 'string' } },
        resolutionStatus: {
          type: 'string',
          enum: ['in_progress', 'resolved', 'escalated', 'abandoned'],
        },
        escalationRequired: { type: 'boolean' },
      },
      required: ['issue', 'diagnosis', 'resolutionStatus', 'escalationRequired'],
    },
    resolutionDetected: { type: 'boolean' },
    escalationDetected: { type: 'boolean' },
    escalationReason: { type: 'string' },
    kbArticleIds: { type: 'array', items: { type: 'string' } },
    usedDocumentation: { type: 'boolean' },
    nextStepTitle: { type: 'string' },
    internalNotes: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
        required: ['label', 'value'],
      },
    },
  },
  required: [
    'reply',
    'state',
    'resolutionDetected',
    'escalationDetected',
    'kbArticleIds',
    'usedDocumentation',
    'internalNotes',
    'options',
  ],
};

/** Recovers the reply field from JSON that failed strict parsing (e.g. truncation). */
function salvageReply(raw: string): string {
  for (const key of REPLY_KEYS) {
    const match = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (!match?.[1]) continue;
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as string;
      if (decoded.trim()) return decoded.trim();
    } catch {
      if (match[1].trim()) return match[1].trim();
    }
  }
  return '';
}

export abstract class BaseAIProvider implements AIProvider {
  abstract readonly id: AiProviderId;
  abstract readonly label: string;
  abstract readonly model: string;
  abstract readonly supportsVision: boolean;
  abstract readonly config: ProviderConfig;

  /** Token usage of the most recent call — read by the runner for accounting. */
  lastUsage: AiUsage | null = null;

  /** Model actually used by the most recent call (may differ after a fallback). */
  resolvedModel: string | null = null;

  protected readonly context: RequestContext;

  constructor(context: RequestContext) {
    this.context = context;
  }

  /** Transport implemented by each provider. */
  protected abstract send(request: AiRequest): Promise<AiProviderResult>;

  abstract healthCheck(): Promise<HealthCheckResult>;

  /** Public transport entry point that records usage. */
  async chat(request: AiRequest): Promise<AiProviderResult> {
    const result = await this.send(request);
    this.lastUsage = result.usage;
    this.resolvedModel = result.model ?? this.model;
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private baseRequest(
    operation: AiRequest['operation'],
    system: string,
    parts: AiChatMessage['parts'],
    options: { json?: boolean; maxOutputTokens?: number; responseSchema?: Record<string, unknown> } = {},
  ): AiRequest {
    return {
      operation,
      system,
      messages: [{ role: 'user', parts }],
      json: options.json ?? true,
      responseSchema: options.responseSchema,
      maxOutputTokens: options.maxOutputTokens ?? this.config.maxOutputTokens,
      temperature: this.config.temperature,
      correlationId: this.context.correlationId,
      sessionId: this.context.sessionId ?? null,
      sessionCode: this.context.sessionCode ?? null,
      channelId: this.context.channelId ?? null,
      threadTs: this.context.threadTs ?? null,
      slackUserId: this.context.slackUserId ?? null,
    };
  }

  private async jsonCall<T>(
    operation: AiRequest['operation'],
    system: string,
    user: string,
    images: AiRequest['messages'][number]['parts'] = [],
    maxOutputTokens?: number,
  ): Promise<T | null> {
    const parts: AiChatMessage['parts'] = [{ type: 'text', text: user }];
    if (images.length > 0) parts.push(...images);
    const result = await this.chat(this.baseRequest(operation, system, parts, { json: true, maxOutputTokens }));
    return parseJsonLoose<T>(result.text);
  }

  /* ------------------------------------------------------------------ */
  /* Product operations                                                 */
  /* ------------------------------------------------------------------ */

  async classifyIssue(input: ClassifyIssueInput): Promise<IssueClassification> {
    const prompt = classificationPrompt(input);
    const parsed = await this.jsonCall<Record<string, unknown>>('classifyIssue', prompt.system, prompt.user);
    const category = text(parsed?.category, 'Other');
    const urgencyRaw = text(parsed?.urgency, 'normal');
    return {
      summary: text(parsed?.summary, input.messageText.slice(0, 120)) || 'Unclassified issue',
      category,
      keywords: strArray(parsed?.keywords, 10),
      errorCodes: strArray(parsed?.errorCodes, 10),
      applications: strArray(parsed?.applications, 10),
      urgency: (['low', 'normal', 'high', 'critical'] as const).includes(urgencyRaw as never)
        ? (urgencyRaw as IssueClassification['urgency'])
        : 'normal',
      confidence: Math.max(0, Math.min(1, num(parsed?.confidence, 0.5))),
    };
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<ScreenshotAnalysisResult> {
    const prompt = imageAnalysisPrompt(input);
    const parts: AiChatMessage['parts'] = [];
    const referenceIds: string[] = [];

    for (const reference of input.referenceImages) {
      parts.push({ type: 'image', image: reference.image });
      referenceIds.push(reference.id);
    }
    parts.push({ type: 'image', image: input.image });

    const parsed = await this.jsonCall<Record<string, unknown>>(
      'analyzeImage',
      prompt.system,
      prompt.user,
      parts,
      2048,
    );

    const matches = Array.isArray(parsed?.matches)
      ? (parsed!.matches as Array<Record<string, unknown>>)
          .map((match) => ({
            articleImageId: text(match.referenceId) || referenceIds[0] || '',
            label: text(match.label),
            confidence: Math.max(0, Math.min(1, num(match.confidence, 0))),
            reason: text(match.reason),
          }))
          .filter((match) => match.articleImageId.length > 0)
          .slice(0, 5)
      : [];

    const readable = bool(parsed?.readable, true);
    return {
      summary: text(parsed?.summary, readable ? 'Screenshot analysed' : 'Screenshot could not be read'),
      readable,
      unreadableReason: parsed?.unreadableReason ? text(parsed.unreadableReason) : null,
      application: parsed?.application ? text(parsed.application) : null,
      osHint: parsed?.osHint ? text(parsed.osHint) : null,
      errorCodes: strArray(parsed?.errorCodes, 10),
      errorMessages: strArray(parsed?.errorMessages, 15),
      uiState: parsed?.uiState ? text(parsed.uiState) : null,
      matches,
      confidence: Math.max(0, Math.min(1, num(parsed?.confidence, 0.5))),
      notes: strArray(parsed?.notes, 10),
    };
  }

  async analyzeMessage(input: AnalyzeMessageInput): Promise<MessageAnalysisResult> {
    const prompt = messageAnalysisPrompt(input);
    const parsed = await this.jsonCall<Record<string, unknown>>('analyzeMessage', prompt.system, prompt.user);
    const stepOutcomes = Array.isArray(parsed?.stepOutcomes)
      ? (parsed!.stepOutcomes as Array<Record<string, unknown>>).map((step) => {
          const outcome = text(step.outcome, 'unknown');
          return {
            step: text(step.step),
            outcome: (['completed', 'failed', 'partial', 'unknown'] as const).includes(outcome as never)
              ? (outcome as 'completed' | 'failed' | 'partial' | 'unknown')
              : 'unknown',
            note: text(step.note),
          };
        })
      : [];

    return {
      observations: strArray(parsed?.observations),
      stepOutcomes,
      newInformation: strArray(parsed?.newInformation),
      resolution: {
        detected: bool((parsed?.resolution as Record<string, unknown>)?.detected, false),
        confidence: Math.max(0, Math.min(1, num((parsed?.resolution as Record<string, unknown>)?.confidence, 0))),
        evidence: text((parsed?.resolution as Record<string, unknown>)?.evidence),
      },
      escalation: {
        required: bool((parsed?.escalation as Record<string, unknown>)?.required, false),
        confidence: Math.max(0, Math.min(1, num((parsed?.escalation as Record<string, unknown>)?.confidence, 0))),
        reason: text((parsed?.escalation as Record<string, unknown>)?.reason),
      },
      agentNeedsEscalation: bool(parsed?.agentNeedsEscalation, false),
      summary: text(parsed?.summary),
    };
  }

  async detectResolution(input: DetectResolutionInput) {
    const prompt = resolutionPrompt(input);
    const parsed = await this.jsonCall<Record<string, unknown>>('detectResolution', prompt.system, prompt.user);
    return {
      resolved: bool(parsed?.resolved, false),
      confidence: Math.max(0, Math.min(1, num(parsed?.confidence, 0))),
      evidence: text(parsed?.evidence),
    };
  }

  async detectEscalation(input: DetectEscalationInput) {
    const prompt = escalationPrompt(input);
    const parsed = await this.jsonCall<Record<string, unknown>>('detectEscalation', prompt.system, prompt.user);
    return {
      escalate: bool(parsed?.escalate, false),
      confidence: Math.max(0, Math.min(1, num(parsed?.confidence, 0))),
      reason: text(parsed?.reason, input.reason ?? ''),
    };
  }

  async generateTroubleshootingResponse(
    input: TroubleshootingResponseInput,
  ): Promise<TroubleshootingResponseResult> {
    const system = buildSystemPrompt({
      instructions: this.context.instructions,
      state: input.state,
      attemptCount: input.attemptCount,
      maxAttempts: input.maxAttempts,
      articles: input.articles,
      maxStepsPerArticle: this.context.maxStepsPerArticle,
      knowledgeBaseEmpty: input.knowledgeBaseEmpty,
      adminDirection: input.adminDirection ?? this.context.adminDirection ?? null,
      escalationInfoItems: this.context.escalationInfoItems,
      agentName: input.agentName,
      sessionCode: input.sessionCode,
    });

    const prompt = troubleshootingResponsePrompt(input);

    const parts: AiChatMessage['parts'] = [];
    if (this.config.visionEnabled && this.supportsVision && input.images.length > 0) {
      for (const image of input.images.slice(0, 4)) parts.push({ type: 'image', image });
    }
    parts.push({ type: 'text', text: prompt.user });

    const result = await this.chat(
      this.baseRequest('generateTroubleshootingResponse', system, parts, {
        json: true,
        maxOutputTokens: Math.max(this.config.maxOutputTokens, 4096),
        responseSchema: TROUBLESHOOTING_RESPONSE_SCHEMA,
      }),
    );

    const parsed = parseJsonLoose<Record<string, unknown>>(result.text);
    if (!parsed) {
      const salvaged = salvageReply(result.text);
      const looksLikeJson = /^\s*\{/.test(result.text);
      if (salvaged) {
        return {
          reply: salvaged,
          state: input.state,
          resolutionDetected: /resolution.?status"?\s*:?\s*"?resolved/i.test(result.text),
          escalationDetected: /escalationDetected"?\s*:\s*true/i.test(result.text),
          escalationReason: null,
          kbArticleIds: input.articles.map((a) => a.id),
          usedDocumentation: input.articles.length > 0,
          nextStepTitle: null,
          internalNotes: 'Recovered the reply field from malformed JSON output.',
          options: [],
        };
      }
      // Model ignored the JSON contract: fall back to treating the output as the
      // Slack reply so the agent is never left without an answer. If the output
      // looks like a (broken) JSON envelope, never leak it into Slack.
      return {
        reply: looksLikeJson
          ? 'Sorry, I had trouble formatting that answer. Could you paste the exact error text and I will try again?'
          : result.text.trim(),
        state: input.state,
        resolutionDetected: false,
        escalationDetected: false,
        escalationReason: null,
        kbArticleIds: input.articles.map((a) => a.id),
        usedDocumentation: input.articles.length > 0,
        nextStepTitle: null,
        internalNotes: looksLikeJson
          ? 'Provider returned malformed JSON; raw output suppressed.'
          : 'Provider returned a non-JSON response; raw text used as the reply.',
        options: [],
      };
    }

    const state = this.normalizeState(parsed.state, input.state);
    const reply =
      pickReply(parsed) || 'I could not produce a clear next step. Could you describe exactly what you see?';

    return this.finalizeOptions({
      reply,
      state,
      resolutionDetected: bool(parsed.resolutionDetected, false),
      escalationDetected: bool(parsed.escalationDetected, false),
      escalationReason: parsed.escalationReason ? text(parsed.escalationReason) : null,
      kbArticleIds: strArray(parsed.kbArticleIds, 5),
      usedDocumentation: bool(parsed.usedDocumentation, input.articles.length > 0),
      nextStepTitle: parsed.nextStepTitle ? text(parsed.nextStepTitle) : null,
      internalNotes: text(parsed.internalNotes),
      options: parseOptions(parsed.options),
    });
  }

  /**
   * Guarantees clickable reply buttons whenever the agent asks a question.
   * If the model omitted options, yes/no questions get fixed Yes/No buttons and
   * other questions get one focused call that turns the question into choices.
   */
  private async finalizeOptions(
    result: TroubleshootingResponseResult,
  ): Promise<TroubleshootingResponseResult> {
    if (result.options.length > 0) return result;
    if (!looksLikeQuestion(result.reply)) return result;

    const quick = quickReplyOptions(result.reply);
    if (quick.length > 0) return { ...result, options: quick };

    try {
      const derived = await this.chat(
        this.baseRequest(
          'generateTroubleshootingResponse',
          DERIVED_OPTIONS_SYSTEM,
          [{ type: 'text', text: result.reply }],
          { json: true, maxOutputTokens: 512, responseSchema: DERIVED_OPTIONS_SCHEMA },
        ),
      );
      const parsed = parseJsonLoose<Record<string, unknown>>(derived.text);
      const options = parsed ? parseOptions(parsed.options) : [];
      return options.length > 0 ? { ...result, options } : result;
    } catch {
      return result;
    }
  }

  private normalizeState(value: unknown, previous: TroubleshootingState): TroubleshootingState {
    if (!value || typeof value !== 'object') return previous;
    const parsed = troubleshootingStateSchema.safeParse(value);
    if (parsed.success) {
      const merged = parsed.data;
      return {
        ...merged,
        // Never lose history the model forgot to repeat.
        stepsCompleted: merged.stepsCompleted.length ? merged.stepsCompleted : previous.stepsCompleted,
        stepsFailed: merged.stepsFailed.length ? merged.stepsFailed : previous.stepsFailed,
        observations: merged.observations.length ? merged.observations : previous.observations,
        possibleCauses: merged.possibleCauses.length ? merged.possibleCauses : previous.possibleCauses,
      };
    }
    return previous;
  }

  async summarizeThread(input: SummarizeThreadInput): Promise<string> {
    const prompt = summarizePrompt(input);
    const result = await this.chat(
      this.baseRequest('summarizeThread', prompt.system, [{ type: 'text', text: prompt.user }], {
        json: false,
        maxOutputTokens: 400,
      }),
    );
    return result.text.trim();
  }
}
