/**
 * AI provider abstraction (§9).
 *
 * Application code never imports a concrete provider. Providers implement the
 * low-level `chat()` transport; the shared `BaseAIProvider` implements the
 * product-level methods (`analyzeMessage`, `analyzeImage`,
 * `generateTroubleshootingResponse`, `summarizeThread`, `classifyIssue`,
 * `detectResolution`, `detectEscalation`) on top of it, so Gemini and OpenAI
 * behave identically from the caller's point of view.
 */
import type { AiOperation, AiProviderId, TroubleshootingState } from '@helpdesk/shared';

export interface AiImage {
  data: Buffer;
  mimetype: string;
  label?: string;
}

export type AiPart = { type: 'text'; text: string } | { type: 'image'; image: AiImage };

export interface AiChatMessage {
  role: 'user' | 'assistant';
  parts: AiPart[];
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiRequest {
  operation: AiOperation;
  system: string;
  messages: AiChatMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Ask for a JSON object response. */
  json?: boolean;
  /** Optional structured-output schema (OpenAPI subset) to constrain the response. */
  responseSchema?: Record<string, unknown>;
  correlationId: string;
  sessionId?: string | null;
  sessionCode?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  slackUserId?: string | null;
  /** Prompt size for usage analytics. */
  promptChars?: number;
  signal?: AbortSignal;
}

export interface AiProviderResult {
  text: string;
  json: unknown;
  usage: AiUsage;
  model: string;
  finishReason: string | null;
  raw: unknown;
}

export interface ProviderErrorInfo {
  status?: number;
  code?: string;
  message: string;
  retryable: boolean;
  /** Rate limit / quota exhausted → the runner may use the fallback provider. */
  quotaExhausted: boolean;
  /** Bad request (usually a malformed prompt or unsupported model). */
  invalidRequest: boolean;
  raw?: unknown;
}

export class AiProviderError extends Error {
  readonly info: ProviderErrorInfo;
  readonly providerId: AiProviderId;

  constructor(provider: AiProviderId, message: string, info: Partial<ProviderErrorInfo> = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.providerId = provider;
    this.info = {
      message,
      status: info.status,
      code: info.code,
      retryable: info.retryable ?? false,
      quotaExhausted: info.quotaExhausted ?? false,
      invalidRequest: info.invalidRequest ?? false,
      raw: info.raw,
    };
  }

  get provider(): AiProviderId {
    return this.providerId;
  }
}

export interface HealthCheckResult {
  ok: boolean;
  status: 'healthy' | 'degraded' | 'unconfigured' | 'disabled';
  latencyMs: number;
  message: string | null;
  checkedAt: string;
}

export interface ProviderConfig {
  provider: AiProviderId;
  label: string;
  model: string;
  apiKey: string | null;
  baseUrl: string;
  temperature: number;
  maxOutputTokens: number;
  maxRetries: number;
  timeoutMs: number;
  visionEnabled: boolean;
  role: 'primary' | 'fallback' | 'disabled';
  enabled: boolean;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

/* -------------------------------------------------------------------------- */
/* Product-level operations                                                    */
/* -------------------------------------------------------------------------- */

export interface ClassifyIssueInput {
  messageText: string;
  threadContext?: string;
  screenshotSummaries?: string[];
}

export interface IssueClassification {
  summary: string;
  category: string;
  keywords: string[];
  errorCodes: string[];
  applications: string[];
  urgency: 'low' | 'normal' | 'high' | 'critical';
  confidence: number;
}

/** One allowed sub-category, rendered into the categorization prompt. */
export interface CategorizationChoice {
  id: string;
  name: string;
  categoryName: string;
  /** Documents the queue impact, so the model can weigh ambiguous cases. */
  priorityLevel: string;
  description: string;
}

export interface CategorizeIssueInput {
  issueTitle: string;
  issueSummary: string;
  diagnosis: string;
  agentMessage: string;
  threadTranscript: string;
  articlesUsed: string[];
  choices: CategorizationChoice[];
}

export interface IssueCategorizationResult {
  /** Empty when the model picked nothing usable. */
  subcategoryId: string;
  confidence: number;
  rationale: string;
}

export interface AnalyzeImageInput {
  image: AiImage;
  /** Documented reference images to compare against (§27). */
  referenceImages: Array<{ id: string; label: string; description: string; image: AiImage }>;
  context: string;
}

export interface ImageMatch {
  articleImageId: string;
  label: string;
  confidence: number;
  reason: string;
}

export interface ScreenshotAnalysisResult {
  summary: string;
  readable: boolean;
  unreadableReason: string | null;
  application: string | null;
  osHint: string | null;
  errorCodes: string[];
  errorMessages: string[];
  uiState: string | null;
  matches: ImageMatch[];
  confidence: number;
  notes: string[];
}

export interface AnalyzeMessageInput {
  messageText: string;
  state: TroubleshootingState;
  threadTranscript: string;
  /** Attempt count for escalation-threshold awareness. */
  attemptCount: number;
  maxAttempts: number;
}

export interface MessageAnalysisResult {
  observations: string[];
  stepOutcomes: Array<{ step: string; outcome: 'completed' | 'failed' | 'partial' | 'unknown'; note: string }>;
  newInformation: string[];
  resolution: { detected: boolean; confidence: number; evidence: string };
  escalation: { required: boolean; confidence: number; reason: string };
  agentNeedsEscalation: boolean;
  summary: string;
}

export interface DetectResolutionInput {
  messageText: string;
  state: TroubleshootingState;
  threadTranscript: string;
}

export interface DetectResolutionResult {
  resolved: boolean;
  confidence: number;
  evidence: string;
}

export interface DetectEscalationInput {
  messageText: string;
  state: TroubleshootingState;
  attemptCount: number;
  maxAttempts: number;
  reason?: string;
}

export interface DetectEscalationResult {
  escalate: boolean;
  confidence: number;
  reason: string;
}

export interface KnowledgeArticleContext {
  id: string;
  title: string;
  category: string;
  priority: string;
  issueDescription: string;
  /** Free-text documented procedure (used when no structured steps exist). */
  troubleshootingSteps: string;
  symptoms: string[];
  expectedResult: string;
  failureResult: string;
  nextStep: string;
  escalationInstructions: string;
  notes: string;
  steps: Array<{
    position: number;
    title: string;
    instruction: string;
    expectedResult: string;
    failureResult: string;
    nextStep: string;
    escalationInstructions: string;
    requiresAdminApproval: boolean;
    isDestructive: boolean;
  }>;
  images: Array<{ id: string; label: string; description: string; url: string }>;
}

export interface TroubleshootingResponseInput {
  agentMessage: string;
  state: TroubleshootingState;
  attemptCount: number;
  maxAttempts: number;
  threadTranscript: string;
  articles: KnowledgeArticleContext[];
  screenshotAnalyses: ScreenshotAnalysisResult[];
  /** Screenshots for a second visual look (provider must support vision). */
  images: AiImage[];
  sessionCode: string;
  agentName: string;
  /** True when the knowledge base has no matching article. */
  knowledgeBaseEmpty: boolean;
  /** Set by an administrator to steer the AI (admin override §29). */
  adminDirection: string | null;
}

/** A clickable clarifying-question answer rendered as a Slack button. */
export interface TroubleshootingOption {
  /** Short button label (<= 75 chars). */
  label: string;
  /** Value submitted as the agent's reply when the button is clicked. */
  value: string;
}

export interface TroubleshootingResponseResult {
  reply: string;
  state: TroubleshootingState;
  resolutionDetected: boolean;
  escalationDetected: boolean;
  escalationReason: string | null;
  kbArticleIds: string[];
  usedDocumentation: boolean;
  nextStepTitle: string | null;
  internalNotes: string;
  /** When non-empty, the clarifying question is offered as clickable buttons. */
  options: TroubleshootingOption[];
}

export interface SummarizeThreadInput {
  transcript: string;
  maxWords?: number;
}

export interface AIProvider {
  readonly id: AiProviderId;
  readonly label: string;
  readonly model: string;
  readonly supportsVision: boolean;
  readonly config: ProviderConfig;
  /** Token usage of the most recent call, read by the runner for accounting. */
  lastUsage: AiUsage | null;
  /** Model actually used by the most recent call (may differ after a fallback). */
  resolvedModel: string | null;

  /** Low-level transport implemented per provider. */
  chat(request: AiRequest): Promise<AiProviderResult>;
  healthCheck(): Promise<HealthCheckResult>;

  analyzeMessage(input: AnalyzeMessageInput): Promise<MessageAnalysisResult>;
  analyzeImage(input: AnalyzeImageInput): Promise<ScreenshotAnalysisResult>;
  generateTroubleshootingResponse(
    input: TroubleshootingResponseInput,
  ): Promise<TroubleshootingResponseResult>;
  summarizeThread(input: SummarizeThreadInput): Promise<string>;
  classifyIssue(input: ClassifyIssueInput): Promise<IssueClassification>;
  categorizeIssue(input: CategorizeIssueInput): Promise<IssueCategorizationResult>;
  detectResolution(input: DetectResolutionInput): Promise<DetectResolutionResult>;
  detectEscalation(input: DetectEscalationInput): Promise<DetectEscalationResult>;
}

/** Parses model output that is expected to be JSON, tolerating code fences. */
export function parseJsonLoose<T>(text: string): T | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}
