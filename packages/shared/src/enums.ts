/**
 * Shared domain enums and constants.
 * Single source of truth for the API and the admin dashboard.
 */

export const SESSION_STATUSES = [
  'in_progress',
  'assigned',
  'waiting_on_user',
  'paused',
  'resolved',
  'escalated',
  'closed',
  'abandoned',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const RESOLUTION_STATUSES = [
  'in_progress',
  'resolved',
  'escalated',
  'abandoned',
] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export const TIMELINE_ENTRY_KINDS = [
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
] as const;
export type TimelineEntryKind = (typeof TIMELINE_ENTRY_KINDS)[number];

export const TIMELINE_ROLES = ['agent', 'bot', 'admin', 'system'] as const;
export type TimelineRole = (typeof TIMELINE_ROLES)[number];

export const ARTICLE_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type ArticlePriority = (typeof ARTICLE_PRIORITIES)[number];

export const ARTICLE_CATEGORIES = [
  'Network',
  'VPN',
  'Hardware',
  'Software',
  'Accounts & Access',
  'Email',
  'Telephony',
  'Printing',
  'Security',
  'Performance',
  'Remote Access',
  'Other',
] as const;
export type ArticleCategory = (typeof ARTICLE_CATEGORIES)[number] | (string & {});

export const DOCUMENT_SOURCE_TYPES = ['markdown', 'pdf', 'image', 'text'] as const;
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number];

export const DOCUMENT_STATUSES = ['pending', 'processing', 'indexed', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const AI_PROVIDER_IDS = ['gemini', 'openai'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_OPERATIONS = [
  'analyzeMessage',
  'analyzeImage',
  'generateTroubleshootingResponse',
  'summarizeThread',
  'classifyIssue',
  'detectResolution',
  'detectEscalation',
] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

export const ESCALATION_STATUSES = ['open', 'acknowledged', 'closed'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const USER_ROLES = ['admin', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const SETTING_KEYS = {
  slack: 'slack.config',
  troubleshooting: 'troubleshooting.config',
  aiDefaults: 'ai.defaults',
  system: 'system.config',
} as const;

export const DEFAULT_TRIGGER_EMOJI = ':troubleshoot:';

export const DEFAULT_AI_INSTRUCTIONS = `You are an internal IT troubleshooting assistant helping remote customer-support agents.

Your primary source of truth is the company's troubleshooting knowledge base.
Follow documented troubleshooting procedures whenever applicable.

Do not invent company policies, credentials, URLs, configuration values, or procedures.

When the documentation does not contain a solution, you may use your technical reasoning to suggest safe troubleshooting steps.

Never instruct agents to expose passwords, authentication tokens, API keys, or other sensitive credentials.

Provide instructions one logical step at a time.
After providing a step, wait for the agent's response before moving to the next major step.

Always consider the agent's latest response and previous troubleshooting attempts.
Do not repeat steps that have already failed unless there is a specific reason.

If the issue cannot be safely resolved, recommend escalation to IT.

Keep Slack responses concise and easy to follow.

Never claim that an issue is resolved unless the agent confirms it.`;
