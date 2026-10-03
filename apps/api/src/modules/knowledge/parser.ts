/**
 * Documentation parser (§26).
 *
 * Turns imported Markdown / plain-text runbooks into structured article drafts:
 * title, category, symptoms, steps (with expected / failure / next / escalation)
 * and article-level results. Heuristics are deliberately conservative: anything
 * it cannot interpret is kept verbatim in the issue description or notes so no
 * information is lost.
 */

export interface ParsedStep {
  position: number;
  title: string;
  instruction: string;
  expectedResult: string;
  failureResult: string;
  nextStep: string;
  escalationInstructions: string;
  requiresAdminApproval: boolean;
  isDestructive: boolean;
}

export interface ParsedArticle {
  title: string;
  category: string;
  issueDescription: string;
  symptoms: string[];
  troubleshootingSteps: string;
  expectedResult: string;
  failureResult: string;
  nextStep: string;
  escalationInstructions: string;
  tags: string[];
  keywords: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
  notes: string;
  steps: ParsedStep[];
}

interface Heading {
  level: number;
  title: string;
  lines: string[];
}

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/vpn|virtual private/i, 'VPN'],
  [/wi-?fi|wireless|network|internet|connectivity|dns/i, 'Network'],
  [/remote desktop|rdp|anydesk|teamviewer|remote access/i, 'Remote Access'],
  [/password|account|login|access|permission|mfa|2fa|ssO|sso/i, 'Accounts & Access'],
  [/email|outlook|exchange/i, 'Email'],
  [/phone|teams|softphone|voip|telephony/i, 'Telephony'],
  [/printer|print|scanner/i, 'Printing'],
  [/laptop|desktop|monitor|keyboard|mouse|hardware|dock/i, 'Hardware'],
  [/virus|malware|phishing|security|antivirus/i, 'Security'],
  [/slow|performance|freez|crash/i, 'Performance'],
  [/install|update|application|software|app\b|error dialog/i, 'Software'],
];

const SYMPTOM_HEADING = /^(symptoms?|common symptoms|signs?)\b/i;
const STEP_HEADING = /^(step\s*\d+|troubleshoot(ing)? steps?|procedure|resolution|fix(es)?)\b/i;
const DESTRUCTIVE_HINT =
  /reinstall|reformat|factory reset|uninstall|delete|reset|rollback|restore|wipe|clear all data/i;
const APPROVAL_HINT = /admin|administrator|it team|it support|requires approval|service desk/i;

function splitHeadings(text: string): Heading[] {
  const lines = text.split(/\r?\n/);
  const headings: Heading[] = [];
  let current: Heading | null = null;

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      const level = match[1].length;
      // A heading no deeper than the current article starts a new article;
      // deeper headings belong to the current one (kept as subsections).
      if (!current || level <= current.level) {
        if (current) headings.push(current);
        current = { level, title: match[2].trim(), lines: [] };
      } else {
        current.lines.push(line);
      }
      continue;
    }
    if (!current) {
      // Content before the first heading still belongs to a synthetic section.
      if (line.trim()) {
        current = { level: 2, title: '', lines: [line] };
      }
      continue;
    }
    current.lines.push(line);
  }
  if (current) headings.push(current);
  return headings;
}

function bullets(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => /^([-*+]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*+]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

function paragraphs(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function isStepHeading(title: string): boolean {
  const cleaned = title.replace(/[:.]$/, '').trim();
  if (/^step\s*\d+/i.test(cleaned)) return true;
  return STEP_HEADING.test(cleaned) && cleaned.length < 60;
}

/** Pulls `Expected:`, `If failed:`, `Then:`, `Escalate:` lines out of a step. */
function extractStepFields(lines: string[]): Omit<ParsedStep, 'position' | 'title' | 'instruction'> & {
  instruction: string;
} {
  const instructionLines: string[] = [];
  let expectedResult = '';
  let failureResult = '';
  let nextStep = '';
  let escalationInstructions = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const field = /^\*{0,2}(expected|expected result|success|if successful)\*{0,2}\s*[:\-—]\s*(.+)$/i.exec(line);
    if (field?.[2]) {
      expectedResult = field[2].trim();
      continue;
    }
    const failure = /^\*{0,2}(if (it )?fails?|on failure|if unsuccessful|failure result|otherwise)\*{0,2}\s*[:\-—]\s*(.+)$/i.exec(line);
    if (failure?.[2]) {
      failureResult = failure[2].trim();
      continue;
    }
    const then = /^\*{0,2}(then|next|next step|after that)\*{0,2}\s*[:\-—]\s*(.+)$/i.exec(line);
    if (then?.[2]) {
      nextStep = then[2].trim();
      continue;
    }
    const escalate =
      /^\*{0,2}(escalate|escalation|if it still fails|if this fails|contact it|hand over to it)\*{0,2}\s*[:\-—]?\s*(.*)$/i.exec(
        line,
      );
    if (escalate) {
      escalationInstructions = (escalate[2] ?? '').trim() || 'Escalate to IT support';
      continue;
    }
    instructionLines.push(line);
  }

  return {
    instruction: paragraphs(instructionLines),
    expectedResult,
    failureResult,
    nextStep,
    escalationInstructions,
    requiresAdminApproval: APPROVAL_HINT.test(lines.join(' ')),
    isDestructive: DESTRUCTIVE_HINT.test(lines.join(' ')),
  };
}

function inferCategory(text: string, explicit?: string): string {
  if (explicit) return explicit;
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(text)) return category;
  }
  return 'Other';
}

function inferPriority(text: string): ParsedArticle['priority'] | null {
  if (/\b(critical|sev ?1|outage|all users|urgent)\b/i.test(text)) return 'critical';
  if (/\b(high|sev ?2|common|frequent|blocks? work)\b/i.test(text)) return 'high';
  if (/\b(rare|low priority|nice to have)\b/i.test(text)) return 'low';
  return null;
}

function keywordsFrom(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3);
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

/**
 * Parses a single article section (a level-1/2 heading and everything under it).
 */
export function parseArticleSection(title: string, lines: string[], fallbackIndex: number): ParsedArticle {
  const article: ParsedArticle = {
    title: title || `Imported runbook ${fallbackIndex + 1}`,
    category: 'Other',
    issueDescription: '',
    symptoms: [],
    troubleshootingSteps: '',
    expectedResult: '',
    failureResult: '',
    nextStep: '',
    escalationInstructions: '',
    tags: [],
    keywords: [],
    priority: 'normal',
    notes: '',
    steps: [],
  };

  const overview: string[] = [];
  let currentSub: Heading | null = null;
  const subsections: Heading[] = [];
  const preamble: string[] = [];

  for (const line of lines) {
    const match = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (match?.[1] !== undefined) {
      if (currentSub) subsections.push(currentSub);
      currentSub = { level: 2, title: match[1].trim(), lines: [] };
      continue;
    }
    if (currentSub) currentSub.lines.push(line);
    else preamble.push(line);
  }
  if (currentSub) subsections.push(currentSub);

  // Article-level fields live in the preamble or in dedicated subsections.
  const fieldMap: Array<[RegExp, keyof ParsedArticle]> = [
    [/^category\b/i, 'category'],
    [/^expected result\b/i, 'expectedResult'],
    [/^failure result\b/i, 'failureResult'],
    [/^next step\b/i, 'nextStep'],
    [/^escalation instructions?\b/i, 'escalationInstructions'],
    [/^priority\b/i, 'priority'],
    [/^notes?\b/i, 'notes'],
  ];

  const readFields = (source: string[]): void => {
    for (const raw of source) {
      const line = raw.trim();
      for (const [pattern, key] of fieldMap) {
        const match = pattern.exec(line);
        if (!match) continue;
        const value = line.slice(match[0].length).replace(/^\s*[:\-—]\s*/, '').trim();
        if (key === 'priority') {
          if (/critical/i.test(value)) article.priority = 'critical';
          else if (/high/i.test(value)) article.priority = 'high';
          else if (/low/i.test(value)) article.priority = 'low';
          continue;
        }
        if (key === 'category') {
          article.category = value || article.category;
          continue;
        }
        (article as unknown as Record<string, unknown>)[key as string] = value;
      }
    }
  };

  readFields(preamble);

  const plainPreamble = preamble.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    return !fieldMap.some(([pattern]) => pattern.test(trimmed)) && !/^tags?\s*[:\-—]/i.test(trimmed);
  });

  const tagLine = preamble.find((line) => /^tags?\s*[:\-—]/i.test(line.trim()));
  if (tagLine) {
    article.tags = tagLine
      .split(/[:\-—]/)[1]
      ?.split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean) ?? [];
  }

  const stepSections: Heading[] = [];
  for (const section of subsections) {
    if (SYMPTOM_HEADING.test(section.title)) {
      const items = bullets(section.lines);
      article.symptoms.push(
        ...(items.length > 0 ? items : paragraphs(section.lines).split('\n').filter(Boolean)),
      );
      continue;
    }
    if (/^tags?\b/i.test(section.title)) {
      article.tags.push(
        ...section.lines
          .join(' ')
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
      );
      continue;
    }
    if (/^category\b/i.test(section.title)) {
      article.category = paragraphs(section.lines).trim() || article.category;
      continue;
    }
    if (/^expected result\b/i.test(section.title)) {
      article.expectedResult = paragraphs(section.lines).trim();
      continue;
    }
    if (/^failure result\b/i.test(section.title)) {
      article.failureResult = paragraphs(section.lines).trim();
      continue;
    }
    if (/^next step\b/i.test(section.title)) {
      article.nextStep = paragraphs(section.lines).trim();
      continue;
    }
    if (/^escalation instructions?\b/i.test(section.title)) {
      article.escalationInstructions = paragraphs(section.lines).trim();
      continue;
    }
    if (/^(notes?|important)\b/i.test(section.title)) {
      article.notes = [article.notes, paragraphs(section.lines).trim()].filter(Boolean).join('\n\n');
      continue;
    }
    if (isStepHeading(section.title)) {
      // Skip container headings (e.g. "Troubleshooting Steps") that hold no
      // direct content; their child "Step N" headings carry the instructions.
      if (section.lines.join('').trim().length === 0) continue;
      stepSections.push(section);
      continue;
    }
    // Unknown section: keep it as prose so nothing is lost.
    overview.push(`### ${section.title}`, paragraphs(section.lines));
  }

  // Steps that are only bullets under one "Steps" heading.
  for (const section of subsections) {
    if (stepSections.includes(section)) continue;
    if (!STEP_HEADING.test(section.title)) continue;
    const items = bullets(section.lines);
    if (items.length === 0) continue;
    for (const item of items) {
      const inline = /^(.*?)\s*[-—–]\s*(.+)$/.exec(item);
      stepSections.push({
        level: 3,
        title: inline?.[1]?.trim() || `Step ${stepSections.length + 1}`,
        lines: (inline?.[2] ?? item).split('\n'),
      });
    }
  }

  if (stepSections.length > 0) {
    stepSections.forEach((section, index) => {
      const fields = extractStepFields(section.lines);
      const title = section.title.replace(/^step\s*\d+\s*[:.\-—–]?\s*/i, '').trim();
      article.steps.push({
        position: index,
        title: title || `Step ${index + 1}`,
        instruction: fields.instruction || title,
        expectedResult: fields.expectedResult,
        failureResult: fields.failureResult,
        nextStep: fields.nextStep,
        escalationInstructions: fields.escalationInstructions,
        requiresAdminApproval: fields.requiresAdminApproval,
        isDestructive: fields.isDestructive,
      });
    });
    article.troubleshootingSteps = article.steps
      .map((step, index) => `Step ${index + 1}: ${step.instruction}`)
      .join('\n');
  }

  article.issueDescription = [paragraphs(plainPreamble), ...overview].filter(Boolean).join('\n\n').trim();
  article.symptoms = article.symptoms.map((symptom) => symptom.trim()).filter(Boolean).slice(0, 50);
  if (article.symptoms.length === 0) {
    // Fall back to bullet points in the overview as symptoms.
    article.symptoms = bullets(plainPreamble).slice(0, 20);
    if (article.symptoms.length > 0) {
      article.issueDescription = paragraphs(
        plainPreamble.filter((line) => !/^([-*+]|\d+[.)])\s+/.test(line.trim())),
      );
    }
  }

  const allText = [title, article.issueDescription, ...article.symptoms, article.troubleshootingSteps].join(' ');
  article.category = inferCategory(allText, article.category);
  article.priority = inferPriority(allText) ?? article.priority;
  article.keywords = keywordsFrom(allText);
  if (article.tags.length === 0) {
    article.tags = [article.category.toLowerCase(), ...article.keywords.slice(0, 4)];
  }

  return article;
}

/**
 * Splits a document into article drafts: one per top-level heading, or a single
 * article when the document has no headings.
 */
export function parseKnowledgeDocument(text: string): ParsedArticle[] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  const headings = splitHeadings(normalized);
  const topLevel = headings.filter((heading) => heading.level <= 2);
  const sources = topLevel.length > 0 ? topLevel : headings;

  const articles = sources
    .filter((heading) => heading.title.trim().length > 0 || heading.lines.join('').trim().length > 0)
    .map((heading, index) => parseArticleSection(heading.title, heading.lines, index))
    .filter((article) => article.title || article.issueDescription || article.steps.length > 0);

  return articles;
}

/** Plain-text fallback: split on `---` blocks when no headings exist. */
export function parsePlainTextRunbook(text: string): ParsedArticle[] {
  const blocks = text
    .split(/^\s*(?:---+|===+)\s*$/m)
    .map((block) => block.trim())
    .filter((block) => block.length > 40);
  if (blocks.length < 2) return parseKnowledgeDocument(text);

  return blocks.map((block, index) => {
    const firstLine = block.split('\n')[0]?.trim() ?? '';
    const rest = block.split('\n').slice(1).join('\n');
    const title = firstLine.replace(/^#+\s*/, '').slice(0, 200) || `Imported runbook ${index + 1}`;
    return parseArticleSection(title, rest.split('\n'), index);
  });
}
