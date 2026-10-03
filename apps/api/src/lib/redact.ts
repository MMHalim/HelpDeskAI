/**
 * Redaction helpers.
 *
 * Two jobs:
 *  1. Strip credentials from anything that is persisted to logs (§24).
 *  2. Strip credentials the agent may have pasted into a Slack message before
 *     the text reaches an AI provider (§19).
 */
import { SECRET_REDACTION_PATTERNS } from '@helpdesk/shared';

const SENSITIVE_KEYS = [
  'apitoken',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'accesstoken',
  'access_token',
  'bottoken',
  'bot_token',
  'signingsecret',
  'signing_secret',
  'apptoken',
  'app_token',
  'password',
  'passwordhash',
  'password_hash',
  'secret',
  'token',
  'cookie',
  'set-cookie',
  'sessionid',
  'session_id',
  'service_role_key',
  'supabase_service_role_key',
  'encryptionkey',
  'credential_encryption_key',
  'sessiontoken',
  'session_token',
];

/** Replaces credential-looking substrings inside a free-text string. */
export function redactText(input: string): string {
  let output = input;
  for (const { pattern, replacement } of SECRET_REDACTION_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function redactSecrets(input: string): string {
  return redactText(input);
}

/** Deep-redacts an object before it is written to a log sink. */
export function redactSecretValues<T>(value: T, depth = 0): T {
  if (depth > 6) return '[deep]' as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecretValues(v, depth + 1)) as unknown as T;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
    if (SENSITIVE_KEYS.includes(normalized) || SENSITIVE_KEYS.includes(key.toLowerCase())) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redactSecretValues(val, depth + 1);
  }
  return out as unknown as T;
}

/** `xoxb-1234-5678-abcdef` -> `xoxb-…cdef` for admin display only. */
export function maskCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}
