import { describe, expect, it } from 'vitest';
import type { KnowledgeArticleContext } from '../src/modules/ai/types.js';
import { categorizationPrompt, formatArticle } from '../src/modules/ai/prompts.js';

function article(overrides: Partial<KnowledgeArticleContext> = {}): KnowledgeArticleContext {
  return {
    id: 'a1',
    title: 'Freshchat Message Delivery Failures',
    category: 'Software',
    priority: 'high',
    issueDescription: 'The send button is disabled or greyed out.',
    troubleshootingSteps: '',
    symptoms: ['Send button disabled or greyed out'],
    expectedResult: '',
    failureResult: '',
    nextStep: '',
    escalationInstructions: '',
    notes: '',
    steps: [],
    images: [],
    ...overrides,
  };
}

describe('formatArticle', () => {
  it('renders the free-text procedure when an article has no structured steps', () => {
    const text = formatArticle(
      article({
        troubleshootingSteps: 'Ask the user to close unnecessary Chrome tabs, then refresh Freshchat.',
      }),
      5,
    );
    expect(text).toContain('Ask the user to close unnecessary Chrome tabs, then refresh Freshchat.');
  });

  it('prefers structured steps over the free-text mirror', () => {
    const text = formatArticle(
      article({
        troubleshootingSteps: 'Free-text mirror of the procedure.',
        steps: [
          {
            position: 1,
            title: 'Refresh the chat',
            instruction: 'Refresh the affected conversation.',
            expectedResult: 'The send button is active.',
            failureResult: '',
            nextStep: '',
            escalationInstructions: '',
            requiresAdminApproval: false,
            isDestructive: false,
          },
        ],
      }),
      5,
    );
    expect(text).toContain('- Step 1 — Refresh the chat: Refresh the affected conversation.');
    expect(text).toContain('Expected: The send button is active.');
    expect(text).not.toContain('Free-text mirror of the procedure.');
  });

  it('says so when an article documents no procedure at all', () => {
    expect(formatArticle(article(), 5)).toContain('No step-by-step procedure is documented');
  });
});

describe('categorizationPrompt', () => {
  const input = {
    issueTitle: 'Freshchat send button disabled',
    issueSummary: 'Agent cannot send messages',
    diagnosis: 'Workstation memory exhausted',
    agentMessage: 'it works now, thanks',
    threadTranscript: 'agent: I cannot send messages from freshchat',
    articlesUsed: ['Freshchat Message Delivery Failures'],
    choices: [
      {
        id: 'sub-1',
        name: 'Message Delivery Failures',
        categoryName: 'Internet Issues',
        priorityLevel: 'high',
        description: 'Messages will not send.',
      },
      {
        id: 'sub-2',
        name: 'Freshchat Lagging / Freezing',
        categoryName: 'CRM Issues',
        priorityLevel: 'critical',
        description: 'Freshchat is slow or frozen.',
      },
    ],
  };

  const { system, user } = categorizationPrompt(input);

  it('lists every allowed sub-category with its id', () => {
    expect(system).toContain('id=sub-1');
    expect(system).toContain('Message Delivery Failures');
    expect(system).toContain('id=sub-2');
    expect(system).toContain('CRM Issues');
  });

  it('forbids inventing categories and demands exactly one choice', () => {
    expect(system).toContain('Never invent a category');
    expect(system).toContain('exactly ONE sub-category');
  });

  it('tells the model to prefer the root cause over the symptom', () => {
    expect(system).toContain('root cause');
  });

  it('includes the issue context and the article that solved it', () => {
    expect(user).toContain('Freshchat send button disabled');
    expect(user).toContain('Workstation memory exhausted');
    expect(user).toContain('Freshchat Message Delivery Failures');
  });

  it('copes with an empty taxonomy', () => {
    const empty = categorizationPrompt({ ...input, choices: [] });
    expect(empty.system).toContain('(none available)');
  });
});
