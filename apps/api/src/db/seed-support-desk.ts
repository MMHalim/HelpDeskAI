/**
 * Seeds the support-desk incident taxonomy and the knowledge-base articles
 * behind it.
 *
 * Idempotent: taxonomy rows are matched on slug, articles on slug, and article
 * steps are replaced wholesale, so re-running converges to the same state.
 *
 * Run with:  pnpm exec tsx src/db/seed-support-desk.ts
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ArticlePriority } from '@helpdesk/shared';
import { db } from '../db/client.js';
import { runMigrations } from './migrate.js';
import { closeDatabase } from './client.js';
import {
  articleSteps,
  issueSubcategories,
  troubleshootingArticles,
} from '../db/schema.js';
import { seedTaxonomy } from '../modules/categorization/service.js';
import { logger } from '../lib/logger.js';

interface SeedStep {
  title: string;
  instruction: string;
  expectedResult?: string;
  failureResult?: string;
  nextStep?: string;
  escalationInstructions?: string;
}

interface SeedArticle {
  slug: string;
  title: string;
  /** Knowledge-base retrieval category (what the AI classifier files it under). */
  category: string;
  /** Reporting taxonomy link. */
  subcategorySlug: string;
  priority: ArticlePriority;
  issueDescription: string;
  symptoms: string[];
  steps: SeedStep[];
  expectedResult: string;
  escalationInstructions: string;
  tags: string[];
  keywords: string[];
  notes?: string;
}

const ARTICLES: SeedArticle[] = [
  {
    slug: 'internet-connectivity-issues',
    title: 'Internet Connectivity Issues',
    category: 'Network',
    subcategorySlug: 'internet-connectivity-issues',
    priority: 'critical',
    issueDescription:
      'The agent workstation has slow, unstable or no internet connectivity, which stops the agent from accepting live chats and calls.',
    symptoms: [
      'Slow internet connection',
      'Packet loss',
      'Websites not loading',
      'Unstable network connection',
      'Pages loading slowly',
    ],
    steps: [
      {
        title: 'Raise a ticket with IT Helpdesk',
        instruction:
          'Contact the IT Helpdesk immediately and create a ticket for the connectivity issue before continuing with the checks below.',
        escalationInstructions:
          'Do not wait for the diagnostics below: a connectivity incident is usually floor-wide.',
        nextStep: 'Run the speed and ping tests.',
      },
      {
        title: 'Run the network tests',
        instruction:
          'Run a Speed Test and a Ping Test and note the download speed, upload speed, latency and packet loss for the ticket.',
        expectedResult: 'Speed and ping results captured and attached to the ticket.',
      },
      {
        title: 'Reconnect the network',
        instruction:
          'Reconnect the workstation to the network, or restart the network adapters if reconnecting does not help.',
        expectedResult: 'The workstation is back on the network with a stable connection.',
        failureResult: 'The connection keeps dropping, or is still slow after the adapters restart.',
        nextStep: 'Switch to the backup connection.',
      },
      {
        title: 'Switch to the backup connection',
        instruction: 'Switch to the backup internet connection if one is available.',
        expectedResult: 'The agent is back online on the backup connection.',
        failureResult: 'There is no backup connection, or the backup connection fails too.',
        escalationInstructions: 'Escalate to Operations: the agent cannot take live work without connectivity.',
      },
    ],
    expectedResult:
      'Internet access is restored on the agent workstation, or the agent is switched to the backup connection while the ticket is handled.',
    escalationInstructions:
      'Contact the IT Helpdesk immediately and create a ticket. Notify Operations if the outage affects the whole floor.',
    tags: ['network', 'internet', 'connectivity', 'freshchat'],
    keywords: [
      'internet',
      'connectivity',
      'slow internet',
      'packet loss',
      'websites not loading',
      'pages loading slowly',
      'unstable network',
      'network adapter',
      'speed test',
      'ping test',
      'no internet',
      'connection dropping',
    ],
  },
  {
    slug: 'freshchat-lagging-freezing',
    title: 'Freshchat Lagging / PC Freezing',
    category: 'Performance',
    subcategorySlug: 'freshchat-lagging-freezing',
    priority: 'critical',
    issueDescription:
      'Freshchat is slow, the chat interface freezes, or the whole workstation freezes, so the agent cannot reply to or clear the live chat queue.',
    symptoms: [
      'Delayed chat loading',
      'Slow system response',
      'Chat interface freezing',
      'Applications not responding',
      'System freezing',
      'Slow workstation performance',
    ],
    steps: [
      {
        title: 'Refresh Freshchat',
        instruction: 'Ask the agent to refresh Freshchat and wait for the chat list to load.',
        expectedResult: 'The chat list loads and the interface responds again.',
        nextStep: 'Clear the browser cache and cookies.',
      },
      {
        title: 'Clear cache and cookies',
        instruction:
          'Ask the agent to clear the browser cache and cookies for the Freshchat site, then sign in again and refresh.',
        expectedResult: 'Freshchat loads normally after signing in again.',
        failureResult: 'Freshchat still lags or freezes after a fresh sign-in.',
        nextStep: 'Open Freshchat in an alternative browser.',
      },
      {
        title: 'Try an alternative browser',
        instruction: 'Ask the agent to open Freshchat in a different browser.',
        expectedResult: 'The alternative browser works, which confirms a browser-specific problem.',
        failureResult: 'Freshchat also lags in the alternative browser.',
        nextStep: 'Restart the workstation.',
      },
      {
        title: 'Restart the workstation',
        instruction: 'Ask the agent to restart the workstation, then open Freshchat again.',
        expectedResult: 'Freshchat runs normally after the restart.',
        failureResult: 'The workstation freezes again after restarting.',
        nextStep: 'Close unnecessary applications.',
      },
      {
        title: 'Close unnecessary applications',
        instruction:
          'Ask the agent to close every application they do not need for live work, including unused browser tabs.',
        expectedResult: 'Available memory rises and Freshchat becomes responsive.',
      },
      {
        title: 'Update the browser',
        instruction:
          'Ask the agent to update the browser to the latest version, then open Freshchat again.',
        expectedResult: 'Freshchat is stable on the updated browser.',
        failureResult: 'The freezing continues on the latest browser version.',
        escalationInstructions:
          'Escalate to IT: the workstation is repeatedly freezing during live work.',
      },
    ],
    expectedResult:
      'Freshchat loads and responds without freezing, so the agent can work the live chat queue again.',
    escalationInstructions:
      'Escalate to IT when the workstation keeps freezing or restarting does not help.',
    tags: ['freshchat', 'crm', 'performance', 'workstation'],
    keywords: [
      'freshchat',
      'lagging',
      'freezing',
      'freeze',
      'pc freezing',
      'system freezing',
      'slow system',
      'chat loading',
      'chat interface',
      'applications not responding',
      'slow workstation',
      'crm',
      'browser cache',
      'restart workstation',
    ],
  },
  {
    slug: 'message-delivery-failures',
    title: 'Freshchat Message Delivery Failures',
    category: 'Software',
    subcategorySlug: 'message-delivery-failures',
    priority: 'high',
    issueDescription:
      'The agent cannot send messages to the customer in Freshchat: the send button is disabled or greyed out, messages never send, or customer replies do not appear.',
    symptoms: [
      'Messages not sending',
      'Send button disabled or greyed out',
      'Customer replies not appearing',
    ],
    steps: [
      {
        title: 'Free up workstation memory',
        instruction:
          'Ask the agent to close unnecessary Chrome tabs and to stop using Chrome group tabs, because they consume installed RAM memory which impacts the CRM, then refresh Freshchat.',
        expectedResult: 'The send button becomes active again after the refresh.',
        failureResult: 'The send button is still disabled after closing tabs and refreshing.',
        nextStep: 'Refresh the affected chat.',
      },
      {
        title: 'Refresh the affected chat',
        instruction: 'Ask the agent to refresh the affected chat conversation.',
        expectedResult: 'The conversation reloads and the send button is active.',
        failureResult: 'The send button is still disabled or greyed out.',
        nextStep: 'Verify internet connectivity.',
      },
      {
        title: 'Verify internet connectivity',
        instruction:
          'Verify internet connectivity before anything else: an offline or unstable connection stops messages from being delivered.',
        expectedResult: 'The workstation has a working connection.',
        failureResult: 'Connectivity is lost or unstable.',
        nextStep: 'Reopen the ticket.',
        escalationInstructions:
          'Follow the Internet Connectivity Issues article when connectivity is the problem.',
      },
      {
        title: 'Reopen the ticket',
        instruction:
          'Ask the agent to reopen the ticket in Freshchat, which re-establishes the conversation state.',
        expectedResult: 'The reopened conversation accepts messages again.',
        nextStep: 'Retry sending the message.',
      },
      {
        title: 'Retry sending the message',
        instruction:
          'Ask the agent to retry sending the message once the connection is confirmed.',
        expectedResult: 'The message is delivered and appears in the conversation.',
        failureResult: 'The message still will not send.',
        escalationInstructions:
          'Escalate to IT: message delivery is still failing after the documented steps.',
      },
    ],
    expectedResult: 'The agent can send messages in the conversation again.',
    escalationInstructions: 'Escalate to IT when messages still will not send after these steps.',
    tags: ['freshchat', 'crm', 'messaging', 'chrome'],
    keywords: [
      'message',
      'messages not sending',
      'send button',
      'send button disabled',
      'greyed out',
      'cannot send',
      'customer replies',
      'reply not appearing',
      'freshchat',
      'crm',
      'chrome tabs',
      'group tabs',
      'ram',
    ],
    notes:
      'Merges the former "CRM Issue" article; the Chrome tab / group tab fix it documented is now the first step.',
  },
  {
    slug: 'call-drops',
    title: 'Call Drops',
    category: 'Telephony',
    subcategorySlug: 'call-drops',
    priority: 'critical',
    issueDescription:
      'Live calls disconnect unexpectedly, hang while loading, or cannot be called back, which abandons the customer mid-conversation.',
    symptoms: [
      'Calls disconnect unexpectedly',
      'Calls stuck loading',
      "Can't call back the customer",
    ],
    steps: [
      {
        title: 'Verify network stability',
        instruction:
          'Verify network stability using the same checks as a network connectivity issue: speed test, ping test and packet loss.',
        expectedResult: 'The network is stable, with no packet loss during the call.',
        failureResult: 'Packet loss or an unstable connection is present.',
        nextStep: 'Notify Operations.',
        escalationInstructions:
          'Follow the Internet Connectivity Issues article when connectivity itself is the fault.',
      },
      {
        title: 'Notify Operations',
        instruction: 'Notify Operations about the call drops.',
        escalationInstructions:
          'A critical call drop is a live CX breach: notify Operations as soon as it is confirmed.',
        nextStep: 'Follow the customer callback procedure.',
      },
      {
        title: 'Follow the callback procedure',
        instruction: 'Follow the customer callback procedures when applicable.',
        expectedResult: 'The customer is called back and the interaction is completed.',
      },
      {
        title: 'Log out and log in again',
        instruction:
          'Ask the agent to log out of the calling application and log in again, in case they cannot call the customer back.',
        expectedResult: 'The agent can call the customer back.',
        failureResult: 'The agent still cannot call the customer back.',
        escalationInstructions:
          'Escalate to Operations and IT: the agent is out of the live voice queue.',
      },
    ],
    expectedResult: 'Calls stay connected and the agent can call the customer back.',
    escalationInstructions: 'Notify Operations, and escalate to IT if the agent cannot call back at all.',
    tags: ['telephony', 'calls', 'voice', 'freshchat'],
    keywords: [
      'call',
      'calls',
      'call drops',
      'call dropped',
      'disconnect',
      'disconnected',
      'calls stuck loading',
      'call stuck',
      'call back',
      'callback',
      'cannot call back',
      'voice',
      'packet loss',
    ],
  },
  {
    slug: 'audio-issues-during-calls',
    title: 'Audio Issues During Calls',
    category: 'Telephony',
    subcategorySlug: 'audio-issues-during-calls',
    priority: 'high',
    issueDescription:
      'Audio is missing or one-way during live calls: the agent cannot hear the customer, or the customer cannot hear the agent.',
    symptoms: [
      'Agent cannot hear customer',
      'Customer cannot hear agent',
      'Missing audio during calls',
    ],
    steps: [
      {
        title: 'Check network stability',
        instruction:
          'Check network stability and run an immediate Speed and Ping test to check for packet loss or jitter causing audio gaps.',
        expectedResult: 'Speed and ping results show no packet loss or jitter.',
        failureResult: 'Packet loss or jitter is present.',
        nextStep: 'Switch to the backup network connection.',
      },
      {
        title: 'Switch to the backup connection',
        instruction: 'Switch to the backup network connection if one is available.',
        expectedResult: 'Audio is clear on the backup connection.',
        failureResult: 'Audio is still missing or one-way.',
        escalationInstructions:
          'Shift the agent temporarily to the live chat queue until a hardware swap occurs, then escalate to IT.',
      },
    ],
    expectedResult: 'Both sides of the call can hear each other clearly.',
    escalationInstructions:
      'The agent can be shifted to the live chat queue until a hardware swap occurs. Escalate to IT for the swap.',
    tags: ['telephony', 'audio', 'calls', 'headset', 'network'],
    keywords: [
      'audio',
      'no audio',
      'missing audio',
      'one-way audio',
      'cannot hear',
      'customer cannot hear',
      'agent cannot hear',
      'microphone',
      'headset',
      'jitter',
      'packet loss',
      'call quality',
    ],
  },
  {
    slug: 'slack-issues',
    title: 'Slack Issues',
    category: 'Software',
    subcategorySlug: 'slack-issues',
    priority: 'normal',
    issueDescription:
      'Slack behaves badly for the agent: messages arrive late, notifications do not appear, or the application lags. Customer-facing queues are unaffected.',
    symptoms: ['Delayed messages', 'Missing notifications', 'Application lag'],
    steps: [
      {
        title: 'Check the Slack status page',
        instruction: 'Check the Slack outage status page to rule out a Slack-side incident.',
        expectedResult: 'No Slack incident is reported, so the problem is local.',
        failureResult: 'Slack reports an ongoing incident.',
        nextStep: 'Force reload the Slack application.',
        escalationInstructions:
          'There is nothing to fix locally during a Slack incident; tell the agent to use another channel for urgent contact.',
      },
      {
        title: 'Force reload Slack',
        instruction: 'Force reload the Slack application.',
        expectedResult: 'Slack reloads and messages and notifications flow again.',
        failureResult: 'Slack still lags or notifications are still missing.',
        nextStep: 'Switch between the Slack web version and the app.',
      },
      {
        title: 'Switch Slack version',
        instruction: 'Switch to the Slack web version, or back to the Slack app.',
        expectedResult: 'One of the two versions works normally.',
        failureResult: 'Both versions misbehave.',
        nextStep: 'Re-login to Slack.',
      },
      {
        title: 'Re-login to Slack',
        instruction: 'Ask the agent to log out of Slack and log in again.',
        expectedResult: 'Slack behaves normally after signing in again.',
        failureResult: 'Slack is still affected after re-login.',
        escalationInstructions: 'Escalate to IT if Slack cannot be recovered for the agent.',
      },
    ],
    expectedResult: 'Slack delivers messages and notifications normally again.',
    escalationInstructions: 'Escalate to IT if Slack cannot be recovered for the agent.',
    tags: ['slack', 'software', 'internal tooling'],
    keywords: [
      'slack',
      'slack lag',
      'slack issue',
      'delayed messages',
      'missing notifications',
      'notification not showing',
      'application lag',
      'force reload',
      'slack web',
      're-login',
    ],
  },
  {
    slug: 'power-outages',
    title: 'Power Outages',
    category: 'Network',
    subcategorySlug: 'power-outages',
    priority: 'critical',
    issueDescription:
      'The workstation or the floor loses mains power, stopping all queue-handling hardware immediately.',
    symptoms: ['Complete service interruption', 'Loss of connectivity'],
    steps: [
      {
        title: 'Notify Operations',
        instruction:
          'Notify Operations about the power outage: all queue-handling hardware is down and live operations must stop until power is restored.',
        escalationInstructions:
          'A power outage is an absolute stop to live operations; Operations must be notified immediately.',
        nextStep: 'Switch to the backup internet connection.',
      },
      {
        title: 'Switch to the backup connection',
        instruction:
          'Switch to the backup internet connection where any device still has power, so the agent can stay reachable while the outage continues.',
        expectedResult: 'Reachable agents move to the backup connection.',
      },
    ],
    expectedResult:
      'Operations is aware of the outage and reachable agents resume work on the backup connection.',
    escalationInstructions: 'Notify Operations immediately; this is an absolute stop to live operations.',
    tags: ['hardware', 'power', 'outage', 'operations'],
    keywords: [
      'power',
      'power outage',
      'power cut',
      'electricity',
      'no power',
      'shutdown',
      'service interruption',
      'loss of connectivity',
      'backup connection',
      'operations',
    ],
  },
];

/** Replaces the steps of an article with the seeded set. */
async function replaceSteps(articleId: string, steps: SeedStep[]): Promise<void> {
  await db.delete(articleSteps).where(eq(articleSteps.articleId, articleId));
  if (steps.length === 0) return;
  await db.insert(articleSteps).values(
    steps.map((step, index) => ({
      articleId,
      position: index + 1,
      title: step.title,
      instruction: step.instruction,
      expectedResult: step.expectedResult ?? '',
      failureResult: step.failureResult ?? '',
      nextStep: step.nextStep ?? '',
      escalationInstructions: step.escalationInstructions ?? '',
    })),
  );
}

async function seedArticles(): Promise<number> {
  const subcategoryRows = await db
    .select({ id: issueSubcategories.id, slug: issueSubcategories.slug })
    .from(issueSubcategories);
  const subcategoryBySlug = new Map(subcategoryRows.map((row) => [row.slug, row.id]));

  for (const article of ARTICLES) {
    const subcategoryId = subcategoryBySlug.get(article.subcategorySlug);
    if (!subcategoryId) {
      throw new Error(`Unknown sub-category "${article.subcategorySlug}" for article "${article.slug}"`);
    }

    const values = {
      title: article.title,
      category: article.category,
      issueDescription: article.issueDescription,
      symptoms: article.symptoms,
      // The free-text mirror keeps the procedure readable in the dashboard and
      // in full-text search; the structured steps drive the AI turn by turn.
      troubleshootingSteps: article.steps
        .map((step, index) => `${index + 1}. ${step.title}: ${step.instruction}`)
        .join('\n'),
      expectedResult: article.expectedResult,
      escalationInstructions: article.escalationInstructions,
      tags: article.tags,
      keywords: article.keywords,
      priority: article.priority,
      isActive: true,
      notes: article.notes ?? '',
      subcategoryId,
    };

    const existing = await db
      .select({ id: troubleshootingArticles.id })
      .from(troubleshootingArticles)
      .where(eq(troubleshootingArticles.slug, article.slug))
      .limit(1);

    const [row] = existing[0]
      ? await db
          .update(troubleshootingArticles)
          .set(values)
          .where(eq(troubleshootingArticles.slug, article.slug))
          .returning({ id: troubleshootingArticles.id })
      : await db
          .insert(troubleshootingArticles)
          .values({ slug: article.slug, ...values })
          .returning({ id: troubleshootingArticles.id });

    if (!row) throw new Error(`Failed to seed article "${article.slug}"`);
    const articleId = row.id;

    await replaceSteps(articleId, article.steps);
  }

  return ARTICLES.length;
}

/**
 * The first "CRM Issue" article is superseded by "Freshchat Message Delivery
 * Failures", which now carries its Chrome tab fix. It is deactivated rather
 * than deleted so historical sessions keep their reference.
 */
async function deactivateSupersededArticles(): Promise<number> {
  const superseded = ['crm-issue'];
  const rows = await db
    .select({ id: troubleshootingArticles.id, isActive: troubleshootingArticles.isActive })
    .from(troubleshootingArticles)
    .where(
      and(eq(troubleshootingArticles.isActive, true), inArray(troubleshootingArticles.slug, superseded)),
    );
  if (rows.length === 0) return 0;
  await db
    .update(troubleshootingArticles)
    .set({ isActive: false, notes: 'Merged into "Freshchat Message Delivery Failures".' })
    .where(inArray(troubleshootingArticles.slug, superseded));
  return rows.length;
}

async function main(): Promise<void> {
  await runMigrations();
  const taxonomy = await seedTaxonomy();
  logger.info(
    { categories: taxonomy.categories, subcategories: taxonomy.subcategories },
    'Incident taxonomy seeded',
  );

  const articleCount = await seedArticles();
  logger.info({ articles: articleCount }, 'Knowledge-base articles seeded');

  const deactivated = await deactivateSupersededArticles();
  if (deactivated > 0) {
    logger.info({ articles: deactivated }, 'Superseded articles deactivated');
  }

  const total = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(troubleshootingArticles)
    .where(eq(troubleshootingArticles.isActive, true));
  logger.info({ activeArticles: total[0]?.count ?? 0 }, 'Seed complete');
}

main()
  .then(async () => {
    await closeDatabase();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, 'Seeding the support-desk taxonomy failed');
    await closeDatabase();
    process.exit(1);
  });
