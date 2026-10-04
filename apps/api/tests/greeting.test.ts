import { describe, expect, it } from 'vitest';
import { buildGreetingReply, slackMention } from '../src/modules/slack/greeting.js';

describe('slackMention', () => {
  it('renders a Slack mention for a known user', () => {
    expect(slackMention('U0C64N9QLMU')).toBe('<@U0C64N9QLMU>');
  });

  it('returns an empty string when the user is unknown', () => {
    expect(slackMention(null)).toBe('');
    expect(slackMention(undefined)).toBe('');
  });
});

describe('buildGreetingReply', () => {
  const mention = '<@U0C64N9QLMU>';

  it('folds the mention into the greeting instead of prefixing it', () => {
    expect(buildGreetingReply('Hi Halim! I can help you with that.', mention)).toBe(
      'Hi <@U0C64N9QLMU> I can help you with that.',
    );
  });

  it('handles a comma separated greeting', () => {
    expect(buildGreetingReply('Hello Halim, try restarting the app.', mention)).toBe(
      'Hello <@U0C64N9QLMU> try restarting the app.',
    );
  });

  it('handles a greeting without a name', () => {
    expect(buildGreetingReply('Hi there, please try a refresh.', mention)).toBe(
      'Hi <@U0C64N9QLMU> please try a refresh.',
    );
  });

  it('keeps the leading mention when the reply has no greeting', () => {
    expect(buildGreetingReply('### Step 2\nPlease check the assignee.', mention)).toBe(
      '<@U0C64N9QLMU> ### Step 2\nPlease check the assignee.',
    );
  });

  it('never treats a word starting with "hi" as a greeting', () => {
    expect(buildGreetingReply('Higher memory usage caused the failure.', mention)).toBe(
      '<@U0C64N9QLMU> Higher memory usage caused the failure.',
    );
  });

  it('returns the text unchanged when the agent is unknown', () => {
    expect(buildGreetingReply('Hi Halim! I can help you with that.', '')).toBe(
      'Hi Halim! I can help you with that.',
    );
  });
});