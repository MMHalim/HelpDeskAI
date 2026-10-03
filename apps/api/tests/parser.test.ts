import { describe, expect, it } from 'vitest';
import { parseKnowledgeDocument, parsePlainTextRunbook } from '../src/modules/knowledge/parser.js';

const SAMPLE = `# VPN will not connect

Category: Network
Priority: high
Tags: vpn, network

Users on the corporate network cannot establish a VPN tunnel and receive error 809.

## Symptoms
- VPN client shows "connecting" forever
- Error 809 appears after authentication

## Troubleshooting Steps
### Step 1: Restart the VPN client
Quit the client completely and relaunch it.
Expected: The tunnel connects
If fails: Continue to the next step

### Step 2: Reinstall the client
Download the latest client from the portal.
If this fails: contact IT support
`;

describe('parseKnowledgeDocument', () => {
  it('produces a single article with metadata, symptoms and steps', () => {
    const articles = parseKnowledgeDocument(SAMPLE);
    expect(articles).toHaveLength(1);

    const article = articles[0]!;
    expect(article.title).toBe('VPN will not connect');
    expect(article.category).toBe('Network');
    expect(article.priority).toBe('high');
    expect(article.tags).toContain('vpn');
    expect(article.symptoms.length).toBe(2);
    expect(article.steps).toHaveLength(2);
    expect(article.steps[0]!.title).toBe('Restart the VPN client');
    expect(article.steps[0]!.expectedResult).toBe('The tunnel connects');
    expect(article.troubleshootingSteps).toContain('Step 1');
  });

  it('flags steps that require admin approval and destructive actions', () => {
    const articles = parseKnowledgeDocument(SAMPLE);
    expect(articles[0]!.steps[1]!.requiresAdminApproval).toBe(true);
  });

  it('returns an empty array for blank input', () => {
    expect(parseKnowledgeDocument('   \n  ')).toEqual([]);
  });
});

describe('parsePlainTextRunbook', () => {
  it('falls back to heading-based parsing when no separators exist', () => {
    const articles = parsePlainTextRunbook(SAMPLE);
    expect(articles.length).toBeGreaterThan(0);
    expect(articles[0]!.title).toBe('VPN will not connect');
  });

  it('splits separator-delimited runbooks into multiple articles', () => {
    const doc = [
      'Printer is offline',
      'Check that the printer is powered on and connected to the network before anything else.',
      '---',
      'Email will not sync',
      'Verify the account credentials and that Outlook is running the latest version.',
    ].join('\n');
    const articles = parsePlainTextRunbook(doc);
    expect(articles).toHaveLength(2);
    expect(articles[0]!.title).toBe('Printer is offline');
    expect(articles[1]!.title).toBe('Email will not sync');
  });
});
