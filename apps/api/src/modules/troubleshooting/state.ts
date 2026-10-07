/**
 * Troubleshooting session state helpers (§3, §28).
 *
 * The structured state is persisted in `troubleshooting_sessions.state` so the
 * bot can rebuild its understanding of a thread without replaying Slack history.
 */
import { sql } from 'drizzle-orm';
import type { ResolutionStatus, SessionStatus, TroubleshootingState } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { troubleshootingSessions } from '../../db/schema.js';
import { formatSessionCode } from '../../lib/ids.js';
import { AppError } from '../../lib/errors.js';

export function emptyState(): TroubleshootingState {
  return {
    issue: '',
    diagnosis: '',
    stepsCompleted: [],
    stepsFailed: [],
    currentStep: '',
    observations: [],
    possibleCauses: [],
    resolutionStatus: 'in_progress',
    escalationRequired: false,
    kbTotalSteps: 0,
    kbStepsCompleted: 0,
    kbLastArticleTitle: '',
  };
}

export function normalizeState(value: unknown): TroubleshootingState {
  if (!value || typeof value !== 'object') return emptyState();
  const state = value as Partial<TroubleshootingState>;
  return {
    issue: state.issue ?? '',
    diagnosis: state.diagnosis ?? '',
    stepsCompleted: Array.isArray(state.stepsCompleted) ? state.stepsCompleted : [],
    stepsFailed: Array.isArray(state.stepsFailed) ? state.stepsFailed : [],
    currentStep: state.currentStep ?? '',
    observations: Array.isArray(state.observations) ? state.observations : [],
    possibleCauses: Array.isArray(state.possibleCauses) ? state.possibleCauses : [],
    resolutionStatus: (state.resolutionStatus ?? 'in_progress') as ResolutionStatus,
    escalationRequired: Boolean(state.escalationRequired),
    kbTotalSteps: Number((state as any).kbTotalSteps) || 0,
    kbStepsCompleted: Number((state as any).kbStepsCompleted) || 0,
    kbLastArticleTitle: String((state as any).kbLastArticleTitle || ''),
  };
}

/** Generates the next `TS-YYYY-NNNNNN` code, retrying on the rare collision. */
export async function nextSessionCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(troubleshootingSessions)
      .where(sql`${troubleshootingSessions.createdAt} >= ${yearStart}`);
    return formatSessionCode((rows[0]?.count ?? 0) + 1 + attempt);
  }
  throw AppError.internal('Could not allocate a session code');
}

export interface TimelineInput {
  sessionId: string;
  role: 'agent' | 'bot' | 'admin' | 'system';
  kind:
    | 'trigger'
    | 'analysis'
    | 'instruction'
    | 'agent_reply'
    | 'screenshot'
    | 'resolution'
    | 'escalation'
    | 'note'
    | 'error'
    | 'admin_action'
    | 'state_change';
  summary: string;
  content?: string;
  slackMessageTs?: string | null;
  slackUserName?: string | null;
  articleIds?: string[];
  metadata?: Record<string, unknown> | null;
  provider?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

/** Appends a timeline entry, computing the sequence number atomically. */
export async function addTimelineEntry(input: TimelineInput): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.execute(sql`
        INSERT INTO troubleshooting_timeline
          (session_id, seq, role, kind, summary, content, slack_message_ts, slack_user_name,
           article_ids, metadata, provider, model, input_tokens, output_tokens, created_at)
        VALUES (
          ${input.sessionId},
          (SELECT COALESCE(MAX(seq), 0) + 1 FROM troubleshooting_timeline WHERE session_id = ${input.sessionId}),
          ${input.role}::timeline_role,
          ${input.kind}::timeline_kind,
          ${input.summary.slice(0, 500)},
          ${input.content ?? ''},
          ${input.slackMessageTs ?? null},
          ${input.slackUserName ?? null},
          ${sql.param(input.articleIds ?? [])}::uuid[],
          ${(input.metadata ?? null) as never},
          ${(input.provider ?? null) as never},
          ${input.model ?? null},
          ${input.inputTokens ?? null},
          ${input.outputTokens ?? null},
          now()
        )
      `);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('23505') && attempt < 2) continue; // unique violation → retry
      throw error;
    }
  }
}

export function statusForResolution(status: ResolutionStatus): SessionStatus {
  switch (status) {
    case 'resolved':
      return 'resolved';
    case 'escalated':
      return 'escalated';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'in_progress';
  }
}

export function isTerminal(status: SessionStatus): boolean {
  return status === 'resolved' || status === 'closed' || status === 'escalated' || status === 'abandoned';
}

export function isActive(status: SessionStatus): boolean {
  return status === 'in_progress' || status === 'paused';
}
