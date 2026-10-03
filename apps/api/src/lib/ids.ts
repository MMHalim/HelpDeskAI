import crypto from 'node:crypto';

/** Correlation ID for tracing one troubleshooting request end-to-end (§24). */
export function correlationId(): string {
  return `cor_${crypto.randomBytes(8).toString('hex')}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Human readable session code, e.g. `TS-2026-000123`.
 * The sequence is derived from a per-year counter kept in the database by the
 * caller (see `nextSessionCode`).
 */
export function formatSessionCode(sequence: number, now = new Date()): string {
  const year = now.getUTCFullYear();
  return `TS-${year}-${String(sequence).padStart(6, '0')}`;
}
