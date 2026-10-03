/**
 * Knowledge-base document import (§26).
 *
 * Accepts Markdown, PDF, plain text and images. Text is extracted once, stored
 * with the document and parsed into article drafts. The whole document is never
 * sent to the model — only the retrieved article sections reach a prompt.
 */
import { eq, sql } from 'drizzle-orm';
import type { DocumentSourceType, DocumentDto } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { documents, users, type DocumentRow, type User } from '../../db/schema.js';
import { AppError, errorMessage } from '../../lib/errors.js';
import { log } from '../logging/service.js';
import { buildKey, getStorage } from '../storage/service.js';
import { createArticle } from './articles.js';
import { parseKnowledgeDocument, parsePlainTextRunbook, type ParsedArticle } from './parser.js';
import { extractPdfText } from './pdf.js';

export interface IngestInput {
  data: Buffer;
  filename: string;
  mimetype: string;
  title?: string;
  user: Pick<User, 'id' | 'email'>;
  /** Create article rows from the parsed drafts. */
  createArticles?: boolean;
  /** Describe uploaded images with the vision model. */
  describeImages?: boolean;
}

export function detectSourceType(filename: string, mimetype: string): DocumentSourceType {
  const lower = filename.toLowerCase();
  const type = mimetype.toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) return 'image';
  if (type === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (type === 'text/markdown' || /\.(md|markdown|mdx)$/.test(lower)) return 'markdown';
  return 'text';
}

export interface IngestResult {
  document: DocumentDto;
  articles: Array<{ id: string; title: string; steps: number }>;
  preview: string;
}

export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const sourceType = detectSourceType(input.filename, input.mimetype);
  const title = input.title?.trim() || input.filename.replace(/\.[^.]+$/, '').slice(0, 200);

  const [document] = await db
    .insert(documents)
    .values({
      title,
      sourceType,
      filename: input.filename,
      mimetype: input.mimetype,
      size: input.data.length,
      status: 'processing',
      importedBy: input.user.id,
    })
    .returning();

  if (!document) throw new AppError('Failed to record the imported document');

  try {
    const key = buildKey('documents', input.data, input.mimetype, input.filename);
    const stored = await getStorage().put(key, input.data, input.mimetype);

    let text = '';
    let pageCount: number | null = null;

    if (sourceType === 'pdf') {
      const extracted = await extractPdfText(input.data);
      text = extracted.text;
      pageCount = extracted.pageCount;
    } else if (sourceType === 'image') {
      if (input.describeImages) {
        text = await describeImage(input.data, input.mimetype, title);
      } else {
        text = '';
      }
    } else {
      text = input.data.toString('utf8');
    }

    const drafts: ParsedArticle[] = text.trim()
      ? sourceType === 'text'
        ? parsePlainTextRunbook(text)
        : parseKnowledgeDocument(text)
      : [];

    const [updated] = await db
      .update(documents)
      .set({
        status: 'indexed',
        storagePath: stored.key,
        extractedText: text.slice(0, 400_000),
        extractedChars: text.length,
        pageCount,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id))
      .returning();

    const created: Array<{ id: string; title: string; steps: number }> = [];
    if (input.createArticles !== false) {
      for (const draft of drafts.slice(0, 100)) {
        const article = await createArticle(
          {
            title: draft.title.slice(0, 300),
            category: draft.category,
            issueDescription: draft.issueDescription,
            symptoms: draft.symptoms,
            troubleshootingSteps: draft.troubleshootingSteps,
            expectedResult: draft.expectedResult,
            failureResult: draft.failureResult,
            nextStep: draft.nextStep,
            escalationInstructions: draft.escalationInstructions,
            tags: draft.tags,
            keywords: draft.keywords,
            priority: draft.priority,
            isActive: true,
            notes: draft.notes,
            sourceDocumentId: document.id,
            steps: draft.steps.map((step) => ({
              position: step.position,
              title: step.title,
              instruction: step.instruction,
              expectedResult: step.expectedResult,
              failureResult: step.failureResult,
              nextStep: step.nextStep,
              escalationInstructions: step.escalationInstructions,
              requiresAdminApproval: step.requiresAdminApproval,
              isDestructive: step.isDestructive,
            })),
            images: [],
          },
          input.user,
        );
        created.push({ id: article.id, title: article.title, steps: article.stepCount });
      }
    }

    log.info(
      {
        category: 'knowledge',
        documentId: document.id,
        sourceType,
        chars: text.length,
        articles: created.length,
      },
      'Imported knowledge-base document',
    );

    return {
      document: documentToDto(updated ?? document, created.length),
      articles: created,
      preview: text.slice(0, 2000),
    };
  } catch (error) {
    await db
      .update(documents)
      .set({ status: 'failed', error: errorMessage(error).slice(0, 2000) })
      .where(eq(documents.id, document.id));
    throw error;
  }
}

/** Uses the configured vision model to turn an imported image into a runbook stub. */
async function describeImage(data: Buffer, mimetype: string, title: string): Promise<string> {
  const { AiRunner } = await import('../ai/runner.js');
  const { getActiveInstructions } = await import('../ai/config-service.js');
  const { getTroubleshootingConfig } = await import('../settings/service.js');
  const { correlationId } = await import('../../lib/ids.js');

  const config = await getTroubleshootingConfig();
  const runner = await AiRunner.create({
    correlationId: correlationId(),
    instructions: await getActiveInstructions(),
    maxStepsPerArticle: config.kbMaxSteps,
    escalationInfoItems: config.escalationInfoItems,
    agentName: 'knowledge importer',
  });

  const { result } = await runner.run(
    'analyzeImage',
    (provider) =>
      provider.analyzeImage({
        image: { data, mimetype },
        referenceImages: [],
        context: `This is a screenshot or diagram from the troubleshooting documentation titled "${title}". Describe it so an IT support agent can recognise it, and list the error text it shows verbatim.`,
      }),
    { requiresVision: true },
  );

  return [
    `# ${result.summary || title}`,
    '',
    `Application: ${result.application ?? 'unknown'}`,
    `UI state: ${result.uiState ?? 'unknown'}`,
    result.errorMessages.length ? `Visible messages: ${result.errorMessages.join(' | ')}` : '',
    result.notes.length ? `Notes: ${result.notes.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function documentToDto(row: DocumentRow, articleCount = 0): DocumentDto {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.sourceType,
    filename: row.filename,
    size: row.size,
    pageCount: row.pageCount,
    status: row.status,
    error: row.error,
    extractedChars: row.extractedChars,
    articleCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listDocuments(limit = 100): Promise<DocumentDto[]> {
  const rows = await db
    .select({
      document: documents,
      articleCount: sql<number>`(
        SELECT count(*)::int FROM troubleshooting_articles a WHERE a.source_document_id = ${documents.id}
      )`,
    })
    .from(documents)
    .orderBy(sql`${documents.createdAt} desc`)
    .limit(limit);
  return rows.map((row) => documentToDto(row.document, row.articleCount));
}

export async function getDocument(id: string): Promise<(DocumentDto & { text: string }) | null> {
  const rows = await db
    .select({
      document: documents,
      articleCount: sql<number>`(
        SELECT count(*)::int FROM troubleshooting_articles a WHERE a.source_document_id = ${documents.id}
      )`,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...documentToDto(row.document, row.articleCount), text: row.document.extractedText };
}

export async function deleteDocument(id: string, user: Pick<User, 'id' | 'email'>): Promise<void> {
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const document = rows[0];
  if (!document) throw AppError.notFound('Document');

  await db.delete(documents).where(eq(documents.id, id));
  if (document.storagePath) {
    await getStorage().delete(document.storagePath).catch(() => undefined);
  }
  const { recordAudit } = await import('../audit/service.js');
  await recordAudit({
    user,
    action: 'kb.document.delete',
    entityType: 'document',
    entityId: id,
    summary: `Deleted imported document "${document.title}"`,
  });
}

/** Re-runs parsing for a stored document (e.g. after the parser improves). */
export async function reparseDocument(
  id: string,
  user: Pick<User, 'id' | 'email'>,
): Promise<IngestResult> {
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const document = rows[0];
  if (!document) throw AppError.notFound('Document');
  if (!document.storagePath) throw AppError.validation('The original file is no longer stored');

  const drafts =
    document.sourceType === 'text'
      ? parsePlainTextRunbook(document.extractedText)
      : parseKnowledgeDocument(document.extractedText);

  const created: Array<{ id: string; title: string; steps: number }> = [];
  for (const draft of drafts.slice(0, 100)) {
    const article = await createArticle(
      {
        title: draft.title.slice(0, 300),
        category: draft.category,
        issueDescription: draft.issueDescription,
        symptoms: draft.symptoms,
        troubleshootingSteps: draft.troubleshootingSteps,
        expectedResult: draft.expectedResult,
        failureResult: draft.failureResult,
        nextStep: draft.nextStep,
        escalationInstructions: draft.escalationInstructions,
        tags: draft.tags,
        keywords: draft.keywords,
        priority: draft.priority,
        isActive: true,
        notes: draft.notes,
        sourceDocumentId: document.id,
        steps: draft.steps.map((step) => ({
          position: step.position,
          title: step.title,
          instruction: step.instruction,
          expectedResult: step.expectedResult,
          failureResult: step.failureResult,
          nextStep: step.nextStep,
          escalationInstructions: step.escalationInstructions,
          requiresAdminApproval: step.requiresAdminApproval,
          isDestructive: step.isDestructive,
        })),
        images: [],
      },
      user,
    );
    created.push({ id: article.id, title: article.title, steps: article.stepCount });
  }

  const articleCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sql`troubleshooting_articles`)
    .where(sql`source_document_id = ${id}`);

  return {
    document: documentToDto(document, articleCount[0]?.count ?? created.length),
    articles: created,
    preview: document.extractedText.slice(0, 2000),
  };
}

export async function documentImporterHealth(): Promise<{ users: number }> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return { users: rows[0]?.count ?? 0 };
}
