/**
 * Data transfer objects returned by the API and consumed by the dashboard.
 * Field names mirror the API JSON exactly.
 */
import type {
  AiOperation,
  AiProviderId,
  ArticlePriority,
  CategorizationSource,
  DocumentSourceType,
  DocumentStatus,
  EscalationStatus,
  IncidentPriorityLevel,
  LogLevel,
  ResolutionStatus,
  SessionStatus,
  TimelineEntryKind,
  TimelineRole,
  UserRole,
} from './enums.js';
import type { TroubleshootingState } from './schemas.js';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ArticleImageDto {
  id: string;
  articleId: string;
  stepId: string | null;
  label: string;
  description: string;
  url: string;
  mimetype: string | null;
  width: number | null;
  height: number | null;
  position: number;
}

export interface ArticleStepDto {
  id: string;
  articleId: string;
  position: number;
  title: string;
  instruction: string;
  expectedResult: string;
  failureResult: string;
  nextStep: string;
  escalationInstructions: string;
  requiresAdminApproval: boolean;
  isDestructive: boolean;
  images: ArticleImageDto[];
}

export interface ArticleDto {
  id: string;
  title: string;
  slug: string;
  category: string;
  issueDescription: string;
  symptoms: string[];
  troubleshootingSteps: string;
  expectedResult: string;
  failureResult: string;
  nextStep: string;
  escalationInstructions: string;
  tags: string[];
  keywords: string[];
  priority: ArticlePriority;
  isActive: boolean;
  notes: string;
  version: number;
  sourceDocumentId: string | null;
  sourceDocumentTitle: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  steps: ArticleStepDto[];
  images: ArticleImageDto[];
  stepCount: number;
  /** Populated by search results. */
  searchScore?: number;
  matchedTerms?: string[];
}

export interface DocumentDto {
  id: string;
  title: string;
  sourceType: DocumentSourceType;
  filename: string;
  size: number;
  pageCount: number | null;
  status: DocumentStatus;
  error: string | null;
  extractedChars: number;
  articleCount: number;
  createdAt: string;
}

export interface AiProviderDto {
  provider: AiProviderId;
  label: string;
  role: 'primary' | 'fallback' | 'disabled';
  enabled: boolean;
  model: string;
  /** Never contains the key itself — only whether one is stored. */
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  baseUrl: string | null;
  temperature: number;
  maxOutputTokens: number;
  maxRetries: number;
  timeoutMs: number;
  visionEnabled: boolean;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  updatedAt: string;
}

export interface AiProviderHealthDto {
  provider: AiProviderId;
  label: string;
  model: string;
  role: 'primary' | 'fallback' | 'disabled';
  enabled: boolean;
  configured: boolean;
  visionEnabled: boolean;
  status: 'healthy' | 'degraded' | 'unconfigured' | 'disabled' | 'unknown';
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
  checkedAt: string | null;
}

export interface AiInstructionsDto {
  id: string;
  content: string;
  version: number;
  isActive: boolean;
  changeNote: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    id: string;
    version: number;
    changeNote: string | null;
    isActive: boolean;
    updatedByName: string | null;
    updatedAt: string;
  }>;
}

export interface SlackChannelDto {
  id: string;
  channelId: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  sessionCount: number;
}

export interface SlackConfigDto {
  hasBotToken: boolean;
  botTokenPreview: string | null;
  hasSigningSecret: boolean;
  signingSecretPreview: string | null;
  hasAppToken: boolean;
  appTokenPreview: string | null;
  channels: SlackChannelDto[];
  triggerEmoji: string;
  enableMentions: boolean;
  allowedUserIds: string[];
  verifySignature: boolean;
  threadOnly: boolean;
  redactSecrets: boolean;
  connected: boolean;
  workspaceName: string | null;
  botId: string | null;
  teamId: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  events: {
    subscribed: string[];
    missing: string[];
  };
}

export interface SlackFileDto {
  id: string;
  fileId: string;
  name: string;
  mimetype: string | null;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  analysis: ScreenshotAnalysis | null;
  analyzedAt: string | null;
}

export interface ScreenshotAnalysis {
  summary: string;
  readable: boolean;
  application: string | null;
  osHint: string | null;
  errorCodes: string[];
  errorMessages: string[];
  uiState: string | null;
  confidence: number;
  matchedArticleImageIds: string[];
  notes: string[];
}

export interface TimelineEntryDto {
  id: string;
  seq: number;
  role: TimelineRole;
  kind: TimelineEntryKind;
  summary: string;
  content: string;
  metadata: Record<string, unknown> | null;
  provider: AiProviderId | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
  slackUserName: string | null;
}

export interface SessionDto {
  id: string;
  sessionCode: string;
  status: SessionStatus;
  resolutionStatus: ResolutionStatus;
  escalationRequired: boolean;
  channelId: string;
  channelName: string | null;
  threadTs: string;
  triggerMessageTs: string;
  permalink: string | null;
  slackUserId: string;
  agentName: string | null;
  agentDisplayName: string | null;
  issueTitle: string;
  issueSummary: string;
  diagnosis: string;
  state: TroubleshootingState;
  attemptCount: number;
  aiProvider: AiProviderId | null;
  aiModel: string | null;
  adminPaused: boolean;
  adminNotes: Array<{ id: string; note: string; createdAt: string; userName: string | null }>;
  articleIds: string[];
  articlesUsed: Array<{ id: string; title: string; category: string }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  closedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface SessionDetailDto extends SessionDto {
  originalMessage: string;
  files: SlackFileDto[];
  messages: Array<{
    ts: string;
    userId: string;
    userName: string | null;
    text: string;
    isBot: boolean;
    createdAt: string;
    files: SlackFileDto[];
  }>;
  timeline: TimelineEntryDto[];
  escalation: {
    id: string;
    reason: string;
    requiredInfo: string[];
    status: EscalationStatus;
    escalatedBy: string;
    slackMessageTs: string | null;
    createdAt: string;
  } | null;
  aiRequests: Array<{
    id: string;
    correlationId: string;
    provider: AiProviderId;
    model: string;
    operation: AiOperation;
    success: boolean;
    errorMessage: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    latencyMs: number | null;
    isFallback: boolean;
    attempt: number;
    createdAt: string;
  }>;
  /** Category and sub-category the resolved issue was filed under (§32). */
  categorization: IssueCategorizationDto | null;
}

/* -------------------------------------------------------------------------- */
/* Incident taxonomy                                                           */
/* -------------------------------------------------------------------------- */

export interface IssueSubcategoryDto {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  /** Queue impact when this sub-category is hit. */
  priorityLevel: IncidentPriorityLevel;
  operationalImpact: string;
  /** Historical incident count, kept only as a reporting baseline. */
  baselineIncidentCount: number;
  baselinePercentage: number;
  sortOrder: number;
  isActive: boolean;
}

export interface IssueCategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string;
  baselineIncidentCount: number;
  baselinePercentage: number;
  sortOrder: number;
  isActive: boolean;
  subcategories: IssueSubcategoryDto[];
}

export interface IssueCategorizationDto {
  sessionId: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  subcategoryId: string;
  subcategoryName: string;
  subcategorySlug: string;
  priorityLevel: IncidentPriorityLevel;
  operationalImpact: string;
  source: CategorizationSource;
  confidence: number;
  rationale: string;
  categorizedByName: string | null;
  categorizedAt: string;
}

/** One row of the "most received issues" report. */
export interface IssueReportRowDto {
  categoryId: string;
  categoryName: string;
  subcategoryId: string;
  subcategoryName: string;
  priorityLevel: IncidentPriorityLevel;
  /** Categorized sessions in the period. */
  count: number;
  percentage: number;
  /** Historical share from the baseline analysis, for comparison. */
  baselineCount: number;
  baselinePercentage: number;
}

export interface IssueCategoryReportRowDto {
  categoryId: string;
  categoryName: string;
  count: number;
  percentage: number;
  baselineCount: number;
  baselinePercentage: number;
}

export interface IssueReportDto {
  from: string | null;
  to: string | null;
  totalCategorized: number;
  bySubcategory: IssueReportRowDto[];
  byCategory: IssueCategoryReportRowDto[];
}

export interface EscalationDto {
  id: string;
  sessionId: string;
  sessionCode: string;
  reason: string;
  requiredInfo: string[];
  status: EscalationStatus;
  escalatedBy: string;
  channelId: string;
  channelName: string | null;
  agentName: string | null;
  issueTitle: string;
  slackMessageTs: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  closedAt: string | null;
}

export interface DashboardStats {
  activeSessions: number;
  resolvedSessions: number;
  escalatedSessions: number;
  openEscalations: number;
  issuesToday: number;
  issuesThisWeek: number;
  aiRequests: number;
  aiErrors: number;
  averageResolutionSeconds: number | null;
  totalTokens: number;
  estimatedCost: number;
  successRate: number | null;
  escalationRate: number | null;
  providerUsage: Array<{
    provider: AiProviderId;
    model: string;
    requests: number;
    errors: number;
    tokens: number;
    estimatedCost: number;
  }>;
  statusBreakdown: Array<{ status: SessionStatus; count: number }>;
  daily: Array<{ date: string; sessions: number; resolved: number; escalated: number; tokens: number }>;
  recentSessions: Array<{
    id: string;
    sessionCode: string;
    issueTitle: string;
    agentName: string | null;
    status: SessionStatus;
    resolutionStatus: ResolutionStatus;
    aiProvider: AiProviderId | null;
    createdAt: string;
    lastActivityAt: string;
    attemptCount: number;
  }>;
}

export interface AnalyticsUsage {
  totals: {
    requests: number;
    successful: number;
    failed: number;
    fallbacksUsed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    avgLatencyMs: number | null;
  };
  byProvider: Array<{
    provider: AiProviderId;
    model: string;
    requests: number;
    successful: number;
    failed: number;
    fallbacksUsed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    avgLatencyMs: number | null;
  }>;
  byOperation: Array<{ operation: AiOperation; requests: number; failed: number; totalTokens: number }>;
  daily: Array<{
    date: string;
    requests: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
  }>;
  sessions: {
    total: number;
    resolved: number;
    escalated: number;
    abandoned: number;
    inProgress: number;
    averageResolutionSeconds: number | null;
    averageAttempts: number | null;
    resolutionRate: number | null;
    escalationRate: number | null;
  };
  topIssues: Array<{ issueTitle: string; count: number; resolved: number; escalated: number }>;
}

export interface LogEntryDto {
  id: string;
  level: LogLevel;
  category: string;
  message: string;
  correlationId: string | null;
  sessionId: string | null;
  sessionCode: string | null;
  provider: AiProviderId | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SystemSettingsDto {
  troubleshooting: {
    maxAttempts: number;
    escalationInfoItems: string[];
    sessionStaleAfterHours: number;
    maxScreenshotsPerMessage: number;
    maxAttachmentBytes: number;
    kbMaxArticles: number;
    kbMaxSteps: number;
    escalationContact: string | null;
    escalationNotifyUserIds: string[];
  };
  ai: {
    primaryProvider: AiProviderId | null;
    fallbackProvider: AiProviderId | null;
  };
  slack: SlackConfigDto;
  environment: {
    nodeEnv: string;
    logLevel: string;
    fileStorage: string;
    version: string;
    startedAt: string;
  };
}

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string;
  };
}
