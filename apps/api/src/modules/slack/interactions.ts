/**
 * Slack interactivity handler (§5, quick replies).
 *
 * Clicking a quick-reply button on a clarifying question is treated exactly
 * like the agent typing that option into the thread: the answer flows through
 * the normal troubleshooting engine so the session continues.
 */
import { errorMessage } from '../../lib/errors.js';
import { correlationId as newCorrelationId } from '../../lib/ids.js';
import { log } from '../logging/service.js';
import { handleAgentMessage } from '../troubleshooting/engine.js';
import { slackCall } from './client.js';
import type { SlackBlockActionPayload } from './types.js';

const OPTION_ACTION_PREFIX = 'hdai_opt_';

export async function handleSlackInteraction(payload: SlackBlockActionPayload): Promise<void> {
  if (payload.type !== 'block_actions') {
    log.debug({ category: 'slack' }, `Ignoring Slack interaction of type ${payload.type}`);
    return;
  }

  const action = (payload.actions ?? []).find((entry) =>
    entry.action_id?.startsWith(OPTION_ACTION_PREFIX),
  );
  if (!action) return;

  const channelId = payload.channel?.id;
  const threadTs = payload.message?.thread_ts ?? payload.message?.ts;
  const userId = payload.user?.id;
  const text = action.value?.trim();

  if (!channelId || !threadTs || !userId || !text) {
    log.warn(
      { category: 'slack', actionId: action.action_id },
      'Incomplete Slack button interaction',
    );
    return;
  }

  const correlationId = newCorrelationId();

  // Remove the buttons so the same question cannot be answered twice.
  await stripOptionButtons(payload).catch((error: unknown) => {
    log.debug({ category: 'slack', error: errorMessage(error) }, 'Could not strip option buttons');
  });

  await handleAgentMessage({
    channelId,
    threadTs,
    messageTs: syntheticMessageTs(payload.message?.ts),
    agentId: userId,
    text,
    files: [],
    eventId: `block_action:${payload.message?.ts ?? threadTs}:${action.action_id ?? 'option'}:${userId}`,
    correlationId,
  });
}

/** Best-effort `chat.update` that removes the actions block from the question. */
async function stripOptionButtons(payload: SlackBlockActionPayload): Promise<void> {
  const channelId = payload.channel?.id;
  const ts = payload.message?.ts;
  const blocks = payload.message?.blocks;
  if (!channelId || !ts || !Array.isArray(blocks)) return;

  const filtered = blocks.filter((block) => block.type !== 'actions');
  if (filtered.length === blocks.length) return;

  await slackCall('chat.update', {
    channel: channelId,
    ts,
    text: payload.message?.text ?? '',
    blocks:
      filtered.length > 0
        ? filtered
        : [{ type: 'section', text: { type: 'mrkdwn', text: payload.message?.text ?? 'Answered.' } }],
  });
}

/** Unique, time-ordered timestamp for a choice that was never posted to Slack. */
function syntheticMessageTs(questionTs: string | undefined): string {
  const now = Date.now() / 1000;
  const base = Number.parseFloat(questionTs ?? '');
  const value = Number.isFinite(base) && now <= base ? base + 0.000001 : now;
  return value.toFixed(6);
}
