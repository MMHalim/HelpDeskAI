import { useQuery } from '@tanstack/react-query';
import { BarChart3, Layers, TrendingUp } from 'lucide-react';
import type { IssueReportDto } from '@helpdesk/shared';
import { api } from '../lib/api';
import { Badge, Card, CardHeader, EmptyState, Spinner, StatCard } from '../components/ui';
import { cn, formatNumber, humanize } from '../lib/utils';

function priorityBadge(priority: string): string {
  switch (priority) {
    case 'critical':
      return 'border-rose-500/30 bg-rose-500/15 text-rose-300';
    case 'high':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-300';
    case 'medium':
      return 'border-sky-500/30 bg-sky-500/15 text-sky-300';
    default:
      return 'border-slate-600/40 bg-slate-700/30 text-slate-300';
  }
}

/** Share of the bar for a row, capped so a single row never fills the card. */
function width(percentage: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.max(2, Math.round((percentage / max) * 100))}%`;
}

export function IssueReportPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['issue-report'],
    queryFn: () => api.get<IssueReportDto>('/api/categorization/report'),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <Spinner />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        title="Could not load the issue report"
        description={error instanceof Error ? error.message : 'Unexpected error'}
      />
    );
  }

  const maxBySubcategory = Math.max(...data.bySubcategory.map((row) => row.percentage), 0);
  const top = data.bySubcategory[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Issue Categories</h1>
        <p className="mt-1 text-sm text-slate-400">
          Resolved issues filed by category and sub-category, so you can see which issues arrive most often.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Categorized issues" value={formatNumber(data.totalCategorized)} icon={<Layers className="h-4 w-4" />} />
        <StatCard
          label="Most received"
          value={top ? top.subcategoryName : '—'}
          hint={top ? `${formatNumber(top.count)} issues · ${top.percentage}%` : 'No data yet'}
          icon={<TrendingUp className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Sub-categories tracked"
          value={formatNumber(data.bySubcategory.length)}
          hint="Categories in the incident taxonomy"
          icon={<BarChart3 className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader title="Most received issues" description="Ordered by volume" />
        {data.bySubcategory.length === 0 ? (
          <div className="px-5 py-4">
            <p className="text-sm text-slate-400">
              No resolved issue has been categorized yet. The AI files each issue under a sub-category as soon as
              the agent confirms the fix.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-[var(--color-line)]">
                  <th className="px-5 py-2 font-medium">Sub-category</th>
                  <th className="px-5 py-2 font-medium">Category</th>
                  <th className="px-5 py-2 font-medium">Priority</th>
                  <th className="px-5 py-2 text-right font-medium">Issues</th>
                  <th className="px-5 py-2 text-right font-medium">Share</th>
                  <th className="px-5 py-2 text-right font-medium">Baseline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.bySubcategory.map((row) => (
                  <tr key={row.subcategoryId}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-slate-200">{row.subcategoryName}</div>
                      <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            row.priorityLevel === 'critical' ? 'bg-rose-500/70' : 'bg-sky-500/70',
                          )}
                          style={{ width: width(row.percentage, maxBySubcategory) }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-400">{row.categoryName}</td>
                    <td className="px-5 py-3">
                      <Badge className={cn(priorityBadge(row.priorityLevel))}>
                        {humanize(row.priorityLevel)}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-slate-100">
                      {formatNumber(row.count)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-300">{row.percentage}%</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">
                      {row.baselineCount > 0 ? `${row.baselineCount} · ${row.baselinePercentage}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="By category" />
        {data.byCategory.length === 0 ? (
          <div className="px-5 py-4 text-sm text-slate-400">No data yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr className="border-b border-[var(--color-line)]">
                  <th className="px-5 py-2 font-medium">Category</th>
                  <th className="px-5 py-2 text-right font-medium">Issues</th>
                  <th className="px-5 py-2 text-right font-medium">Share</th>
                  <th className="px-5 py-2 text-right font-medium">Historical baseline</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.byCategory.map((row) => (
                  <tr key={row.categoryId}>
                    <td className="px-5 py-3 font-medium text-slate-200">{row.categoryName}</td>
                    <td className="px-5 py-3 text-right text-slate-100">{formatNumber(row.count)}</td>
                    <td className="px-5 py-3 text-right text-slate-300">{row.percentage}%</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">
                      {row.baselineCount > 0
                        ? `${formatNumber(row.baselineCount)} · ${row.baselinePercentage}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-slate-500">
        The baseline columns are the historical 55-incident analysis and are read-only; new categorizations never
        change them.
      </p>
    </div>
  );
}
