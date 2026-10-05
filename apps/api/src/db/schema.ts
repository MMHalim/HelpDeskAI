/**
 * PostgreSQL schema (Drizzle ORM).
 *
 * Naming: snake_case columns, camelCase in TypeScript.
 * All timestamps are `timestamptz` in UTC.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { TroubleshootingState } from '@helpdesk/shared';

/** PostgreSQL full-text search vector, maintained by a generated column. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const userRoleEnum = pgEnum('user_role', ['admin', 'viewer']);
export const sessionStatusEnum = pgEnum('session_status', [
  'in_progress',
  'assigned',
  'waiting_on_user',
  'paused',
  'resolved',
  'escalated',
  'closed',
  'abandoned',
]);
export const resolutionStatusEnum = pgEnum('resolution_status', [
  'in_progress',
  'resolved',
  'escalated',
  'abandoned',
]);
export const timelineRoleEnum = pgEnum('timeline_role', ['agent', 'bot', 'admin', 'system']);
export const timelineKindEnum = pgEnum('timeline_kind', [
  'trigger',
  'analysis',
  'instruction',
  'agent_reply',
  'screenshot',
  'resolution',
  'escalation',
  'note',
  'error',
  'admin_action',
  'state_change',
]);
export const articlePriorityEnum = pgEnum('article_priority', ['low', 'normal', 'high', 'critical']);
export const documentSourceTypeEnum = pgEnum('document_source_type', [
  'markdown',
  'pdf',
  'image',
  'text',
]);
export const documentStatusEnum = pgEnum('document_status', [
  'pending',
  'processing',
  'indexed',
  'failed',
]);
export const aiProviderEnum = pgEnum('ai_provider', ['gemini', 'openai']);
export const aiProviderRoleEnum = pgEnum('ai_provider_role', ['primary', 'fallback', 'disabled']);
export const escalationStatusEnum = pgEnum('escalation_status', ['open', 'acknowledged', 'closed']);
export const incidentPriorityEnum = pgEnum('incident_priority', ['critical', 'high', 'medium', 'low']);
export const categorizationSourceEnum = pgEnum('categorization_source', ['ai', 'manual']);
export const processedEventStatusEnum = pgEnum('processed_event_status', [
  'processing',
  'processed',
  'failed',
  'duplicate',
]);
export const logLevelEnum = pgEnum('log_level', ['debug', 'info', 'warn', 'error', 'fatal']);

/* -------------------------------------------------------------------------- */
/* Identity & access                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Minimal view of Supabase Auth's `auth.users`, declared only so `users` can
 * carry a real foreign key to its identity. Never written to by the ORM.
 */
const authSchema = pgSchema('auth');

const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Identity in Supabase Auth (`auth.users`). Credentials live there: a
     * non-null value means the password is verified by GoTrue, so
     * `password_hash` is null. Rows created before the Supabase link keep a
     * local hash and are migrated by `linkUserToSupabaseAuth`.
     */
    authUserId: uuid('auth_user_id'),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('viewer'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_auth_user_id_key').on(t.authUserId),
    foreignKey({
      name: 'users_auth_user_id_fkey',
      columns: [t.authUserId],
      foreignColumns: [authUsers.id],
    }).onDelete('set null'),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_sessions_token_hash_key').on(t.tokenHash),
    index('auth_sessions_user_id_idx').on(t.userId),
    index('auth_sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Slack                                                                       */
/* -------------------------------------------------------------------------- */

export const slackUsers = pgTable(
  'slack_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slackUserId: varchar('slack_user_id', { length: 64 }).notNull(),
    teamId: varchar('team_id', { length: 64 }),
    name: varchar('name', { length: 120 }),
    realName: varchar('real_name', { length: 120 }),
    displayName: varchar('display_name', { length: 120 }),
    email: varchar('email', { length: 320 }),
    isBot: boolean('is_bot').notNull().default(false),
    timezone: varchar('timezone', { length: 80 }),
    raw: jsonb('raw'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('slack_users_slack_user_id_key').on(t.slackUserId),
    index('slack_users_name_idx').on(t.name),
  ],
);

export const slackChannels = pgTable(
  'slack_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: varchar('channel_id', { length: 64 }).notNull(),
    name: varchar('name', { length: 120 }).notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    isPrivate: boolean('is_private').notNull().default(false),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('slack_channels_channel_id_key').on(t.channelId)],
);

export const slackMessages = pgTable(
  'slack_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slackMessageTs: varchar('slack_message_ts', { length: 40 }).notNull(),
    channelId: varchar('channel_id', { length: 64 }).notNull(),
    threadTs: varchar('thread_ts', { length: 40 }),
    userId: varchar('user_id', { length: 64 }),
    userName: varchar('user_name', { length: 120 }),
    isBot: boolean('is_bot').notNull().default(false),
    text: text('text').notNull().default(''),
    subtype: varchar('subtype', { length: 60 }),
    permalink: text('permalink'),
    sessionId: uuid('session_id'),
    hasFiles: boolean('has_files').notNull().default(false),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('slack_messages_channel_ts_key').on(t.channelId, t.slackMessageTs),
    index('slack_messages_thread_ts_idx').on(t.channelId, t.threadTs),
    index('slack_messages_session_id_idx').on(t.sessionId),
  ],
);

export const slackFiles = pgTable(
  'slack_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slackFileId: varchar('slack_file_id', { length: 64 }).notNull(),
    messageTs: varchar('message_ts', { length: 40 }).notNull(),
    channelId: varchar('channel_id', { length: 64 }).notNull(),
    threadTs: varchar('thread_ts', { length: 40 }),
    userId: varchar('user_id', { length: 64 }),
    name: varchar('name', { length: 400 }).notNull().default(''),
    title: varchar('title', { length: 400 }),
    mimetype: varchar('mimetype', { length: 160 }),
    size: integer('size').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    urlPrivate: text('url_private'),
    permalink: text('permalink'),
    storagePath: text('storage_path'),
    sha256: varchar('sha256', { length: 64 }),
    /** Cached vision-model analysis of the image (§7, §27). */
    analysis: jsonb('analysis').$type<Record<string, unknown> | null>(),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('slack_files_file_id_key').on(t.slackFileId),
    index('slack_files_message_ts_idx').on(t.channelId, t.messageTs),
  ],
);

export const processedEvents = pgTable(
  'processed_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slackEventId: varchar('slack_event_id', { length: 120 }).notNull(),
    eventType: varchar('event_type', { length: 80 }).notNull(),
    teamId: varchar('team_id', { length: 64 }),
    channelId: varchar('channel_id', { length: 64 }),
    messageTs: varchar('message_ts', { length: 40 }),
    status: processedEventStatusEnum('status').notNull().default('processing'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    payload: jsonb('payload'),
    correlationId: varchar('correlation_id', { length: 80 }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('processed_events_event_id_key').on(t.slackEventId),
    index('processed_events_status_idx').on(t.status),
    index('processed_events_received_at_idx').on(t.receivedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Knowledge base                                                              */
/* -------------------------------------------------------------------------- */

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 400 }).notNull(),
    sourceType: documentSourceTypeEnum('source_type').notNull(),
    filename: varchar('filename', { length: 400 }).notNull(),
    mimetype: varchar('mimetype', { length: 160 }),
    size: integer('size').notNull().default(0),
    pageCount: integer('page_count'),
    storagePath: text('storage_path'),
    extractedText: text('extracted_text').notNull().default(''),
    extractedChars: integer('extracted_chars').notNull().default(0),
    status: documentStatusEnum('status').notNull().default('pending'),
    error: text('error'),
    importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_status_idx').on(t.status),
    index('documents_created_at_idx').on(t.createdAt),
  ],
);

export const troubleshootingArticles = pgTable(
  'troubleshooting_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 300 }).notNull(),
    slug: varchar('slug', { length: 320 }).notNull(),
    category: varchar('category', { length: 120 }).notNull().default('Other'),
    issueDescription: text('issue_description').notNull().default(''),
    symptoms: text('symptoms').array().notNull().default(sql`ARRAY[]::text[]`),
    troubleshootingSteps: text('troubleshooting_steps').notNull().default(''),
    expectedResult: text('expected_result').notNull().default(''),
    failureResult: text('failure_result').notNull().default(''),
    nextStep: text('next_step').notNull().default(''),
    escalationInstructions: text('escalation_instructions').notNull().default(''),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    keywords: text('keywords').array().notNull().default(sql`ARRAY[]::text[]`),
    priority: articlePriorityEnum('priority').notNull().default('normal'),
    /** Taxonomy link used for incident reporting; does not affect retrieval. */
    subcategoryId: uuid('subcategory_id').references(() => issueSubcategories.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes').notNull().default(''),
    version: integer('version').notNull().default(1),
    sourceDocumentId: uuid('source_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    /** Weighted full-text index for retrieval (§17). */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(helpdesk_array_to_text(symptoms), '')), 'A') ||
          setweight(to_tsvector('english', coalesce(helpdesk_array_to_text(keywords), ' ') || ' ' || coalesce(helpdesk_array_to_text(tags), '')), 'A') ||
          setweight(to_tsvector('english', coalesce(issue_description, '') || ' ' || coalesce(troubleshooting_steps, '') || ' ' || coalesce(notes, '')), 'B')`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('troubleshooting_articles_slug_key').on(t.slug),
    index('troubleshooting_articles_category_idx').on(t.category),
    index('troubleshooting_articles_active_idx').on(t.isActive),
    index('troubleshooting_articles_priority_idx').on(t.priority),
    index('troubleshooting_articles_tags_idx').on(t.tags),
    index('troubleshooting_articles_search_vector_idx').using('gin', t.searchVector),
  ],
);

export const articleSteps = pgTable(
  'article_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => troubleshootingArticles.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    title: varchar('title', { length: 200 }).notNull().default(''),
    instruction: text('instruction').notNull(),
    expectedResult: text('expected_result').notNull().default(''),
    failureResult: text('failure_result').notNull().default(''),
    nextStep: text('next_step').notNull().default(''),
    escalationInstructions: text('escalation_instructions').notNull().default(''),
    /** Steps that touch security controls or data loss require explicit approval. */
    requiresAdminApproval: boolean('requires_admin_approval').notNull().default(false),
    isDestructive: boolean('is_destructive').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('article_steps_article_id_idx').on(t.articleId),
    uniqueIndex('article_steps_article_position_key').on(t.articleId, t.position),
  ],
);

export const articleImages = pgTable(
  'article_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => troubleshootingArticles.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id').references(() => articleSteps.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 200 }).notNull().default(''),
    description: text('description').notNull().default(''),
    storagePath: text('storage_path'),
    url: text('url').notNull(),
    mimetype: varchar('mimetype', { length: 160 }),
    width: integer('width'),
    height: integer('height'),
    sha256: varchar('sha256', { length: 64 }),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('article_images_article_id_idx').on(t.articleId),
    index('article_images_step_id_idx').on(t.stepId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Troubleshooting sessions                                                    */
/* -------------------------------------------------------------------------- */

export const troubleshootingSessions = pgTable(
  'troubleshooting_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human readable code, e.g. TS-2026-000123. */
    sessionCode: varchar('session_code', { length: 32 }).notNull(),
    status: sessionStatusEnum('status').notNull().default('in_progress'),
    resolutionStatus: resolutionStatusEnum('resolution_status').notNull().default('in_progress'),
    escalationRequired: boolean('escalation_required').notNull().default(false),

    channelId: varchar('channel_id', { length: 64 }).notNull(),
    channelName: varchar('channel_name', { length: 120 }),
    threadTs: varchar('thread_ts', { length: 40 }).notNull(),
    triggerMessageTs: varchar('trigger_message_ts', { length: 40 }).notNull(),
    triggerEventId: varchar('trigger_event_id', { length: 120 }),
    permalink: text('permalink'),

    slackUserId: varchar('slack_user_id', { length: 64 }).notNull(),
    agentName: varchar('agent_name', { length: 120 }),
    agentDisplayName: varchar('agent_display_name', { length: 120 }),

    issueTitle: varchar('issue_title', { length: 300 }).notNull().default('Pending analysis'),
    issueSummary: text('issue_summary').notNull().default(''),
    diagnosis: text('diagnosis').notNull().default(''),
    originalMessage: text('original_message').notNull().default(''),
    /** Structured troubleshooting state (§3, §28). */
    state: jsonb('state')
      .$type<TroubleshootingState>()
      .notNull()
      .default({
        issue: '',
        diagnosis: '',
        stepsCompleted: [],
        stepsFailed: [],
        currentStep: '',
        observations: [],
        possibleCauses: [],
        resolutionStatus: 'in_progress',
        escalationRequired: false,
      }),
    attemptCount: integer('attempt_count').notNull().default(0),
    articleIds: uuid('article_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    /** Pinned by an admin, always included in retrieval. */
    pinnedArticleId: uuid('pinned_article_id').references(() => troubleshootingArticles.id, {
      onDelete: 'set null',
    }),

    aiProvider: aiProviderEnum('ai_provider'),
    aiModel: varchar('ai_model', { length: 120 }),
    lastOperation: varchar('last_operation', { length: 60 }),

    adminPaused: boolean('admin_paused').notNull().default(false),
    adminPauseReason: text('admin_pause_reason'),
    adminNotes: jsonb('admin_notes')
      .$type<Array<{ id: string; note: string; createdAt: string; userName: string | null }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    totalInputTokens: integer('total_input_tokens').notNull().default(0),
    totalOutputTokens: integer('total_output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    estimatedCost: doublePrecision('estimated_cost').notNull().default(0),

    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    lastAgentReplyAt: timestamp('last_agent_reply_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('troubleshooting_sessions_session_code_key').on(t.sessionCode),
    uniqueIndex('troubleshooting_sessions_thread_key').on(t.channelId, t.threadTs),
    index('troubleshooting_sessions_status_idx').on(t.status),
    index('troubleshooting_sessions_resolution_status_idx').on(t.resolutionStatus),
    index('troubleshooting_sessions_channel_thread_idx').on(t.channelId, t.threadTs),
    index('troubleshooting_sessions_user_idx').on(t.slackUserId),
    index('troubleshooting_sessions_created_at_idx').on(t.createdAt),
    index('troubleshooting_sessions_last_activity_idx').on(t.lastActivityAt),
  ],
);

export const troubleshootingTimeline = pgTable(
  'troubleshooting_timeline',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => troubleshootingSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    role: timelineRoleEnum('role').notNull(),
    kind: timelineKindEnum('kind').notNull(),
    summary: varchar('summary', { length: 500 }).notNull().default(''),
    content: text('content').notNull().default(''),
    slackMessageTs: varchar('slack_message_ts', { length: 40 }),
    slackUserName: varchar('slack_user_name', { length: 120 }),
    articleIds: uuid('article_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    provider: aiProviderEnum('provider'),
    model: varchar('model', { length: 120 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('troubleshooting_timeline_session_seq_key').on(t.sessionId, t.seq),
    index('troubleshooting_timeline_session_idx').on(t.sessionId),
    index('troubleshooting_timeline_created_at_idx').on(t.createdAt),
  ],
);

export const escalations = pgTable(
  'escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => troubleshootingSessions.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull().default(''),
    requiredInfo: text('required_info').array().notNull().default(sql`ARRAY[]::text[]`),
    status: escalationStatusEnum('status').notNull().default('open'),
    escalatedBy: varchar('escalated_by', { length: 40 }).notNull().default('ai'),
    slackMessageTs: varchar('slack_message_ts', { length: 40 }),
    escalatedTo: varchar('escalated_to', { length: 200 }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('escalations_session_id_idx').on(t.sessionId),
    index('escalations_status_idx').on(t.status),
    index('escalations_created_at_idx').on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Incident taxonomy and categorization                                       */
/* -------------------------------------------------------------------------- */

/**
 * Macro categories for resolved incidents ("Internet Issues", "CRM Issues").
 *
 * Deliberately separate from `troubleshooting_articles.category`, which drives
 * knowledge-base retrieval: an article is filed under whatever category helps
 * the AI find it, while a resolved incident is reported under the operational
 * taxonomy the support organisation counts on.
 */
export const issueCategories = pgTable(
  'issue_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    description: text('description').notNull().default(''),
    /** Historical incident count, kept only as a reporting baseline. */
    baselineIncidentCount: integer('baseline_incident_count').notNull().default(0),
    baselinePercentage: doublePrecision('baseline_percentage').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('issue_categories_slug_key').on(t.slug),
    uniqueIndex('issue_categories_name_key').on(t.name),
    index('issue_categories_sort_order_idx').on(t.sortOrder),
  ],
);

/**
 * Specific sub-categories ("Message Delivery Failures"), each carrying the
 * operational priority and queue impact used for reporting.
 */
export const issueSubcategories = pgTable(
  'issue_subcategories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => issueCategories.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    slug: varchar('slug', { length: 180 }).notNull(),
    description: text('description').notNull().default(''),
    /** Queue impact when this sub-category is hit. */
    priorityLevel: incidentPriorityEnum('priority_level').notNull().default('medium'),
    operationalImpact: text('operational_impact').notNull().default(''),
    /** Historical incident count, kept only as a reporting baseline. */
    baselineIncidentCount: integer('baseline_incident_count').notNull().default(0),
    baselinePercentage: doublePrecision('baseline_percentage').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('issue_subcategories_slug_key').on(t.slug),
    uniqueIndex('issue_subcategories_category_name_key').on(t.categoryId, t.name),
    index('issue_subcategories_category_idx').on(t.categoryId),
    index('issue_subcategories_priority_idx').on(t.priorityLevel),
  ],
);

/**
 * The category a resolved issue was filed under, written once the agent
 * confirms resolution (§32). One row per session; a manual override replaces
 * the AI choice and flips `source` to "manual".
 */
export const issueCategorizations = pgTable(
  'issue_categorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => troubleshootingSessions.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => issueCategories.id, { onDelete: 'restrict' }),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => issueSubcategories.id, { onDelete: 'restrict' }),
    source: categorizationSourceEnum('source').notNull().default('ai'),
    confidence: doublePrecision('confidence').notNull().default(0),
    rationale: text('rationale').notNull().default(''),
    categorizedBy: uuid('categorized_by').references(() => users.id, { onDelete: 'set null' }),
    categorizedAt: timestamp('categorized_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('issue_categorizations_session_key').on(t.sessionId),
    index('issue_categorizations_category_idx').on(t.categoryId),
    index('issue_categorizations_subcategory_idx').on(t.subcategoryId),
    index('issue_categorizations_categorized_at_idx').on(t.categorizedAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* AI configuration, usage and observability                                  */
/* -------------------------------------------------------------------------- */

export const aiProviders = pgTable(
  'ai_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: aiProviderEnum('provider').notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    role: aiProviderRoleEnum('role').notNull().default('primary'),
    enabled: boolean('enabled').notNull().default(true),
    model: varchar('model', { length: 120 }).notNull(),
    /** AES-256-GCM ciphertext. Plain keys never touch the database. */
    apiKeyEncrypted: text('api_key_encrypted'),
    apiKeyPreview: varchar('api_key_preview', { length: 24 }),
    baseUrl: varchar('base_url', { length: 400 }),
    temperature: doublePrecision('temperature').notNull().default(0.2),
    maxOutputTokens: integer('max_output_tokens').notNull().default(2048),
    maxRetries: integer('max_retries').notNull().default(2),
    timeoutMs: integer('timeout_ms').notNull().default(90000),
    visionEnabled: boolean('vision_enabled').notNull().default(true),
    inputCostPerMillion: doublePrecision('input_cost_per_million').notNull().default(0),
    outputCostPerMillion: doublePrecision('output_cost_per_million').notNull().default(0),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_providers_provider_key').on(t.provider)],
);

export const aiInstructions = pgTable(
  'ai_instructions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(false),
    changeNote: varchar('change_note', { length: 500 }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_instructions_active_idx').on(t.isActive)],
);

export const aiRequests = pgTable(
  'ai_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correlationId: varchar('correlation_id', { length: 80 }).notNull(),
    sessionId: uuid('session_id').references(() => troubleshootingSessions.id, {
      onDelete: 'set null',
    }),
    sessionCode: varchar('session_code', { length: 32 }),
    provider: aiProviderEnum('provider').notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    operation: varchar('operation', { length: 60 }).notNull(),
    success: boolean('success').notNull().default(false),
    isFallback: boolean('is_fallback').notNull().default(false),
    attempt: integer('attempt').notNull().default(1),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: text('error_message'),
    errorKind: varchar('error_kind', { length: 40 }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    estimatedCost: doublePrecision('estimated_cost').notNull().default(0),
    latencyMs: integer('latency_ms'),
    channelId: varchar('channel_id', { length: 64 }),
    threadTs: varchar('thread_ts', { length: 40 }),
    slackUserId: varchar('slack_user_id', { length: 64 }),
    promptChars: integer('prompt_chars').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_requests_created_at_idx').on(t.createdAt),
    index('ai_requests_provider_idx').on(t.provider),
    index('ai_requests_session_id_idx').on(t.sessionId),
    index('ai_requests_success_idx').on(t.success),
    index('ai_requests_correlation_id_idx').on(t.correlationId),
  ],
);

export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 120 }).primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  isSecret: boolean('is_secret').notNull().default(false),
  description: text('description'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userEmail: varchar('user_email', { length: 320 }),
    action: varchar('action', { length: 120 }).notNull(),
    entityType: varchar('entity_type', { length: 80 }),
    entityId: varchar('entity_id', { length: 120 }),
    summary: text('summary'),
    before: jsonb('before'),
    after: jsonb('after'),
    ipAddress: varchar('ip_address', { length: 64 }),
    correlationId: varchar('correlation_id', { length: 80 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_created_at_idx').on(t.createdAt),
    index('audit_logs_user_id_idx').on(t.userId),
    index('audit_logs_action_idx').on(t.action),
  ],
);

export const appLogs = pgTable(
  'app_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    level: logLevelEnum('level').notNull().default('info'),
    category: varchar('category', { length: 60 }).notNull(),
    message: text('message').notNull(),
    correlationId: varchar('correlation_id', { length: 80 }),
    sessionId: uuid('session_id'),
    sessionCode: varchar('session_code', { length: 32 }),
    provider: aiProviderEnum('provider'),
    errorStack: text('error_stack'),
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('app_logs_created_at_idx').on(t.createdAt),
    index('app_logs_level_idx').on(t.level),
    index('app_logs_category_idx').on(t.category),
    index('app_logs_correlation_id_idx').on(t.correlationId),
    index('app_logs_session_id_idx').on(t.sessionId),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof troubleshootingSessions.$inferSelect;
export type NewSession = typeof troubleshootingSessions.$inferInsert;
export type TimelineEntry = typeof troubleshootingTimeline.$inferSelect;
export type Article = typeof troubleshootingArticles.$inferSelect;
export type NewArticle = typeof troubleshootingArticles.$inferInsert;
export type ArticleStep = typeof articleSteps.$inferSelect;
export type ArticleImage = typeof articleImages.$inferSelect;
export type AiProviderRow = typeof aiProviders.$inferSelect;
export type AiRequestRow = typeof aiRequests.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type SlackMessageRow = typeof slackMessages.$inferSelect;
export type SlackFileRow = typeof slackFiles.$inferSelect;
export type EscalationRow = typeof escalations.$inferSelect;
export type AppLogRow = typeof appLogs.$inferSelect;
export type ProcessedEventRow = typeof processedEvents.$inferSelect;
