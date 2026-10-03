/**
 * Slack event de-duplication (§16).
 *
 * Slack retries deliveries. Every envelope has a unique `event_id`; we insert a
 * `processed_events` row first and only run the handler when the insert wins.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { processedEvents } from '../../db/schema.js';
import { log } from '../logging/service.js';

export type ProcessedEventStatus = 'processing' | 'processed' | 'failed' | 'duplicate';

export interface ClaimEventInput {
  slackEventId: string;
  eventType: string;
  teamId?: string | null;
  channelId?: string | null;
  messageTs?: string | null;
  payload?: unknown;
  correlationId?: string | null;
}

export interface ClaimResult {
  claimed: boolean;
  id: string | null;
}

/** Atomically claims an event. `claimed: false` means it was already seen. */
export async function claimEvent(input: ClaimEventInput): Promise<ClaimResult> {
  try {
    const rows = await db
      .insert(processedEvents)
      .values({
        slackEventId: input.slackEventId,
        eventType: input.eventType,
        teamId: input.teamId ?? null,
        channelId: input.channelId ?? null,
        messageTs: input.messageTs ?? null,
        status: 'processing',
        payload: (input.payload ?? null) as never,
        correlationId: input.correlationId ?? null,
      })
      .onConflictDoNothing({ target: processedEvents.slackEventId })
      .returning({ id: processedEvents.id });

    const row = rows[0];
    if (!row) {
      log.debug(
        { category: 'slack', slackEventId: input.slackEventId },
        'Duplicate Slack event ignored',
      );
      return { claimed: false, id: null };
    }
    return { claimed: true, id: row.id };
  } catch (error) {
    log.error(
      { category: 'slack', error, slackEventId: input.slackEventId },
      'Failed to claim Slack event',
    );
    return { claimed: false, id: null };
  }
}

export async function finishEvent(
  id: string,
  status: Exclude<ProcessedEventStatus, 'processing'>,
  error?: unknown,
): Promise<void> {
  const message =
    error === undefined
      ? null
      : (error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error));
  await db
    .update(processedEvents)
    .set({
      status,
      error: message?.slice(0, 4000) ?? null,
      processedAt: new Date(),
    })
    .where(eq(processedEvents.id, id))
    .catch((updateError: unknown) => {
      log.error({ category: 'slack', error: updateError }, 'Failed to finalise Slack event');
    });
}
