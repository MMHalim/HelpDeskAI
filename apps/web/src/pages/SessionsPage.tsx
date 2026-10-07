import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Tag } from 'lucide-react';
import type { Paginated, SessionDto } from '@helpdesk/shared';
import { SESSION_STATUSES } from '@helpdesk/shared';
import { api, buildQuery } from '../lib/api';
import { Badge, Button, Card, EmptyState, Input, Pagination, Select, Spinner } from '../components/ui';
import { StatusChangeModal } from '../components/StatusChangeModal';
import { useAuth } from '../auth';
import { cn, humanize, relativeTime, sessionStatusClass } from '../lib/utils';

export function SessionsPage() {
  const { can } = useAuth();
  const canManage = can('sessions.manage');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [statusTarget, setStatusTarget] = useState<SessionDto | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sessions', page, status, query],
    queryFn: () =>
      api.get<Paginated<SessionDto>>(
        `/api/sessions${buildQuery({ page, pageSize: 20, status: status || undefined, q: query || undefined })}`,
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
          <h1 className="text-xl font-semibold text-slate-100">Sessions</h1>
          <p className="text-sm text-slate-400">Every troubleshooting thread handled by the agent</p>
        </div>
        <form onSubmit={submitSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search code, title, agent"
              className="w-64 pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            className="w-40"
          >
            <option value="">All statuses</option>
            {SESSION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>

      <Card>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : isError ? (
          <EmptyState title="Unable to load sessions" description={(error as Error)?.message} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState title="No sessions found" description="Adjust the filters or wait for a Slack trigger." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-medium">Session</th>
                    <th className="px-5 py-3 font-medium">Agent</th>
                    <th className="px-5 py-3 font-medium">Channel</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Attempts</th>
                    <th className="px-5 py-3 font-medium">1st response</th>
                    <th className="px-5 py-3 font-medium">Last activity</th>
                    {canManage ? <th className="px-5 py-3 text-right font-medium">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {data.items.map((session) => (
                    <tr key={session.id} className="transition hover:bg-slate-800/40">
                      <td className="px-5 py-3">
                        <Link to={`/sessions/${session.id}`} className="block min-w-0">
                          <span className="block truncate font-medium text-slate-200">{session.issueTitle}</span>
                          <span className="text-xs text-slate-500">{session.sessionCode}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-slate-300">{session.agentDisplayName ?? session.agentName ?? '—'}</td>
                      <td className="px-5 py-3 text-slate-400">{session.channelName ?? session.channelId}</td>
                      <td className="px-5 py-3">
                        <Badge className={cn(sessionStatusClass(session.status))}>{humanize(session.status)}</Badge>
                      </td>
                      <td className="px-5 py-3 text-slate-400">{session.attemptCount}</td>
                      <td className="px-5 py-3 text-slate-400">{relativeTime(session.firstResponseAt)}</td>
                      <td className="px-5 py-3 text-slate-400">{relativeTime(session.lastActivityAt)}</td>
                      {canManage ? (
                        <td className="px-5 py-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => setStatusTarget(session)}>
                            <Tag className="h-3.5 w-3.5" /> Status
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} totalPages={data.totalPages} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>

      <StatusChangeModal
        open={Boolean(statusTarget)}
        onClose={() => setStatusTarget(null)}
        sessionId={statusTarget?.id ?? ''}
        currentStatus={statusTarget?.status ?? 'in_progress'}
        sessionLabel={statusTarget ? `${statusTarget.sessionCode} · ${statusTarget.issueTitle}` : undefined}
      />
    </div>
  );
}
