/**
 * Troubleshooting knowledge base: articles, steps and reference screenshots
 * (§6, §27).
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { ArticleInput, ArticleUpdateInput, ArticleDto } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import {
  articleImages,
  articleSteps,
  documents,
  troubleshootingArticles,
  users,
  type Article,
  type ArticleImage,
  type ArticleStep,
  type User,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { getStorage, buildKey, type StoredFile } from '../storage/service.js';
import type { AiImage, KnowledgeArticleContext } from '../ai/types.js';
import { listCategories, searchArticlesForAdmin } from './search.js';

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'article'
  );
}

async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title);
  let candidate = base;
  for (let attempt = 1; attempt < 50; attempt++) {
    const rows = await db
      .select({ id: troubleshootingArticles.id })
      .from(troubleshootingArticles)
      .where(eq(troubleshootingArticles.slug, candidate))
      .limit(1);
    if (rows.length === 0 || rows[0]?.id === excludeId) return candidate;
    candidate = `${base}-${attempt + 1}`;
  }
  return `${base}-${Date.now()}`;
}

export interface ArticleBundle {
  article: Article;
  steps: ArticleStep[];
  images: ArticleImage[];
  stepCount: number;
  sourceDocumentTitle: string | null;
  createdByName: string | null;
  updatedByName: string | null;
}

async function loadBundles(articles: Article[]): Promise<ArticleBundle[]> {
  if (articles.length === 0) return [];
  const ids = articles.map((article) => article.id);

  const [steps, images, docs, creators] = await Promise.all([
    db
      .select()
      .from(articleSteps)
      .where(inArray(articleSteps.articleId, ids))
      .orderBy(asc(articleSteps.position)),
    db
      .select()
      .from(articleImages)
      .where(inArray(articleImages.articleId, ids))
      .orderBy(asc(articleImages.position)),
    db
      .select({ id: documents.id, title: documents.title })
      .from(documents)
      .where(inArray(documents.id, articles.map((a) => a.sourceDocumentId).filter((v): v is string => Boolean(v)))),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const nameMap = new Map(creators.map((c) => [c.id, c.name]));
  const docMap = new Map(docs.map((d) => [d.id, d.title]));

  return articles.map((article) => {
    const articleStepsList = steps.filter((step) => step.articleId === article.id);
    return {
      article,
      steps: articleStepsList,
      images: images.filter((image) => image.articleId === article.id),
      stepCount: articleStepsList.length,
      sourceDocumentTitle: article.sourceDocumentId ? (docMap.get(article.sourceDocumentId) ?? null) : null,
      createdByName: article.createdBy ? (nameMap.get(article.createdBy) ?? null) : null,
      updatedByName: article.updatedBy ? (nameMap.get(article.updatedBy) ?? null) : null,
    };
  });
}

export function articleToDto(bundle: ArticleBundle, storage = getStorage()): ArticleDto {
  const { article, steps, images } = bundle;
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    category: article.category,
    issueDescription: article.issueDescription,
    troubleshootingSteps: article.troubleshootingSteps,
    symptoms: article.symptoms,
    expectedResult: article.expectedResult,
    failureResult: article.failureResult,
    nextStep: article.nextStep,
    escalationInstructions: article.escalationInstructions,
    tags: article.tags,
    keywords: article.keywords,
    priority: article.priority,
    isActive: article.isActive,
    notes: article.notes,
    version: article.version,
    sourceDocumentId: article.sourceDocumentId,
    sourceDocumentTitle: bundle.sourceDocumentTitle,
    createdBy: article.createdBy,
    createdByName: bundle.createdByName,
    updatedBy: article.updatedBy,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
    steps: steps.map((step) => ({
      id: step.id,
      articleId: step.articleId,
      position: step.position,
      title: step.title,
      instruction: step.instruction,
      expectedResult: step.expectedResult,
      failureResult: step.failureResult,
      nextStep: step.nextStep,
      escalationInstructions: step.escalationInstructions,
      requiresAdminApproval: step.requiresAdminApproval,
      isDestructive: step.isDestructive,
      images: images
        .filter((image) => image.stepId === step.id)
        .map((image) => imageToDto(image, storage)),
    })),
    images: images.map((image) => imageToDto(image, storage)),
    stepCount: bundle.stepCount,
  };
}

export function imageToDto(image: ArticleImage, storage = getStorage()): ArticleDto['images'][number] {
  return {
    id: image.id,
    articleId: image.articleId,
    stepId: image.stepId,
    label: image.label,
    description: image.description,
    url: image.url || (image.storagePath ? storage.publicUrl(image.storagePath) : ''),
    mimetype: image.mimetype,
    width: image.width,
    height: image.height,
    position: image.position,
  };
}

export async function listArticles(query: {
  q?: string;
  category?: string;
  priority?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
  sort: string;
}): Promise<{ items: ArticleDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const { items, total } = await searchArticlesForAdmin(query);
  const bundles = await loadBundles(items);
  return {
    items: bundles.map((bundle) => articleToDto(bundle)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getArticle(id: string): Promise<ArticleDto | null> {
  const rows = await db
    .select()
    .from(troubleshootingArticles)
    .where(eq(troubleshootingArticles.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const [bundle] = await loadBundles([rows[0]]);
  return bundle ? articleToDto(bundle) : null;
}

export async function createArticle(input: ArticleInput, user: Pick<User, 'id' | 'email'>): Promise<ArticleDto> {
  const slug = await uniqueSlug(input.title);
  const [article] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(troubleshootingArticles)
      .values({
        title: input.title,
        slug,
        category: input.category,
        issueDescription: input.issueDescription,
        symptoms: input.symptoms,
        troubleshootingSteps: input.troubleshootingSteps,
        expectedResult: input.expectedResult,
        failureResult: input.failureResult,
        nextStep: input.nextStep,
        escalationInstructions: input.escalationInstructions,
        tags: input.tags,
        keywords: input.keywords,
        priority: input.priority,
        isActive: input.isActive,
        notes: input.notes,
        sourceDocumentId: input.sourceDocumentId ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const created = inserted[0];
    if (!created) throw new AppError('Failed to create article');

    if (input.steps.length > 0) {
      await tx.insert(articleSteps).values(
        input.steps.map((step, index) => ({
          articleId: created.id,
          position: step.position ?? index,
          title: step.title,
          instruction: step.instruction,
          expectedResult: step.expectedResult,
          failureResult: step.failureResult,
          nextStep: step.nextStep,
          escalationInstructions: step.escalationInstructions,
          requiresAdminApproval: step.requiresAdminApproval,
          isDestructive: step.isDestructive,
        })),
      );
    }
    return inserted;
  });

  await recordAudit({
    user,
    action: 'kb.article.create',
    entityType: 'troubleshooting_article',
    entityId: article!.id,
    summary: `Created article "${input.title}"`,
    after: { title: input.title, category: input.category, steps: input.steps.length },
  });

  return (await getArticle(article!.id))!;
}

export async function updateArticle(
  id: string,
  input: ArticleUpdateInput,
  user: Pick<User, 'id' | 'email'>,
): Promise<ArticleDto> {
  const existing = await getArticle(id);
  if (!existing) throw AppError.notFound('Article');

  await db.transaction(async (tx) => {
    const values: Record<string, unknown> = { updatedBy: user.id, updatedAt: new Date(), version: existing.version + 1 };
    if (input.title !== undefined) {
      values.title = input.title;
      values.slug = await uniqueSlug(input.title, id);
    }
    for (const key of [
      'category',
      'issueDescription',
      'symptoms',
      'troubleshootingSteps',
      'expectedResult',
      'failureResult',
      'nextStep',
      'escalationInstructions',
      'tags',
      'keywords',
      'priority',
      'isActive',
      'notes',
    ] as const) {
      if (input[key] !== undefined) values[key] = input[key];
    }
    if (input.sourceDocumentId !== undefined) values.sourceDocumentId = input.sourceDocumentId;

    await tx.update(troubleshootingArticles).set(values as never).where(eq(troubleshootingArticles.id, id));

    if (input.steps) {
      const stepIds = await tx
        .select({ id: articleSteps.id, imageCount: sql<number>`0` })
        .from(articleSteps)
        .where(eq(articleSteps.articleId, id));
      const ids = stepIds.map((s) => s.id);
      if (ids.length > 0) {
        // Detach images before deleting steps so reference screenshots survive.
        await tx.update(articleImages).set({ stepId: null }).where(inArray(articleImages.stepId, ids));
        await tx.delete(articleSteps).where(eq(articleSteps.articleId, id));
      }
      if (input.steps.length > 0) {
        await tx.insert(articleSteps).values(
          input.steps.map((step, index) => ({
            articleId: id,
            position: step.position ?? index,
            title: step.title,
            instruction: step.instruction,
            expectedResult: step.expectedResult,
            failureResult: step.failureResult,
            nextStep: step.nextStep,
            escalationInstructions: step.escalationInstructions,
            requiresAdminApproval: step.requiresAdminApproval,
            isDestructive: step.isDestructive,
          })),
        );
      }
    }

    if (input.images) {
      const keepIds = input.images.map((image) => image.id).filter((v): v is string => Boolean(v));
      const current = await tx
        .select({ id: articleImages.id })
        .from(articleImages)
        .where(eq(articleImages.articleId, id));
      const remove = current.filter((image) => !keepIds.includes(image.id)).map((image) => image.id);
      if (remove.length > 0) await tx.delete(articleImages).where(inArray(articleImages.id, remove));
    }
  });

  // Attach uploaded images (those that arrive with a URL but no id).
  if (input.images) {
    for (const [index, image] of input.images.entries()) {
      if (image.id) continue;
      await attachImage(id, image.url, {
        stepId: image.stepId ?? null,
        label: image.label,
        description: image.description,
        position: image.position ?? index,
        mimetype: image.mimetype,
        width: image.width ?? null,
        height: image.height ?? null,
      });
    }
  }

  await recordAudit({
    user,
    action: 'kb.article.update',
    entityType: 'troubleshooting_article',
    entityId: id,
    summary: `Updated article "${existing.title}"`,
    before: { title: existing.title, version: existing.version },
    after: { title: input.title ?? existing.title, version: existing.version + 1 },
  });

  return (await getArticle(id))!;
}

export async function deleteArticle(id: string, user: Pick<User, 'id' | 'email'>): Promise<void> {
  const existing = await getArticle(id);
  if (!existing) throw AppError.notFound('Article');

  const storagePaths = existing.images.map((image) => image.url).filter((url) => url.includes('/api/files/'));
  await db.delete(troubleshootingArticles).where(eq(troubleshootingArticles.id, id));

  const storage = getStorage();
  await Promise.all(
    storagePaths.map(async (url) => {
      const key = url.split('/api/files/')[1];
      if (key) await storage.delete(key).catch(() => undefined);
    }),
  );

  await recordAudit({
    user,
    action: 'kb.article.delete',
    entityType: 'troubleshooting_article',
    entityId: id,
    summary: `Deleted article "${existing.title}"`,
    before: { title: existing.title, category: existing.category },
  });
}

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

export interface AttachImageInput {
  stepId?: string | null;
  label?: string;
  description?: string;
  position?: number;
  mimetype?: string;
  width?: number | null;
  height?: number | null;
  data?: Buffer;
  filename?: string;
}

/** Attaches a reference screenshot either from bytes or an existing URL. */
export async function attachImage(
  articleId: string,
  urlOrNull: string | null,
  input: AttachImageInput,
): Promise<ArticleImage> {
  let url = urlOrNull ?? '';
  let storagePath: string | null = null;

  if (input.data) {
    const mimetype = input.mimetype ?? 'image/png';
    const key = buildKey('kb', input.data, mimetype, input.filename);
    const stored: StoredFile = await getStorage().put(key, input.data, mimetype);
    url = stored.url;
    storagePath = stored.key;
  } else if (!url) {
    throw AppError.validation('An image needs either a file or a URL');
  } else if (url.startsWith('/api/files/')) {
    storagePath = url.split('/api/files/')[1] ?? null;
  }

  const [row] = await db
    .insert(articleImages)
    .values({
      articleId,
      stepId: input.stepId ?? null,
      label: input.label ?? '',
      description: input.description ?? '',
      url,
      storagePath,
      mimetype: input.mimetype ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      position: input.position ?? 0,
    })
    .returning();
  return row!;
}

export async function deleteArticleImage(imageId: string): Promise<void> {
  await db.delete(articleImages).where(eq(articleImages.id, imageId));
}

/* -------------------------------------------------------------------------- */
/* AI context                                                                  */
/* -------------------------------------------------------------------------- */

export async function getArticleContexts(
  ids: string[],
  maxSteps: number,
): Promise<KnowledgeArticleContext[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(troubleshootingArticles)
    .where(inArray(troubleshootingArticles.id, ids));
  const order = new Map(ids.map((id, index) => [id, index]));
  rows.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const bundles = await loadBundles(rows);

  return bundles.map(({ article, steps, images }) => ({
    id: article.id,
    title: article.title,
    category: article.category,
    priority: article.priority,
    issueDescription: article.issueDescription,
    troubleshootingSteps: article.troubleshootingSteps,
    symptoms: article.symptoms,
    expectedResult: article.expectedResult,
    failureResult: article.failureResult,
    nextStep: article.nextStep,
    escalationInstructions: article.escalationInstructions,
    notes: article.notes,
    steps: steps.slice(0, maxSteps).map((step) => ({
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
    images: images.map((image) => ({
      id: image.id,
      label: image.label,
      description: image.description,
      url: image.url,
    })),
  }));
}

/**
 * Loads the documented screenshots of the retrieved articles so the vision
 * model can compare the agent's screenshot against them (§27).
 */
export async function getReferenceImages(
  articleIds: string[],
  maxImages = 6,
): Promise<Array<{ id: string; label: string; description: string; image: AiImage }>> {
  if (articleIds.length === 0) return [];
  const rows = await db
    .select()
    .from(articleImages)
    .where(inArray(articleImages.articleId, articleIds))
    .orderBy(asc(articleImages.position))
    .limit(maxImages);

  const storage = getStorage();
  const result: Array<{ id: string; label: string; description: string; image: AiImage }> = [];
  for (const row of rows) {
    if (!row.storagePath) continue;
    try {
      const data = await storage.get(row.storagePath);
      if (data.length > 4 * 1024 * 1024) continue;
      result.push({
        id: row.id,
        label: row.label,
        description: row.description,
        image: { data, mimetype: row.mimetype ?? 'image/png', label: row.label },
      });
    } catch {
      // A missing reference image must not break the turn.
    }
  }
  return result;
}

export async function knowledgeBaseStats(): Promise<{
  articles: number;
  active: number;
  steps: number;
  images: number;
  categories: Array<{ category: string; count: number }>;
}> {
  const [articleRows, stepRows, imageRows, categories] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${troubleshootingArticles.isActive})::int`,
      })
      .from(troubleshootingArticles),
    db.select({ count: sql<number>`count(*)::int` }).from(articleSteps),
    db.select({ count: sql<number>`count(*)::int` }).from(articleImages),
    listCategories(),
  ]);
  return {
    articles: articleRows[0]?.total ?? 0,
    active: articleRows[0]?.active ?? 0,
    steps: stepRows[0]?.count ?? 0,
    images: imageRows[0]?.count ?? 0,
    categories,
  };
}
