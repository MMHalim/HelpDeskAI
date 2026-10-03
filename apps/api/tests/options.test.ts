import { describe, expect, it } from 'vitest';
import { looksLikeQuestion, parseOptions, quickReplyOptions } from '../src/modules/ai/base.js';

describe('looksLikeQuestion', () => {
  it('detects a trailing question mark', () => {
    expect(looksLikeQuestion('Did reloading the page resolve the issue?')).toBe(true);
  });

  it('returns false for statements', () => {
    expect(looksLikeQuestion('Please restart the VPN client.')).toBe(false);
  });
});

describe('quickReplyOptions', () => {
  it('offers Yes/No for a "Did ..." question', () => {
    expect(quickReplyOptions('Did reloading the page or closing other tabs resolve the issue?')).toEqual([
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' },
    ]);
  });

  it('offers Yes/No for an "Is ..." question', () => {
    expect(quickReplyOptions('Is the entire browser still frozen?')).toEqual([
      { label: 'Yes', value: 'Yes' },
      { label: 'No', value: 'No' },
    ]);
  });

  it('uses the last question line in a multi-line reply', () => {
    const reply = 'Thanks for that.\nDoes it also happen in another browser?';
    expect(quickReplyOptions(reply)).toHaveLength(2);
  });

  it('returns no options for open-ended questions', () => {
    expect(quickReplyOptions('Which browser are you using?')).toEqual([]);
  });
});

describe('parseOptions', () => {
  it('normalises labels/values and caps the count', () => {
    const options = parseOptions([
      { label: ' Windows ', value: 'Windows 11' },
      { label: 'macOS' },
      'not-an-object',
      { label: '' },
    ]);
    expect(options).toEqual([
      { label: 'Windows', value: 'Windows 11' },
      { label: 'macOS', value: 'macOS' },
    ]);
  });

  it('returns an empty array for non-arrays', () => {
    expect(parseOptions(undefined)).toEqual([]);
  });
});
