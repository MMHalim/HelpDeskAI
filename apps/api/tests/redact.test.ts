import { describe, expect, it } from 'vitest';
import { maskCredential, redactSecretValues, redactText } from '../src/lib/redact.js';

describe('redactText', () => {
  it('redacts common API key formats', () => {
    expect(redactText('token sk-abcdefghijklmnop')).toContain('[redacted-api-key]');
    expect(redactText('slack xoxb-1234567890-abcdef')).toContain('[redacted-slack-token]');
    expect(redactText('google AIzaSyA1234567890abcdefghijklmnop')).toContain('[redacted-google-key]');
    expect(redactText('github ghp_abcdefghijklmnopqrstuvwxyz')).toContain('[redacted-token]');
  });

  it('redacts labelled passwords', () => {
    const output = redactText('password = SuperSecret123');
    expect(output).not.toContain('SuperSecret123');
    expect(output).toContain('[redacted]');
  });

  it('masks credit card numbers but keeps the last four digits', () => {
    const output = redactText('card 4111 1111 1111 1111');
    expect(output).toContain('**** **** **** 1111');
  });

  it('leaves ordinary text alone', () => {
    expect(redactText('Restart the printer and retry')).toBe('Restart the printer and retry');
  });
});

describe('redactSecretValues', () => {
  it('redacts sensitive object keys recursively', () => {
    const output = redactSecretValues({
      user: 'alice',
      password: 'hunter2',
      nested: { apiKey: 'sk-abcdefghijklmnop', note: 'keep me' },
    });
    expect(output.password).toBe('[redacted]');
    expect(output.nested.apiKey).toBe('[redacted]');
    expect(output.nested.note).toBe('keep me');
    expect(output.user).toBe('alice');
  });

  it('redacts secrets embedded in arrays', () => {
    const output = redactSecretValues({ tokens: ['sk-abcdefghijklmnop'] });
    expect(output.tokens[0]).toBe('[redacted-api-key]');
  });
});

describe('maskCredential', () => {
  it('returns null for empty values', () => {
    expect(maskCredential(null)).toBeNull();
    expect(maskCredential('')).toBeNull();
  });

  it('always masks short values', () => {
    expect(maskCredential('short')).toBe('••••');
  });

  it('keeps a prefix and suffix for long values', () => {
    expect(maskCredential('xoxb-1234567890-abcdef')).toBe('xoxb-1…cdef');
  });
});
