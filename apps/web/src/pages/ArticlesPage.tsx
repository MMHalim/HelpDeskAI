import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { ArticleDto, Paginated } from '@helpdesk/shared';
import { ARTICLE_PRIORITIES } from '@helpdesk/shared';
import { api, buildQuery } from '../lib/api';
import { Badge, Button, Card, EmptyState, Input, Pagination, Select, Spinner } from '../components/ui';
import { useAuth } from '../auth';
import { cn, formatDate, humanize } from '../lib/utils';

const PRIORITY_STYLES: Record<string, string> = {
  low: 'border-slate-500/30 bg-slate-500/15 text-slate-300',
  normal: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  high: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  critical: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
};

export function ArticlesPage() {
  const { can } = useAuth();
  const canManage = can('articles.manage');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['article-categories'],
    queryFn: () => api.get<{ categories: Array<{ category: string; count: number }> }>('/api/articles/categories'),
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['articles', page, query, category, priority],
    queryFn: () =>
      api.get<Paginated<ArticleDto>>(
        `/api/articles${buildQuery({ page, pageSize: 20, q: query || undefined, category: category || undefined, priority: priority || undefined, sort: 'updated' })}`,
      ),
  });

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Knowledge Base</h1>
          <p className="text-sm text-slate-400">Reference articles the AI can retrieve during troubleshooting</p>
        </div>
        {canManage ? (
          <Link to="/articles/new">
            <Button>
              <Plus className="h-4 w-4" /> New article
            </Button>
          </Link>
        ) : null}
      </div>

      <form onSubmit={submitSearch} className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search articles" className="w-64 pl-9" />
        </div>
        <Select
          value={category}
          onChange={(event) => {
            setPage(1);
            setCategory(event.target.value);
          }}
          className="w-44"
        >
          <option value="">All categories</option>
          {(categoriesData?.categories ?? []).map((entry) => (
            <option key={entry.category} value={entry.category}>
              {entry.category} ({entry.count})
            </option>
          ))}
        </Select>
        <Select
          value={priority}
          onChange={(event) => {
            setPage(1);
            setPriority(event.target.value);
          }}
          className="w-36"
        >
          <option value="">All priorities</option>
          {ARTICLE_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : isError ? (
          <EmptyState title="Unable to load articles" description={(error as Error)?.message} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No articles found"
            description={canManage ? 'Create your first article to seed the knowledge base.' : undefined}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Title</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Priority</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {data.items.map((article) => (
                    <tr key={article.id} className="transition hover:bg-slate-800/40">
                      <td className="px-5 py-3">
                        <Link to={`/articles/${article.id}`} className="font-medium text-slate-200 hover:text-indigo-300">
                          {article.title}
                        </Link>
                        <p className="max-w-md truncate text-xs text-slate-500">{article.issueDescription || '—'}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-400">{article.category}</td>
                      <td className="px-5 py-3">
                        <Badge className={cn(PRIORITY_STYLES[article.priority] ?? PRIORITY_STYLES.normal)}>
                          {article.priority}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        <span className={article.isActive ? 'text-emerald-400' : 'text-slate-500'}>
                          {article.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-400">{formatDate(article.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
