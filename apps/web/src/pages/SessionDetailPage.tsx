import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  Bot,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  StickyNote,
  Tag,
  User,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { SessionDetailDto, SessionStatus } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { Badge, Button, Card, CardHeader, EmptyState, Modal, Spinner, Textarea } from '../components/ui';
import { StatusChangeModal } from '../components/StatusChangeModal';
import { CategorizationEditor } from '../components/CategorizationEditor';
import { useAuth } from '../auth';
import {
  cn,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatNumber,
  humanize,
  relativeTime,
  resolutionStatusClass,
  sessionStatusClass,
} from '../lib/utils';

interface ActionBody {
  action: string;
  note?: string;
  articleId?: string;
  status?: SessionStatus;
}

export function SessionDetailPage() {
  const { id = '' } = useParams();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.get<{ session: SessionDetailDto }>(`/api/sessions/${id}`),
    enabled: Boolean(id),
  });

  const actionMutation = useMutation({
    mutationFn: (body: ActionBody) => api.post(`/api/sessions/${id}/actions`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['session', id] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setNote('');
      setNoteOpen(false);
      setActionError(null);
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Action failed'),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState title="Session not found" description={(error as Error)?.message} />;
  }

  const session = data.session;
  const run = (action: string, extra?: Partial<ActionBody>) =>
    actionMutation.mutate({ action, ...extra });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/sessions" className="text-xs text-indigo-400 hover:text-indigo-300">
            ← Back to sessions
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold text-slate-100">{session.issueTitle}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="font-mono">{session.sessionCode}</span>
            <Badge className={cn(sessionStatusClass(session.status))}>{humanize(session.status)}</Badge>
            <Badge className={cn(resolutionStatusClass(session.resolutionStatus))}>
              {humanize(session.resolutionStatus)}
            </Badge>
            {session.adminPaused ? <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-300">Paused</Badge> : null}
            {session.permalink ? (
              <a
                href={session.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                Open in Slack <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>

        {isAdmin ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setStatusOpen(true)}>
              <Tag className="h-3.5 w-3.5" /> Change status
            </Button>
            {session.adminPaused ? (
              <Button size="sm" variant="secondary" onClick={() => run('set_status', { status: 'in_progress' })} loading={actionMutation.isPending}>
                <Play className="h-3.5 w-3.5" /> Resume
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => run('set_status', { status: 'paused' })} loading={actionMutation.isPending}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => run('set_status', { status: 'resolved' })} loading={actionMutation.isPending}>
              <Sparkles className="h-3.5 w-3.5" /> Resolve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run('set_status', { status: 'escalated' })} loading={actionMutation.isPending}>
              <ShieldAlert className="h-3.5 w-3.5" /> Escalate
            </Button>
            <Button size="sm" variant="secondary" onClick={() => run('set_status', { status: 'in_progress' })} loading={actionMutation.isPending}>
              <RotateCcw className="h-3.5 w-3.5" /> Reopen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNoteOpen(true)}>
              <StickyNote className="h-3.5 w-3.5" /> Note
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run('set_status', { status: 'closed' })} loading={actionMutation.isPending}>
              <XCircle className="h-3.5 w-3.5" /> Close
            </Button>
          </div>
        ) : null}
      </div>

      {actionError ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Issue" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <p className="whitespace-pre-wrap text-slate-300">{session.originalMessage || session.issueSummary || '—'}</p>
              {session.diagnosis ? (
                <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <Wrench className="h-3 w-3" /> Diagnosis
                  </p>
                  <p className="whitespace-pre-wrap text-slate-300">{session.diagnosis}</p>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" description={`${session.timeline.length} entries`} />
            {session.timeline.length === 0 ? (
              <EmptyState title="No timeline entries yet" />
            ) : (
              <ol className="relative space-y-1 px-5 py-4">
                {session.timeline.map((entry) => (
                  <li key={entry.id} className="relative border-l border-[var(--color-line)] pb-4 pl-5 last:pb-0">
                    <span
                      className={cn(
                        'absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full',
                        entry.role === 'bot'
                          ? 'bg-indigo-500'
                          : entry.role === 'agent'
                            ? 'bg-sky-500'
                            : entry.role === 'admin'
                              ? 'bg-amber-500'
                              : 'bg-slate-500',
                      )}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-200">{entry.summary || humanize(entry.kind)}</p>
                      <span className="shrink-0 text-xs text-slate-500">{relativeTime(entry.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-600">
                      {entry.role} · {humanize(entry.kind)}
                      {entry.model ? ` · ${entry.model}` : ''}
                    </p>
                    {entry.content ? (
                      <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-xs text-slate-400">{entry.content}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-[var(--color-line)] text-sm">
              <Row label="Agent" value={session.agentDisplayName ?? session.agentName ?? '—'} icon={<User className="h-3 w-3" />} />
              <Row label="Channel" value={session.channelName ?? session.channelId} />
              <Row label="Provider" value={session.aiProvider ? `${session.aiProvider} · ${session.aiModel ?? ''}` : '—'} icon={<Bot className="h-3 w-3" />} />
              <Row label="Attempts" value={String(session.attemptCount)} />
              <Row label="First response" value={formatDateTime(session.firstResponseAt)} />
              <Row label="Resolved" value={formatDateTime(session.resolvedAt)} />
              <Row label="Escalated" value={formatDateTime(session.escalatedAt)} />
              <Row label="Duration" value={formatDuration(session.durationSeconds)} />
              <Row label="Tokens" value={`${formatNumber(session.totalTokens)} (${formatNumber(session.totalInputTokens)} in / ${formatNumber(session.totalOutputTokens)} out)`} />
              <Row label="Cost" value={formatCurrency(session.estimatedCost)} />
            </dl>
          </Card>

          {session.categorization ? (
            <Card>
              <CardHeader
                title="Issue category"
                description="Used for reporting on the most received issues"
                actions={
                  <Badge
                    className={cn(
                      session.categorization.priorityLevel === 'critical'
                        ? 'border-rose-500/30 bg-rose-500/15 text-rose-300'
                        : session.categorization.priorityLevel === 'high'
                          ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                          : 'border-slate-600/40 bg-slate-700/30 text-slate-300',
                    )}
                  >
                    {humanize(session.categorization.priorityLevel)} impact
                  </Badge>
                }
              />
              <div className="space-y-3 px-5 py-4 text-sm">
                <p className="text-slate-200">
                  {session.categorization.categoryName}
                  <span className="mx-2 text-slate-600">&rsaquo;</span>
                  <span className="font-medium">{session.categorization.subcategoryName}</span>
                </p>
                {session.categorization.operationalImpact ? (
                  <p className="text-xs text-slate-400">{session.categorization.operationalImpact}</p>
                ) : null}
                {session.categorization.rationale ? (
                  <p className="text-xs text-slate-400">{session.categorization.rationale}</p>
                ) : null}
                <p className="text-xs text-slate-500">
                  {session.categorization.source === 'manual' ? 'Set by' : 'Categorized by AI'} ·{' '}
                  {Math.round(session.categorization.confidence * 100)}% confidence ·{' '}
                  {formatDateTime(session.categorization.categorizedAt)}
                </p>

                {isAdmin ? (
                  <CategorizationEditor sessionId={id} currentSubcategoryId={session.categorization.subcategoryId} />
                ) : null}
              </div>
            </Card>
          ) : session.resolutionStatus === 'resolved' ? (
            <Card>
              <CardHeader title="Issue category" description="Used for reporting on the most received issues" />
              <div className="space-y-3 px-5 py-4 text-sm">
                <p className="text-slate-400">
                  This issue was resolved without being categorized, so it is missing from the reports.
                </p>
                {isAdmin ? <CategorizationEditor sessionId={id} currentSubcategoryId="" /> : null}
              </div>
            </Card>
          ) : null}

          {session.escalation ? (
            <Card>
              <CardHeader title="Escalation" actions={<Badge className="border-rose-500/30 bg-rose-500/15 text-rose-300">{humanize(session.escalation.status)}</Badge>} />
              <div className="space-y-3 px-5 py-4 text-sm">
                <p className="whitespace-pre-wrap text-slate-300">{session.escalation.reason || '—'}</p>
                {session.escalation.requiredInfo.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Required info</p>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-400">
                      {session.escalation.requiredInfo.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="text-xs text-slate-500">
                  By {session.escalation.escalatedBy} · {formatDateTime(session.escalation.createdAt)}
                </p>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Knowledge base" description={`${session.articlesUsed.length} articles used`} />
            {session.articlesUsed.length === 0 ? (
              <EmptyState title="No KB articles linked" />
            ) : (
              <ul className="divide-y divide-[var(--color-line)] text-sm">
                {session.articlesUsed.map((article) => (
                  <li key={article.id} className="px-5 py-3">
                    <Link to={`/articles/${article.id}`} className="font-medium text-indigo-400 hover:text-indigo-300">
                      {article.title}
                    </Link>
                    <p className="text-xs text-slate-500">{article.category}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Admin notes" />
            {session.adminNotes.length === 0 ? (
              <EmptyState title="No notes" />
            ) : (
              <ul className="divide-y divide-[var(--color-line)] text-sm">
                {session.adminNotes.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <p className="text-slate-300">{entry.note}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {entry.userName ?? 'Admin'} · {formatDateTime(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="AI requests" description={`${session.aiRequests.length} calls`} />
            {session.aiRequests.length === 0 ? (
              <EmptyState title="No AI requests recorded" />
            ) : (
              <ul className="max-h-80 divide-y divide-[var(--color-line)] overflow-y-auto text-xs">
                {session.aiRequests.map((request) => (
                  <li key={request.id} className="px-5 py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-medium capitalize text-slate-300">
                        {request.provider} · {request.operation}
                      </span>
                      <span className={request.success ? 'text-emerald-400' : 'text-rose-400'}>
                        {request.success ? 'ok' : 'failed'}
                      </span>
                    </div>
                    <p className="text-slate-500">
                      {formatNumber(request.totalTokens)} tokens · {formatCurrency(request.estimatedCost)} ·{' '}
                      {request.latencyMs != null ? `${request.latencyMs}ms` : '—'}
                      {request.isFallback ? ' · fallback' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add admin note"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={actionMutation.isPending}
              disabled={note.trim().length === 0}
              onClick={() => run('note', { note: note.trim() })}
            >
              Save note
            </Button>
          </>
        }
      >
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Context for other administrators…" />
      </Modal>

      <StatusChangeModal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        sessionId={session.id}
        currentStatus={session.status}
        sessionLabel={`${session.sessionCode} · ${session.issueTitle}`}
      />
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-2.5">
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </dt>
      <dd className="max-w-[60%] text-right text-slate-300">{value}</dd>
    </div>
  );
}
