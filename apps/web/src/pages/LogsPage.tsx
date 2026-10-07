import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import type { LogEntryDto, Paginated } from '@helpdesk/shared';
import { api, buildQuery } from '../lib/api';
import { Badge, Button, Card, EmptyState, Input, Pagination, Select, Spinner } from '../components/ui';
import { useAuth } from '../auth';
import { cn, formatDateTime, humanize } from '../lib/utils';

const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];

const LEVEL_STYLES: Record<string, string> = {
  debug: 'border-slate-500/30 bg-slate-500/15 text-slate-400',
  info: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  warn: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  error: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
  fatal: 'border-rose-600/40 bg-rose-600/20 text-rose-200',
};

export function LogsPage() {
  const { can } = useAuth();
  const canClear = can('logs.clear');
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['log-categories'],
    queryFn: () => api.get<{ categories: string[] }>('/api/analytics/logs/categories'),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['logs', page, level, category, query],
    queryFn: () =>
      api.get<Paginated<LogEntryDto>>(
        `/api/analytics/logs${buildQuery({ page, pageSize: 50, level: level || undefined, category: category || undefined, q: query || undefined })}`,
      ),
  });

  const purge = async () => {
    if (!window.confirm('Delete logs older than 30 days?')) return;
    await api.delete('/api/analytics/logs?days=30');
    void refetch();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Logs</h1>
          <p className="text-sm text-slate-400">Structured application and integration logs</p>
        </div>
        {canClear ? (
          <Button variant="secondary" size="sm" onClick={() => void purge()}>
            <Trash2 className="h-3.5 w-3.5" /> Purge &gt; 30 days
          </Button>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search message" className="w-64 pl-9" />
        </div>
        <Select
          value={level}
          onChange={(event) => {
            setPage(1);
            setLevel(event.target.value);
          }}
          className="w-32"
        >
          <option value="">All levels</option>
          {LEVELS.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
        <Select
          value={category}
          onChange={(event) => {
            setPage(1);
            setCategory(event.target.value);
          }}
          className="w-44"
        >
          <option value="">All categories</option>
          {(categoriesData?.categories ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <Card>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : isError ? (
          <EmptyState title="Unable to load logs" description={(error as Error)?.message} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No log entries" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Time</th>
                    <th className="px-5 py-3 font-medium">Level</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 font-medium">Message</th>
                    <th className="px-5 py-3 font-medium">Session</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {data.items.map((entry) => (
                    <tr key={entry.id} className="align-top">
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDateTime(entry.createdAt)}</td>
                      <td className="px-5 py-3">
                        <Badge className={cn(LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info)}>{entry.level}</Badge>
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-400">{entry.category}</td>
                      <td className="px-5 py-3">
                        <p className="text-slate-300">{entry.message}</p>
                        {entry.metadata ? (
                          <pre className="mt-1 max-w-2xl overflow-x-auto rounded bg-[var(--color-surface-muted)] p-2 text-[11px] text-slate-500">
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">{entry.sessionCode ?? '—'}</td>
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
