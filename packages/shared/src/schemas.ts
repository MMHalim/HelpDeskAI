import { z } from 'zod';
import {
  ARTICLE_CATEGORIES,
  ARTICLE_PRIORITIES,
  AI_OPERATIONS,
  AI_PROVIDER_IDS,
  DEFAULT_TRIGGER_EMOJI,
  DOCUMENT_SOURCE_TYPES,
  SESSION_STATUSES,
} from './enums.js';

/* -------------------------------------------------------------------------- */
/* Troubleshooting knowledge base                                               */
/* -------------------------------------------------------------------------- */

export const articleStepSchema = z.object({
  id: z.string().uuid().optional(),
  position: z.number().int().min(0),
  title: z.string().min(1).max(200).optional().default(''),
  instruction: z.string().min(1, 'A step needs an instruction'),
  expectedResult: z.string().max(2000).optional().default(''),
  failureResult: z.string().max(2000).optional().default(''),
  nextStep: z.string().max(2000).optional().default(''),
  escalationInstructions: z.string().max(2000).optional().default(''),
  requiresAdminApproval: z.boolean().optional().default(false),
  isDestructive: z.boolean().optional().default(false),
});
export type ArticleStepInput = z.infer<typeof articleStepSchema>;

export const articleImageSchema = z.object({
  id: z.string().uuid().optional(),
  stepId: z.string().uuid().nullish(),
  label: z.string().max(200).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  /** URL returned by the API after upload (or an existing absolute URL). */
  url: z.string().min(1),
  storagePath: z.string().max(500).optional(),
  mimetype: z.string().max(120).optional(),
  width: z.number().int().nullish(),
  height: z.number().int().nullish(),
  position: z.number().int().min(0).optional().default(0),
});
export type ArticleImageInput = z.infer<typeof articleImageSchema>;

export const articleInputSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(300),
  category: z
    .string()
    .min(1)
    .max(120)
    .default(ARTICLE_CATEGORIES[ARTICLE_CATEGORIES.length - 1] as string),
  issueDescription: z.string().max(8000).optional().default(''),
  symptoms: z.array(z.string().max(500)).max(50).optional().default([]),
  troubleshootingSteps: z.string().max(20000).optional().default(''),
  expectedResult: z.string().max(4000).optional().default(''),
  failureResult: z.string().max(4000).optional().default(''),
  nextStep: z.string().max(4000).optional().default(''),
  escalationInstructions: z.string().max(4000).optional().default(''),
  tags: z.array(z.string().max(80)).max(50).optional().default([]),
  keywords: z.array(z.string().max(80)).max(80).optional().default([]),
  priority: z.enum(ARTICLE_PRIORITIES).optional().default('normal'),
  isActive: z.boolean().optional().default(true),
  notes: z.string().max(8000).optional().default(''),
  sourceDocumentId: z.string().uuid().nullish(),
  steps: z.array(articleStepSchema).max(100).optional().default([]),
  images: z.array(articleImageSchema).max(50).optional().default([]),
});
export type ArticleInput = z.infer<typeof articleInputSchema>;

export const articleUpdateSchema = articleInputSchema.partial().extend({
  version: z.number().int().optional(),
});
export type ArticleUpdateInput = z.infer<typeof articleUpdateSchema>;

export const articleQuerySchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(120).optional(),
  priority: z.enum(ARTICLE_PRIORITIES).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  tags: z.string().max(400).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['relevance', 'updated', 'created', 'title', 'priority']).default('relevance'),
});
export type ArticleQuery = z.infer<typeof articleQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Documents (knowledge-base import)                                           */
/* -------------------------------------------------------------------------- */

export const documentSourceTypeSchema = z.enum(DOCUMENT_SOURCE_TYPES);
export type DocumentSourceTypeInput = z.infer<typeof documentSourceTypeSchema>;

/* -------------------------------------------------------------------------- */
/* AI providers                                                                */
/* -------------------------------------------------------------------------- */

export const aiProviderIdSchema = z.enum(AI_PROVIDER_IDS);

export const aiProviderConfigInputSchema = z.object({
  provider: aiProviderIdSchema,
  label: z.string().max(120).optional(),
  enabled: z.boolean().optional().default(true),
  role: z.enum(['primary', 'fallback', 'disabled']).optional().default('primary'),
  model: z.string().min(1).max(120),
  /** Plain-text key. Stored encrypted; never returned by the API. */
  apiKey: z.string().max(400).optional(),
  baseUrl: z.string().url().max(400).optional(),
  temperature: z.number().min(0).max(2).optional().default(0.2),
  maxOutputTokens: z.number().int().min(128).max(32000).optional().default(2048),
  maxRetries: z.number().int().min(0).max(10).optional().default(2),
  timeoutMs: z.number().int().min(2000).max(300000).optional().default(90000),
  visionEnabled: z.boolean().optional().default(true),
  /** USD per 1M input / output tokens. Used for cost estimates. */
  inputCostPerMillion: z.number().min(0).max(1000).optional().default(0),
  outputCostPerMillion: z.number().min(0).max(1000).optional().default(0),
});
export type AiProviderConfigInput = z.infer<typeof aiProviderConfigInputSchema>;

export const aiProviderUpdateSchema = z.object({
  primaryProvider: aiProviderIdSchema.optional(),
  fallbackProvider: aiProviderIdSchema.optional(),
  providers: z.array(aiProviderConfigInputSchema).max(10),
});
export type AiProviderUpdateInput = z.infer<typeof aiProviderUpdateSchema>;

export const aiOperationSchema = z.enum(AI_OPERATIONS);

/* -------------------------------------------------------------------------- */
/* AI instructions                                                             */
/* -------------------------------------------------------------------------- */

export const aiInstructionsInputSchema = z.object({
  content: z.string().min(20, 'Instructions are too short to be useful').max(60000),
  changeNote: z.string().max(500).optional(),
  activate: z.boolean().optional().default(true),
});
export type AiInstructionsInput = z.infer<typeof aiInstructionsInputSchema>;

/* -------------------------------------------------------------------------- */
/* Slack configuration                                                         */
/* -------------------------------------------------------------------------- */

export const slackConfigInputSchema = z.object({
  botToken: z.string().max(400).optional(),
  signingSecret: z.string().max(400).optional(),
  appToken: z.string().max(400).optional(),
  channels: z
    .array(
      z.object({
        channelId: z.string().regex(/^[CDG][A-Z0-9]{2,}$/, 'Channel IDs look like C0123ABCD'),
        name: z.string().max(120).optional(),
        isActive: z.boolean().optional().default(true),
      }),
    )
    .max(50)
    .default([]),
  triggerEmoji: z.string().min(1).max(80).default(DEFAULT_TRIGGER_EMOJI),
  enableMentions: z.boolean().optional().default(false),
  allowedUserIds: z.array(z.string().max(64)).max(500).default([]),
  verifySignature: z.boolean().optional().default(true),
  /** Respond in thread only (recommended). */
  threadOnly: z.boolean().optional().default(true),
  /** Extra safety: refuse to answer if the agent's message contains credentials. */
  redactSecrets: z.boolean().optional().default(true),
});
export type SlackConfigInput = z.infer<typeof slackConfigInputSchema>;

/* -------------------------------------------------------------------------- */
/* Troubleshooting settings                                                    */
/* -------------------------------------------------------------------------- */

export const troubleshootingSettingsInputSchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  escalationInfoItems: z.array(z.string().max(200)).max(20),
  sessionStaleAfterHours: z.number().int().min(1).max(720),
  maxScreenshotsPerMessage: z.number().int().min(0).max(10),
  maxAttachmentBytes: z.number().int().min(1024).max(104857600),
  kbMaxArticles: z.number().int().min(1).max(10),
  kbMaxSteps: z.number().int().min(1).max(30),
  /** Human escalation contact shown to agents. */
  escalationContact: z.string().max(300).optional(),
  /** Slack user IDs pinged on escalation (optional). */
  escalationNotifyUserIds: z.array(z.string().max(64)).max(50).default([]),
  /** Primary IT technician Slack user ID (for mentions). */
  itTechnicianUserId: z.string().max(64).optional(),
  /** Slack group mention to include in CC (e.g. <!subteam^S0123|@it-team>). */
  escalationCcGroup: z.string().max(100).optional(),
  /** SLA in hours for IT to resolve escalated tickets. */
  escalationSlaHours: z.number().int().min(1).max(336).default(24),
});
export type TroubleshootingSettingsInput = z.infer<typeof troubleshootingSettingsInputSchema>;

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export const sessionStatusSchema = z.enum(SESSION_STATUSES);

export const sessionQuerySchema = z.object({
  status: z
    .union([sessionStatusSchema, z.array(sessionStatusSchema)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  channelId: z.string().max(64).optional(),
  agentId: z.string().max(64).optional(),
  provider: aiProviderIdSchema.optional(),
  q: z.string().max(200).optional(),
  escalated: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SessionQuery = z.infer<typeof sessionQuerySchema>;

/** The structured troubleshooting state persisted for every session. */
export const troubleshootingStateSchema = z.object({
  issue: z.string().default(''),
  diagnosis: z.string().default(''),
  stepsCompleted: z.array(z.string()).default([]),
  stepsFailed: z.array(z.string()).default([]),
  currentStep: z.string().default(''),
  observations: z.array(z.string()).default([]),
  possibleCauses: z.array(z.string()).default([]),
  resolutionStatus: z.enum(['in_progress', 'resolved', 'escalated', 'abandoned']).default('in_progress'),
  escalationRequired: z.boolean().default(false),
  /** Total troubleshooting steps in the article(s) we are following. */
  kbTotalSteps: z.number().int().min(0).max(50).default(0),
  /** How many KB steps the agent has completed/acknowledged. */
  kbStepsCompleted: z.number().int().min(0).max(50).default(0),
  /** Last retrieved KB article title used to count steps. */
  kbLastArticleTitle: z.string().max(200).default(''),
});
export type TroubleshootingState = z.infer<typeof troubleshootingStateSchema>;

export const adminSessionActionSchema = z.object({
  action: z.enum([
    'pause',
    'resume',
    'close',
    'resolve',
    'escalate',
    'reopen',
    'note',
    'set_article',
    'reset_state',
    'set_status',
  ]),
  note: z.string().max(4000).optional(),
  articleId: z.string().uuid().optional(),
  status: sessionStatusSchema.optional(),
  state: troubleshootingStateSchema.partial().optional(),
});
export type AdminSessionAction = z.infer<typeof adminSessionActionSchema>;

/* -------------------------------------------------------------------------- */
/* Auth                                                                        */
/* -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  password: z.string().min(12, 'Use at least 12 characters').max(200),
  role: z.enum(['admin', 'viewer']).default('viewer'),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Moves an account created before the Supabase link onto Supabase Auth. */
export const linkSupabaseAuthSchema = z.object({
  password: z.string().min(12, 'Use at least 12 characters').max(200),
});
export type LinkSupabaseAuthInput = z.infer<typeof linkSupabaseAuthSchema>;

/* -------------------------------------------------------------------------- */
/* Generic API helpers                                                         */
/* -------------------------------------------------------------------------- */

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export const logQuerySchema = z.object({
  level: z.string().max(20).optional(),
  category: z.string().max(60).optional(),
  correlationId: z.string().max(80).optional(),
  sessionId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** Manual correction of the category a resolved issue was filed under. */
export const updateCategorizationSchema = z.object({
  subcategoryId: z.string().uuid('Invalid sub-category'),
  rationale: z.string().max(500).default(''),
});

export const issueReportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type { z };
