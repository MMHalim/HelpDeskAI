import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { EscalationDto, EscalationStatus, Paginated } from '@helpdesk/shared';
import { api, buildQuery } from '../lib/api';
import { Badge, Card, EmptyState, Pagination, Select, Spinner } from '../components/ui';
import { cn, formatDateTime, humanize, relativeTime } from '../lib/utils';

const ESCALATION_STATUSES: EscalationStatus[] = ['open', 'acknowledged', 'closed'];

const STATUS_STYLES: Record<EscalationStatus, string> = {
  open: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
  acknowledged: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  closed: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
};

export function EscalationsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['escalations', page, status],
    queryFn: () =>
      api.get<Paginated<EscalationDto>>(
        `/api/analytics/escalations${buildQuery({ page, pageSize: 20, status: status || undefined })}`,
      ),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Escalations</h1>
          <p className="text-sm text-slate-400">Issues handed off to a human administrator</p>
        </div>
        <Select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          className="w-44"
        >
          <option value="">All statuses</option>
          {ESCALATION_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : isError ? (
          <EmptyState title="Unable to load escalations" description={(error as Error)?.message} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No escalations" description="The agent is resolving everything on its own so far." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Issue</th>
                    <th className="px-5 py-3 font-medium">Agent</th>
                    <th className="px-5 py-3 font-medium">Channel</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Escalated by</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {data.items.map((escalation) => (
                    <tr key={escalation.id} className="transition hover:bg-slate-800/40">
                      <td className="px-5 py-3">
                        <Link to={`/sessions/${escalation.sessionId}`} className="block min-w-0">
                          <span className="block truncate font-medium text-slate-200">{escalation.issueTitle}</span>
                          <span className="text-xs text-slate-500">{escalation.sessionCode}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-300">{escalation.agentName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400">{escalation.channelName ?? escalation.channelId}</td>
                      <td className="px-5 py-3">
                        <Badge className={cn(STATUS_STYLES[escalation.status])}>{humanize(escalation.status)}</Badge>
                      </td>
                      <td className="px-5 py-3 capitalize text-slate-400">{escalation.escalatedBy}</td>
                      <td className="px-5 py-3 text-slate-400" title={formatDateTime(escalation.createdAt)}>
                        {relativeTime(escalation.createdAt)}
                      </td>
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
