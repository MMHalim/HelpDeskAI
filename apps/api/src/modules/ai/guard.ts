/**
 * Safety guard (§19, §23).
 *
 * Runs over every message that leaves the system towards Slack:
 *  - blocks destructive or security-disabling instructions,
 *  - removes anything that looks like a credential,
 *  - flags replies that ask the agent for secrets,
 *  - and formats the result for Slack's block limits.
 *
 * The guard is deliberately independent of the model: even if the prompt is
 * weakened, unsafe output is still caught here.
 */
import {
  GENERIC_SLACK_ERROR_MESSAGE,
  MAX_SLACK_BLOCKS_PER_MESSAGE,
  MAX_SLACK_TEXT_BLOCK,
  SAFETY_CREDENTIAL_PATTERNS,
  SAFETY_DESTRUCTIVE_PATTERNS,
} from '@helpdesk/shared';
import { redactText } from '../../lib/redact.js';

export type GuardVerdict = 'clean' | 'modified' | 'blocked';

export interface GuardResult {
  verdict: GuardVerdict;
  text: string;
  /** Human-readable reasons, surfaced in the dashboard session view. */
  reasons: string[];
  /** True when the reply asked the agent for a credential. */
  requestedCredential: boolean;
}

export function guardMessage(input: string): GuardResult {
  const reasons: string[] = [];
  let text = input ?? '';
  const original = text;

  // 1. Neutralise credential-looking strings.
  const redacted = redactText(text);
  if (redacted !== text) {
    reasons.push('Credential-like value was redacted from the reply');
    text = redacted;
  }

  // 2. Does the reply ask the agent for a secret?
  const requestedCredential = SAFETY_CREDENTIAL_PATTERNS.some(({ pattern }) => pattern.test(text));
  if (requestedCredential) {
    reasons.push('Reply referenced credentials and was rewritten to a safe form');
    text = text.replace(
      /(?:^|\n)\s*(?:please\s+)?(?:can|could|would)\s+you\s+(?:send|share|paste|type|provide|forward)\b[^\n]*/gi,
      '\n(I can\'t accept credentials in chat — please rotate anything you shared and we\'ll continue without it.)',
    );
    text = text.replace(
      /((?:password|passcode|passphrase|mfa|otp|2fa|api[\s_-]?key|access token|auth token)\s*(?:is|=|:)?\s*)("?)[^\s"]{3,}\2/gi,
      '$1[redacted]',
    );
  }

  // 3. Destructive / security-disabling instructions.
  const blocked: string[] = [];
  for (const { pattern, reason } of SAFETY_DESTRUCTIVE_PATTERNS) {
    if (pattern.test(text)) {
      blocked.push(reason);
      text = text.replace(pattern, '[blocked: unsafe action]');
    }
  }
  if (blocked.length > 0) {
    reasons.push(`Blocked unsafe instruction: ${blocked.join(', ')}`);
  }

  // 4. Administrative-approval steps may not be pushed to agents.
  if (/step\s*\d+/i.test(text) && /contact\s+it\b/i.test(text) === false && blocked.length > 0) {
    text +=
      '\n\n_I removed an instruction that was not approved by your IT documentation. Please contact IT if you believe this step is required._';
  }

  text = collapseSlackMarkdown(text);

  let verdict: GuardVerdict = 'clean';
  if (text !== original) verdict = 'modified';
  if (blocked.length > 0) verdict = 'blocked';

  return { verdict, text, reasons, requestedCredential };
}

/**
 * Slack renders at most 3000 characters per text block and 50 blocks per
 * message. This keeps the reply inside those limits without cutting mid-word.
 */
export function collapseSlackMarkdown(input: string): string {
  let text = input.replace(/\r\n/g, '\n').trim();
  if (text.length <= MAX_SLACK_TEXT_BLOCK) return text;

  const blocks = text.split(/\n(?=###\s)/g);
  if (blocks.length > MAX_SLACK_BLOCKS_PER_MESSAGE) {
    text = blocks.slice(0, MAX_SLACK_BLOCKS_PER_MESSAGE).join('\n');
  }
  if (text.length <= MAX_SLACK_TEXT_BLOCK) return text;

  const head = text.slice(0, MAX_SLACK_TEXT_BLOCK - 200);
  const cut = head.lastIndexOf('\n');
  return `${(cut > 0 ? head.slice(0, cut) : head).trim()}\n\n_(Reply shortened to fit Slack's message limit.)_`;
}

/** The message posted to Slack when something fails internally (§23). */
export function slackSafeErrorMessage(error: { kind?: string } | null | undefined): string {
  if (error?.kind === 'config') {
    return 'The troubleshooting bot is not fully configured yet. Please contact IT to finish the setup.';
  }
  return GENERIC_SLACK_ERROR_MESSAGE;
}

export function looksLikeEscalationNeeded(text: string): boolean {
  return /\b(escalate|escalation|raise a ticket|open a ticket|hand (this )?over to it|need it support|contact it support)\b/i.test(
    text,
  );
}
