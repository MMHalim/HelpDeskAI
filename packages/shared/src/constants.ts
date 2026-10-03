/**
 * Cross-cutting constants: provider metadata, Slack event requirements,
 * safety guard patterns and the stop-word list used for keyword extraction.
 */

import type { AiProviderId } from './enums.js';

export const APP_VERSION = '1.0.0';

export const PROVIDER_META: Record<
  AiProviderId,
  {
    label: string;
    defaultModel: string;
    defaultBaseUrl: string;
    supportsVision: boolean;
    envVar: string;
    keyUrl: string;
    docsFile: string;
  }
> = {
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.5-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsVision: true,
    envVar: 'GEMINI_API_KEY',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    docsFile: 'docs/SETUP_AI.md',
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsVision: true,
    envVar: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    docsFile: 'docs/SETUP_AI.md',
  },
};

/**
 * Events the Slack app must subscribe to (bot events).
 * `reaction_added` is the primary trigger; the others keep threads in sync.
 */
export const REQUIRED_SLACK_EVENTS = [
  'reaction_added',
  'app_mention',
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
  'message.channels:bot',
  'message.groups:bot',
  'file_shared',
  'file_created',
  'file_change',
] as const;

/** Resolution phrases the fast path looks for before asking the model. */
export const RESOLUTION_PHRASES = [
  "it's working now",
  'its working now',
  'it is working now',
  'working now',
  'that worked',
  'that fixed it',
  'fixed it',
  'all working',
  'everything is working',
  'problem resolved',
  'issue resolved',
  'issue is resolved',
  'resolved now',
  'thanks, it works',
  'thanks it works',
  'thanks, fixed',
  'thanks fixed',
  'solved',
  'fixed',
  'it works',
  'works now',
  'back up and running',
  'back to normal',
  'no more errors',
  'no longer seeing the error',
  'no longer getting the error',
  'error is gone',
  'issue sorted',
  'all set',
  'cheers, that worked',
  'cheers, fixed',
  'perfect, it works',
  'success',
  'sorted it',
  'good to go',
] as const;

/** Escalation phrases — the agent (or the bot) asking for a human. */
export const ESCALATION_PHRASES = [
  'escalate',
  'escalation',
  'raise a ticket',
  'raise a ticket to it',
  'open a ticket',
  'hand this over to it',
  'hand over to it',
  'transfer me to it',
  'need it support',
  'i need it to take over',
  'this needs it',
  'call it',
  'contact it support',
  'give up',
  "i'll wait for it",
] as const;

export const STOP_WORDS = new Set([
  'a', 'about', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any', 'app', 'are',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during', 'each', 'few',
  'for', 'from', 'further', 'get', 'gets', 'got', 'had', 'has', 'have', 'having', 'he', 'help',
  'her', 'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
  'let', 'like', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once',
  'only', 'or', 'other', 'ought', 'our', 'ours', 'out', 'over', 'own', 'please', 'same', 'she',
  'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'us',
  'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why',
  'will', 'with', 'would', 'you', 'your', 'yours', 'am', 'im', 'ive', 'dont', 'doesnt', 'cant',
  'wont', 'isnt', 'wasnt', 'were', 'a', 'to', 'the',
]);

/**
 * Patterns the safety guard strips or blocks before a reply reaches Slack.
 * These are intentionally conservative: they only match unambiguous
 * destructive or credential-revealing instructions.
 */
export const SAFETY_DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /rm\s+-[a-z]*[rf][a-z]*\s+[~/$]|\brm\s+-rf\b/i,
    reason: 'recursive delete command',
  },
  { pattern: /\bformat\s+[a-z]:/i, reason: 'disk format command' },
  { pattern: /\bdiskpart\b|\bclean\s+all\b/i, reason: 'disk partition destruction' },
  { pattern: /\bdel\s+\/f\s+\/s|\brmdir\s+\/s\b/i, reason: 'recursive delete command' },
  { pattern: /\breg\s+delete\b/i, reason: 'registry deletion' },
  { pattern: /\bvssadmin\s+delete\s+shadows/i, reason: 'shadow copy deletion' },
  { pattern: /\bcipher\s+\/w/i, reason: 'free-space wipe' },
  { pattern: /\bDefrag\b.*\/i|\bchkdsk\b.*\/f/i, reason: 'forced disk repair' },
  {
    pattern: /\b(netsh\s+advfirewall\s+set\s+\w+\s+state\s+off|set-executionpolicy\s+unrestricted|bcdedit\s+\/set\s+.*bootstatuspolicy\s+ignoreallfailures)/i,
    reason: 'disabling a security control',
  },
  {
    pattern: /\bdisable\b[^.\n]{0,40}\b(antivirus|anti-virus|defender|edr|firewall|smb signing|bitlocker|windows update)\b/i,
    reason: 'disabling a security control',
  },
  { pattern: /\bcurl\b[^|\n]*\|\s*(sudo\s+)?(ba)?sh\b/i, reason: 'piping a remote script to a shell' },
  { pattern: /\bRemove-AppxPackage\b|\bformat-volume\b|\bInitialize-Disk\b/i, reason: 'destructive PowerShell cmdlet' },
];

export const SAFETY_CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(password|passcode|passphrase|pin)\b[^.\n]{0,40}(?:is|=|:)/i,
    reason: 'asks the agent to share a password',
  },
  {
    pattern: /\b(mfa|otp|2fa|one[-\s]?time)\s*(code|token)\b/i,
    reason: 'asks the agent to share an MFA code',
  },
  {
    pattern: /\b(api[\s_-]?key|apikey|access[\s_-]?token|auth[\s_-]?token|bearer\s+token|client[\s_-]?secret|private[\s_-]?key|refresh[\s_-]?token|session[\s_-]?token)\b/i,
    reason: 'mentions an API key or access token',
  },
  {
    pattern: /\bsk-[A-Za-z0-9]{16,}\b|\bghp_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bAIza[0-9A-Za-z\-_]{20,}\b/,
    reason: 'contains what looks like a live secret',
  },
];

/** Redacts anything that looks like a credential inside agent messages. */
export const SECRET_REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b(sk-[A-Za-z0-9_-]{12,})/g,
    replacement: '[redacted-api-key]',
  },
  { pattern: /\b(gh[pousr]_[A-Za-z0-9]{16,})/g, replacement: '[redacted-token]' },
  { pattern: /\b(xox[baprs]-[A-Za-z0-9-]{8,})/g, replacement: '[redacted-slack-token]' },
  { pattern: /\b(AIza[0-9A-Za-z\-_]{20,})/g, replacement: '[redacted-google-key]' },
  {
    pattern:
      /((?:password|passcode|passphrase|api[\s_-]?key|token|secret)\s*(?:is|=|:)\s*)(["']?)([^\s"',.]{4,})\2/gi,
    replacement: '$1[redacted]',
  },
  { pattern: /\b(\d{4})\s(\d{4})\s(\d{4})\s(\d{4})\b/g, replacement: '**** **** **** $4' },
];

/** Exact message the bot posts when something fails internally (spec §23). */
export const GENERIC_SLACK_ERROR_MESSAGE =
  "Sorry, I couldn't process this troubleshooting request right now. Please try again or contact IT.";

export const RESOLVED_SLACK_MESSAGE = "Great! Glad we got it resolved. ✅";

export const MAX_SLACK_TEXT_BLOCK = 2900;
export const MAX_SLACK_BLOCKS_PER_MESSAGE = 45;
