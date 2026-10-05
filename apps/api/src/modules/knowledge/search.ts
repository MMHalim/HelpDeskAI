/**
 * Knowledge-base retrieval (§17).
 *
 * Stage 1 is keyword + PostgreSQL full-text retrieval with a trigram fallback;
 * the scoring and the returned shape are intentionally provider-agnostic so a
 * vector/embedding stage can be inserted later without touching callers.
 */
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { STOP_WORDS } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { troubleshootingArticles, type Article } from '../../db/schema.js';

const MAX_KEYWORDS = 25;

export function extractKeywords(input: string): string[] {
  const tokens = input
    .toLowerCase()
    .replace(/[^a-z0-9\s.+#'-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && token.length < 40 && !STOP_WORDS.has(token));

  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, MAX_KEYWORDS)
    .map(([token]) => token);
}

export interface RetrievalQuery {
  /** Free text from the agent (message + thread + screenshot analysis). */
  text: string;
  /** Keywords produced by the classifier. */
  keywords?: string[];
  category?: string | null;
  limit?: number;
  /** Include inactive articles (admin tooling only). */
  includeInactive?: boolean;
}

export interface RetrievalResult {
  articles: Array<Article & { searchScore: number; matchedTerms: string[] }>;
  terms: string[];
  usedVectorSearch: boolean;
}

function priorityBoost(priority: Article['priority']): number {
  switch (priority) {
    case 'critical':
      return 0.35;
    case 'high':
      return 0.2;
    case 'normal':
      return 0.05;
    default:
      return 0;
  }
}

/** Ranking bonus when the article's category matches the classified one. */
const CATEGORY_MATCH_BOOST = 0.25;

/**
 * Scores articles with `ts_rank` on the weighted search vector, then blends in
 * exact keyword/tag matches and the article priority.
 */
export async function retrieveArticles(query: RetrievalQuery): Promise<RetrievalResult> {
  const limit = query.limit ?? 5;
  const terms = [...new Set([...extractKeywords(query.text), ...(query.keywords ?? [])])].slice(
    0,
    MAX_KEYWORDS,
  );

  const conditions: SQL[] = [];
  if (!query.includeInactive) conditions.push(eq(troubleshootingArticles.isActive, true));

  if (terms.length === 0) {
    const rows = await db
      .select()
      .from(troubleshootingArticles)
      .where(
        and(
          ...conditions,
          // With no keywords at all, fall back to the most relevant categories.
          or(
            ...(['VPN', 'Network', 'Accounts & Access', 'Software'] as const).map((category) =>
              eq(troubleshootingArticles.category, category),
            ),
          ),
        ),
      )
      .orderBy(desc(troubleshootingArticles.priority), desc(troubleshootingArticles.updatedAt))
      .limit(limit);
    return {
      articles: rows.map((article) => ({ ...article, searchScore: 0.1, matchedTerms: [] })),
      terms,
      usedVectorSearch: false,
    };
  }

  const tsQuery = terms.map((term) => term.replace(/[']/g, '')).join(' | ');
  const termArray = terms;

  const rows = await db
    .select({
      article: troubleshootingArticles,
      rank: sql<number>`ts_rank(${troubleshootingArticles.searchVector}, websearch_to_tsquery('english', ${tsQuery}))`,
      keywordHits: sql<number>`(
        SELECT count(*)::int FROM unnest(${troubleshootingArticles.keywords}) k
        WHERE lower(k) = ANY(${sql.param(termArray)}::text[])
      )`,
      tagHits: sql<number>`(
        SELECT count(*)::int FROM unnest(${troubleshootingArticles.tags}) t
        WHERE lower(t) = ANY(${sql.param(termArray)}::text[])
      )`,
      symptomHits: sql<number>`(
        SELECT count(*)::int FROM unnest(${troubleshootingArticles.symptoms}) s
        WHERE lower(s) ILIKE ANY(${sql.param(termArray.map((term) => `%${term}%`))}::text[])
      )`,
    })
    .from(troubleshootingArticles)
    .where(
      and(
        ...conditions,
        or(
          sql`${troubleshootingArticles.searchVector} @@ websearch_to_tsquery('english', ${tsQuery})`,
          sql`${troubleshootingArticles.title} ILIKE ANY(${sql.param(termArray.map((t) => `%${t}%`))}::text[])`,
          sql`${troubleshootingArticles.issueDescription} ILIKE ANY(${sql.param(termArray.map((t) => `%${t}%`))}::text[])`,
          sql`${troubleshootingArticles.keywords} && ${sql.param(termArray)}::text[]`,
        ),
      ),
    )
    .orderBy(desc(sql`ts_rank(${troubleshootingArticles.searchVector}, websearch_to_tsquery('english', ${tsQuery}))`))
    .limit(limit * 3);

  const scored = rows
    .map((row) => {
      const matchedTerms = terms.filter((term) => {
        const needle = term.toLowerCase();
        return (
          row.article.title.toLowerCase().includes(needle) ||
          row.article.keywords.some((k) => k.toLowerCase() === needle) ||
          row.article.tags.some((t) => t.toLowerCase() === needle) ||
          row.article.symptoms.some((s) => s.toLowerCase().includes(needle)) ||
          row.article.issueDescription.toLowerCase().includes(needle)
        );
      });
      const score =
        row.rank * 2 +
        row.keywordHits * 0.6 +
        row.tagHits * 0.4 +
        Math.min(row.symptomHits, 4) * 0.2 +
        priorityBoost(row.article.priority) +
        // A category match only ranks an article higher: it must never exclude
        // it, because the classifier often files an issue under a neighbouring
        // category ("Software" vs "Network") while the text matches exactly.
        (query.category && row.article.category === query.category ? CATEGORY_MATCH_BOOST : 0);
      return { ...row.article, searchScore: Number(score.toFixed(4)), matchedTerms };
    })
    .filter((article) => article.searchScore > 0.05)
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, limit);

  return { articles: scored, terms, usedVectorSearch: false };
}

/** Admin search: paginated list with optional free-text filter. */
export async function searchArticlesForAdmin(input: {
  q?: string;
  category?: string;
  priority?: string;
  isActive?: boolean;
  page: number;
  pageSize: number;
  sort: string;
}): Promise<{ items: Array<Article & { searchScore: number; matchedTerms: string[] }>; total: number }> {
  const conditions: SQL[] = [];
  if (input.q) {
    const like = `%${input.q}%`;
    conditions.push(
      or(
        ilike(troubleshootingArticles.title, like),
        ilike(troubleshootingArticles.issueDescription, like),
        ilike(troubleshootingArticles.troubleshootingSteps, like),
        sql`${troubleshootingArticles.keywords} && ${sql.param(extractKeywords(input.q))}::text[]`,
      )!,
    );
  }
  if (input.category) conditions.push(eq(troubleshootingArticles.category, input.category));
  if (input.priority) conditions.push(eq(troubleshootingArticles.priority, input.priority as never));
  if (input.isActive !== undefined) conditions.push(eq(troubleshootingArticles.isActive, input.isActive));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderBy = (() => {
    switch (input.sort) {
      case 'title':
        return troubleshootingArticles.title;
      case 'created':
        return troubleshootingArticles.createdAt;
      case 'priority':
        return troubleshootingArticles.priority;
      case 'updated':
      default:
        return troubleshootingArticles.updatedAt;
    }
  })();

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(troubleshootingArticles)
      .where(where)
      .orderBy(orderBy)
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(troubleshootingArticles).where(where),
  ]);

  return {
    items: rows.map((article) => ({ ...article, searchScore: 0, matchedTerms: [] })),
    total: countRows[0]?.count ?? 0,
  };
}

export async function listCategories(): Promise<Array<{ category: string; count: number }>> {
  const rows = await db
    .select({
      category: troubleshootingArticles.category,
      count: sql<number>`count(*)::int`,
    })
    .from(troubleshootingArticles)
    .groupBy(troubleshootingArticles.category)
    .orderBy(sql`count(*) desc`);
  return rows;
}
