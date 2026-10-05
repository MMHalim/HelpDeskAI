/**
 * Incident taxonomy and categorization of resolved issues (§32).
 *
 * A resolved session is filed under exactly one sub-category of one macro
 * category. The AI proposes the pair when the agent confirms resolution, and an
 * administrator can correct it later; the resulting counts drive the "most
 * received issues" report.
 *
 * Separate from `troubleshooting_articles.category`, which only drives
 * knowledge-base retrieval.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type {
  CategorizationSource,
  IncidentPriorityLevel,
  IssueCategorizationDto,
  IssueCategoryDto,
  IssueReportDto,
} from '@helpdesk/shared';
import { db } from '../../db/client.js';
import {
  issueCategorizations,
  issueCategories,
  issueSubcategories,
  troubleshootingSessions,
  users,
} from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { TAXONOMY_SEED } from './taxonomy.js';

/* -------------------------------------------------------------------------- */
/* Taxonomy                                                                    */
/* -------------------------------------------------------------------------- */

export interface SubcategoryOption {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  priorityLevel: IncidentPriorityLevel;
}

/** Full taxonomy tree, for the dashboard and the AI prompt. */
export async function listTaxonomy(): Promise<IssueCategoryDto[]> {
  const [categories, subcategories] = await Promise.all([
    db.select().from(issueCategories).orderBy(asc(issueCategories.sortOrder), asc(issueCategories.name)),
    db
      .select()
      .from(issueSubcategories)
      .orderBy(asc(issueSubcategories.sortOrder), asc(issueSubcategories.name)),
  ]);

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    baselineIncidentCount: category.baselineIncidentCount,
    baselinePercentage: category.baselinePercentage,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    subcategories: subcategories
      .filter((sub) => sub.categoryId === category.id)
      .map((sub) => ({
        id: sub.id,
        categoryId: sub.categoryId,
        name: sub.name,
        slug: sub.slug,
        description: sub.description,
        priorityLevel: sub.priorityLevel,
        operationalImpact: sub.operationalImpact,
        baselineIncidentCount: sub.baselineIncidentCount,
        baselinePercentage: sub.baselinePercentage,
        sortOrder: sub.sortOrder,
        isActive: sub.isActive,
      })),
  }));
}

/** Flat sub-category list with parent names, used to constrain the AI. */
export async function listSubcategoryOptions(): Promise<SubcategoryOption[]> {
  const rows = await db
    .select({
      id: issueSubcategories.id,
      name: issueSubcategories.name,
      categoryId: issueCategories.id,
      categoryName: issueCategories.name,
      priorityLevel: issueSubcategories.priorityLevel,
    })
    .from(issueSubcategories)
    .innerJoin(issueCategories, eq(issueSubcategories.categoryId, issueCategories.id))
    .where(and(eq(issueSubcategories.isActive, true), eq(issueCategories.isActive, true)))
    .orderBy(asc(issueCategories.sortOrder), asc(issueSubcategories.sortOrder));

  return rows;
}

/* -------------------------------------------------------------------------- */
/* Categorization of a session                                                 */
/* -------------------------------------------------------------------------- */

const categorizationSelect = {
  sessionId: issueCategorizations.sessionId,
  categoryId: issueCategories.id,
  categoryName: issueCategories.name,
  categorySlug: issueCategories.slug,
  subcategoryId: issueSubcategories.id,
  subcategoryName: issueSubcategories.name,
  subcategorySlug: issueSubcategories.slug,
  priorityLevel: issueSubcategories.priorityLevel,
  operationalImpact: issueSubcategories.operationalImpact,
  source: issueCategorizations.source,
  confidence: issueCategorizations.confidence,
  rationale: issueCategorizations.rationale,
  categorizedByName: users.name,
  categorizedAt: issueCategorizations.categorizedAt,
};

export async function getCategorization(sessionId: string): Promise<IssueCategorizationDto | null> {
  const rows = await db
    .select(categorizationSelect)
    .from(issueCategorizations)
    .innerJoin(issueCategories, eq(issueCategorizations.categoryId, issueCategories.id))
    .innerJoin(issueSubcategories, eq(issueCategorizations.subcategoryId, issueSubcategories.id))
    .leftJoin(users, eq(issueCategorizations.categorizedBy, users.id))
    .where(eq(issueCategorizations.sessionId, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, categorizedAt: row.categorizedAt.toISOString() };
}

export interface UpsertCategorizationInput {
  sessionId: string;
  subcategoryId: string;
  source: CategorizationSource;
  confidence?: number;
  rationale?: string;
  userId?: string | null;
}

/**
 * Files a resolved session under a sub-category, replacing any previous
 * choice. The parent category always follows the sub-category, so the two can
 * never disagree.
 */
export async function upsertCategorization(input: UpsertCategorizationInput): Promise<IssueCategorizationDto> {
  const subcategories = await db
    .select({
      id: issueSubcategories.id,
      categoryId: issueSubcategories.categoryId,
      isActive: issueSubcategories.isActive,
    })
    .from(issueSubcategories)
    .where(eq(issueSubcategories.id, input.subcategoryId))
    .limit(1);

  const subcategory = subcategories[0];
  if (!subcategory || !subcategory.isActive) {
    throw AppError.notFound('Issue sub-category');
  }

  const sessionExists = await db
    .select({ id: troubleshootingSessions.id })
    .from(troubleshootingSessions)
    .where(eq(troubleshootingSessions.id, input.sessionId))
    .limit(1);
  if (!sessionExists[0]) throw AppError.notFound('Session');

  await db
    .insert(issueCategorizations)
    .values({
      sessionId: input.sessionId,
      categoryId: subcategory.categoryId,
      subcategoryId: subcategory.id,
      source: input.source,
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0)),
      rationale: input.rationale ?? '',
      categorizedBy: input.userId ?? null,
    })
    .onConflictDoUpdate({
      target: issueCategorizations.sessionId,
      set: {
        categoryId: subcategory.categoryId,
        subcategoryId: subcategory.id,
        source: input.source,
        confidence: Math.max(0, Math.min(1, input.confidence ?? 0)),
        rationale: input.rationale ?? '',
        categorizedBy: input.userId ?? null,
        categorizedAt: new Date(),
      },
    });

  const saved = await getCategorization(input.sessionId);
  if (!saved) throw AppError.internal('Failed to save the issue categorization');
  return saved;
}

/**
 * Best-effort categorization: a failure here must never break the resolution
 * that already succeeded, so errors are logged and swallowed.
 */
export async function tryUpsertCategorization(input: UpsertCategorizationInput): Promise<void> {
  try {
    await upsertCategorization(input);
  } catch (error) {
    logger.error({ err: error, sessionId: input.sessionId }, 'Failed to categorize the resolved issue');
  }
}

/* -------------------------------------------------------------------------- */
/* Reporting                                                                   */
/* -------------------------------------------------------------------------- */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Counts of categorized sessions, ordered by volume (most received first). */
export async function getIssueReport(options: { from?: string; to?: string } = {}): Promise<IssueReportDto> {
  const filters = [];
  if (options.from) filters.push(gte(issueCategorizations.categorizedAt, new Date(options.from)));
  if (options.to) filters.push(lte(issueCategorizations.categorizedAt, new Date(options.to)));
  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db
    .select({
      categoryId: issueCategories.id,
      categoryName: issueCategories.name,
      categoryBaselineCount: issueCategories.baselineIncidentCount,
      categoryBaselinePercentage: issueCategories.baselinePercentage,
      subcategoryId: issueSubcategories.id,
      subcategoryName: issueSubcategories.name,
      priorityLevel: issueSubcategories.priorityLevel,
      baselineCount: issueSubcategories.baselineIncidentCount,
      baselinePercentage: issueSubcategories.baselinePercentage,
      count: sql<number>`count(${issueCategorizations.id})::int`,
    })
    .from(issueCategorizations)
    .innerJoin(issueSubcategories, eq(issueCategorizations.subcategoryId, issueSubcategories.id))
    .innerJoin(issueCategories, eq(issueSubcategories.categoryId, issueCategories.id))
    .where(where)
    .groupBy(
      issueCategories.id,
      issueCategories.name,
      issueCategories.baselineIncidentCount,
      issueCategories.baselinePercentage,
      issueSubcategories.id,
      issueSubcategories.name,
      issueSubcategories.priorityLevel,
      issueSubcategories.baselineIncidentCount,
      issueSubcategories.baselinePercentage,
    )
    .orderBy(desc(sql<number>`count(${issueCategorizations.id})`), asc(issueSubcategories.name));

  const totalCategorized = rows.reduce((sum, row) => sum + row.count, 0);

  const bySubcategory = rows.map((row) => ({
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    subcategoryId: row.subcategoryId,
    subcategoryName: row.subcategoryName,
    priorityLevel: row.priorityLevel,
    count: row.count,
    percentage: totalCategorized > 0 ? round2((row.count / totalCategorized) * 100) : 0,
    baselineCount: row.baselineCount,
    baselinePercentage: row.baselinePercentage,
  }));

  const categoryTotals = new Map<
    string,
    { categoryId: string; categoryName: string; count: number; baselineCount: number; baselinePercentage: number }
  >();
  for (const row of rows) {
    const existing = categoryTotals.get(row.categoryId);
    if (existing) {
      existing.count += row.count;
      continue;
    }
    categoryTotals.set(row.categoryId, {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      count: row.count,
      baselineCount: row.categoryBaselineCount,
      baselinePercentage: row.categoryBaselinePercentage,
    });
  }

  const byCategory = [...categoryTotals.values()]
    .map((row) => ({
      ...row,
      percentage: totalCategorized > 0 ? round2((row.count / totalCategorized) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.categoryName.localeCompare(b.categoryName));

  return {
    from: options.from ?? null,
    to: options.to ?? null,
    totalCategorized,
    bySubcategory,
    byCategory,
  };
}

/** Session ids of the given category, used by the dashboard filters. */
export async function listCategorizedSessionIds(subcategoryId: string): Promise<string[]> {
  const rows = await db
    .select({ sessionId: issueCategorizations.sessionId })
    .from(issueCategorizations)
    .where(eq(issueCategorizations.subcategoryId, subcategoryId));
  return rows.map((row) => row.sessionId);
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Creates the taxonomy described in `taxonomy.ts` when missing and refreshes the
 * descriptive fields of existing rows. Safe to run repeatedly.
 */
export async function seedTaxonomy(): Promise<{ categories: number; subcategories: number }> {
  let categoryCount = 0;
  let subcategoryCount = 0;

  for (const [categoryIndex, category] of TAXONOMY_SEED.entries()) {
    const existing = await db
      .select({ id: issueCategories.id })
      .from(issueCategories)
      .where(eq(issueCategories.slug, category.slug))
      .limit(1);

    const values = {
      name: category.name,
      description: category.description,
      baselineIncidentCount: category.baselineIncidentCount,
      baselinePercentage: category.baselinePercentage,
      sortOrder: categoryIndex + 1,
      isActive: true,
    };

    const [row] = existing.length > 0
      ? await db
          .update(issueCategories)
          .set(values)
          .where(eq(issueCategories.slug, category.slug))
          .returning({ id: issueCategories.id })
      : await db.insert(issueCategories).values({ slug: category.slug, ...values }).returning({ id: issueCategories.id });

    if (!row) throw AppError.internal(`Failed to seed taxonomy category ${category.slug}`);
    categoryCount += 1;

    for (const [subIndex, sub] of category.subcategories.entries()) {
      const subValues = {
        categoryId: row.id,
        name: sub.name,
        description: sub.description,
        priorityLevel: sub.priorityLevel,
        operationalImpact: sub.operationalImpact,
        baselineIncidentCount: sub.baselineIncidentCount,
        baselinePercentage: sub.baselinePercentage,
        sortOrder: subIndex + 1,
        isActive: true,
      };

      const existingSub = await db
        .select({ id: issueSubcategories.id })
        .from(issueSubcategories)
        .where(eq(issueSubcategories.slug, sub.slug))
        .limit(1);

      if (existingSub.length > 0) {
        await db.update(issueSubcategories).set(subValues).where(eq(issueSubcategories.slug, sub.slug));
      } else {
        await db.insert(issueSubcategories).values({ slug: sub.slug, ...subValues });
      }
      subcategoryCount += 1;
    }
  }

  return { categories: categoryCount, subcategories: subcategoryCount };
}

/** Sub-categories that have never been used, for onboarding checks. */
export async function countUncategorizedSessions(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(troubleshootingSessions)
    .where(
      and(
        eq(troubleshootingSessions.resolutionStatus, 'resolved'),
        sql`not exists (select 1 from ${issueCategorizations} where ${issueCategorizations.sessionId} = ${troubleshootingSessions.id})`,
      ),
    );
  return rows[0]?.count ?? 0;
}

/** Resolved sessions in the report window, used by the dashboard header. */
export async function countResolvedSessionsInRange(from: Date, to: Date): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(troubleshootingSessions)
    .where(
      and(
        inArray(troubleshootingSessions.resolutionStatus, ['resolved', 'escalated']),
        gte(troubleshootingSessions.createdAt, from),
        lte(troubleshootingSessions.createdAt, to),
      ),
    );
  return rows[0]?.count ?? 0;
}
