import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { log } from '../modules/logging/service.js';
import { claimEvent, finishEvent } from '../modules/events/service.js';
import { verifySlackRequest } from '../modules/slack/signature.js';
import { handleSlackEvent } from '../modules/slack/events.js';
import { handleSlackInteraction } from '../modules/slack/interactions.js';
import type {
  SlackBlockActionPayload,
  SlackEventEnvelope,
  SlackUrlVerification,
} from '../modules/slack/types.js';

export async function slackRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/slack/events',
    { config: { rateLimit: { max: env.rateLimit.slackEventsMax, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const rawBody = request.rawBody ?? JSON.stringify(request.body ?? {});

      const verification = await verifySlackRequest(request, rawBody);
      if (!verification.valid) {
        log.warn({ category: 'slack', reason: verification.reason }, 'Rejected Slack request');
        return reply.status(401).send({
          error: { code: 'SLACK_SIGNATURE_INVALID', message: verification.reason ?? 'Invalid signature' },
        });
      }

      const body = request.body as SlackEventEnvelope | SlackUrlVerification | undefined;
      if (!body) return reply.status(400).send({ error: { code: 'EMPTY_BODY', message: 'Empty payload' } });

      log.debug(
        {
          category: 'slack',
          bodyType: body.type,
          eventType: (body as SlackEventEnvelope).event?.type,
          eventId: (body as SlackEventEnvelope).event_id,
          retryNum: request.headers['x-slack-retry-num'],
          retryReason: request.headers['x-slack-retry-reason'],
        },
        'Slack events request received',
      );

      // Slack endpoint ownership check.
      if (body.type === 'url_verification') {
        return reply.send({ challenge: (body as SlackUrlVerification).challenge });
      }

      if (body.type !== 'event_callback') {
        return reply.send({ ok: true });
      }

      const envelope = body as SlackEventEnvelope;
      const event = envelope.event;
      const item = 'item' in event ? event.item : undefined;
      const claim = await claimEvent({
        slackEventId: envelope.event_id,
        eventType: event.type,
        teamId: envelope.team_id,
        channelId: event.channel ?? item?.channel ?? null,
        messageTs: event.ts ?? item?.ts ?? null,
        payload: envelope,
      });

      if (!claim.claimed || !claim.id) {
        return reply.send({ ok: true, duplicate: true });
      }

      const eventId = claim.id;
      // Acknowledge immediately; Slack retries if the response is slow.
      void handleSlackEvent(envelope)
        .then(() => finishEvent(eventId, 'processed'))
        .catch((error: unknown) => {
          log.error({ category: 'slack', error, eventId: envelope.event_id }, 'Slack event handling failed');
          return finishEvent(eventId, 'failed', error);
        });

      return reply.send({ ok: true });
    },
  );

  // Slack Interactivity: quick-reply buttons on clarifying questions.
  app.post(
    '/slack/interactions',
    { config: { rateLimit: { max: env.rateLimit.slackEventsMax, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const rawBody = request.rawBody ?? '';
      const verification = await verifySlackRequest(request, rawBody);
      if (!verification.valid) {
        log.warn({ category: 'slack', reason: verification.reason }, 'Rejected Slack interaction');
        return reply.status(401).send({
          error: {
            code: 'SLACK_SIGNATURE_INVALID',
            message: verification.reason ?? 'Invalid signature',
          },
        });
      }

      const body = request.body as { payload?: string } | undefined;
      const payloadRaw = body?.payload;
      if (!payloadRaw) {
        return reply
          .status(400)
          .send({ error: { code: 'EMPTY_BODY', message: 'Missing interaction payload' } });
      }

      let payload: SlackBlockActionPayload;
      try {
        payload = JSON.parse(payloadRaw) as SlackBlockActionPayload;
      } catch {
        return reply.status(400).send({
          error: { code: 'INVALID_PAYLOAD', message: 'Interaction payload is not valid JSON' },
        });
      }

      // Acknowledge immediately; Slack requires a fast 200 response.
      void handleSlackInteraction(payload).catch((error: unknown) => {
        log.error({ category: 'slack', error }, 'Slack interaction handling failed');
      });

      return reply.send({ ok: true });
    },
  );
}
