/**
 * Slack request signature verification (§15, §16).
 *
 * Slack signs every request with `v0=<sha256(timestamp + ':' + body + ':' + signingSecret)>`.
 * We verify the HMAC in constant time and reject stale timestamps to prevent
 * replay attacks.
 */
import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from '../../env.js';
import { log } from '../logging/service.js';
import { getSlackConfig, getSlackSecrets } from '../settings/service.js';

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  timestamp?: number;
}

export function verifySlackSignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  signingSecret: string,
  maxAgeSeconds = env.slack.signatureMaxAgeSeconds,
): VerificationResult {
  if (!timestamp || !signature) {
    return { valid: false, reason: 'Missing x-slack-request-timestamp or x-slack-signature header' };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { valid: false, reason: 'Invalid timestamp header' };

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSeconds > maxAgeSeconds) {
    return { valid: false, reason: `Timestamp outside the allowed ${maxAgeSeconds}s window`, timestamp: ts };
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { valid, timestamp: ts, reason: valid ? undefined : 'Signature mismatch' };
}

export async function verifySlackRequest(request: FastifyRequest, rawBody: string): Promise<VerificationResult> {
  const config = await getSlackConfig();
  if (!config.verifySignature) {
    if (env.isProduction) {
      log.error({ category: 'slack' }, 'Refusing to accept unsigned Slack events in production');
      return { valid: false, reason: 'Signature verification is disabled' };
    }
    return { valid: true };
  }

  const { signingSecret } = await getSlackSecrets();
  if (!signingSecret) {
    if (env.isProduction) {
      return { valid: false, reason: 'No Slack signing secret configured' };
    }
    // Development convenience: allow Slack to verify the Events URL before the
    // signing secret has been added. Never applies in production.
    log.warn({ category: 'slack' }, 'No Slack signing secret configured; accepting unsigned request in development');
    return { valid: true };
  }

  const result = verifySlackSignature(
    rawBody,
    request.headers['x-slack-request-timestamp'] as string | undefined,
    request.headers['x-slack-signature'] as string | undefined,
    signingSecret,
  );
  if (!result.valid) {
    log.warn({ category: 'slack', reason: result.reason }, 'Rejected Slack request');
  }
  return result;
}
