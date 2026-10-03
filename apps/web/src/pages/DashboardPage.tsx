import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  MessageSquareWarning,
  ShieldAlert,
} from 'lucide-react';
import type { DashboardStats } from '@helpdesk/shared';
import { api } from '../lib/api';
import { Card, CardHeader, EmptyState, Select, Spinner, StatCard } from '../components/ui';
import {
  cn,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  relativeTime,
  sessionStatusClass,
  humanize,
} from '../lib/utils';
import { useState } from 'react';

const STATUS_COLORS: Record<string, string> = {
  in_progress: '#38bdf8',
  paused: '#f59e0b',
  resolved: '#34d399',
  escalated: '#fb7185',
  closed: '#94a3b8',
  abandoned: '#71717a',
};

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analytics', days],
    queryFn: () => api.get<{ stats: DashboardStats }>(`/api/analytics?days=${days}`),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState title="Unable to load analytics" description={(error as Error)?.message} />;
  }

  const stats = data.stats;
  const daily = stats.daily.map((point) => ({
    date: point.date.slice(5),
    sessions: point.sessions,
    resolved: point.resolved,
    escalated: point.escalated,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Dashboard</h1>
          <p className="text-sm text-slate-400">Troubleshooting activity and AI usage overview</p>
        </div>
        <Select value={days} onChange={(event) => setDays(Number(event.target.value))} className="w-40">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active sessions"
          value={formatNumber(stats.activeSessions)}
          hint={`${formatNumber(stats.issuesToday)} started today`}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Resolved"
          value={formatNumber(stats.resolvedSessions)}
          hint={`${formatPercent(stats.successRate)} success rate`}
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatCard
          label="Escalated"
          value={formatNumber(stats.escalatedSessions)}
          hint={`${formatNumber(stats.openEscalations)} open escalations`}
          tone="danger"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <StatCard
          label="Avg resolution"
          value={formatDuration(stats.averageResolutionSeconds)}
          hint={`${formatNumber(stats.issuesThisWeek)} issues this week`}
          icon={<Clock className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="AI requests" value={formatNumber(stats.aiRequests)} hint={`${formatNumber(stats.aiErrors)} errors`} icon={<Cpu className="h-4 w-4" />} />
        <StatCard label="Tokens used" value={formatNumber(stats.totalTokens)} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Estimated cost" value={formatCurrency(stats.estimatedCost)} icon={<DollarSign className="h-4 w-4" />} />
        <StatCard
          label="Escalation rate"
          value={formatPercent(stats.escalationRate)}
          tone="warning"
          icon={<MessageSquareWarning className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Session activity" description="Started, resolved and escalated per day" />
          <div className="h-72 p-4">
            {daily.length === 0 ? (
              <EmptyState title="No activity in this period" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2b45" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#111a2e', border: '1px solid #1e2b45', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#e2e8f0' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sessions" fill="#6366f1" radius={[4, 4, 0, 0]} name="Started" />
                  <Bar dataKey="resolved" fill="#34d399" radius={[4, 4, 0, 0]} name="Resolved" />
                  <Bar dataKey="escalated" fill="#fb7185" radius={[4, 4, 0, 0]} name="Escalated" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Status breakdown" />
          <div className="h-72 p-4">
            {stats.statusBreakdown.length === 0 ? (
              <EmptyState title="No sessions yet" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.statusBreakdown}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {stats.statusBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#111a2e', border: '1px solid #1e2b45', borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => humanize(String(value))} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent sessions"
            actions={
              <Link to="/sessions" className="text-xs font-medium text-indigo-400 hover:text-indigo-300">
                View all
              </Link>
            }
          />
          {stats.recentSessions.length === 0 ? (
            <EmptyState title="No sessions yet" description="Sessions appear once agents trigger the bot in Slack." />
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {stats.recentSessions.map((session) => (
                <Link
                  key={session.id}
                  to={`/sessions/${session.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-3 transition hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-200">{session.issueTitle}</p>
                    <p className="truncate text-xs text-slate-500">
                      {session.sessionCode} · {session.agentName ?? 'Unknown agent'} · {relativeTime(session.lastActivityAt)}
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', sessionStatusClass(session.status))}>
                    {humanize(session.status)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Provider usage" />
          {stats.providerUsage.length === 0 ? (
            <EmptyState title="No AI requests yet" />
          ) : (
            <div className="divide-y divide-[var(--color-line)]">
              {stats.providerUsage.map((usage) => (
                <div key={`${usage.provider}-${usage.model}`} className="px-5 py-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize text-slate-200">{usage.provider}</span>
                    <span className="text-xs text-slate-400">{formatCurrency(usage.estimatedCost)}</span>
                  </div>
                  <p className="truncate text-xs text-slate-500">{usage.model}</p>
                  <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
                    <span>{formatNumber(usage.requests)} req</span>
                    <span>{formatNumber(usage.tokens)} tokens</span>
                    <span className="text-rose-400/80">{formatNumber(usage.errors)} err</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
