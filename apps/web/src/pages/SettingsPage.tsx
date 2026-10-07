import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { SystemSettingsDto } from '@helpdesk/shared';

interface SlackUserOption {
  id: string;
  handle: string;
  name: string;
}
import { api, ApiError } from '../lib/api';
import { Badge, Button, Card, CardHeader, Field, Input, Spinner, Textarea, Toggle } from '../components/ui';
import { useAuth } from '../auth';
import { cn, humanize } from '../lib/utils';

interface ChannelDraft {
  channelId: string;
  name: string;
  isActive: boolean;
}

interface SlackDraft {
  botToken: string;
  signingSecret: string;
  appToken: string;
  triggerEmoji: string;
  enableMentions: boolean;
  verifySignature: boolean;
  threadOnly: boolean;
  redactSecrets: boolean;
  allowedUserIds: string;
  channels: ChannelDraft[];
}

interface TroubleshootingDraft {
  maxAttempts: number;
  escalationInfoItems: string;
  sessionStaleAfterHours: number;
  maxScreenshotsPerMessage: number;
  maxAttachmentBytes: number;
  kbMaxArticles: number;
  kbMaxSteps: number;
  escalationContact: string;
  escalationNotifyUserIds: string;
  itTechnicianUserId: string;
  escalationCcGroup: string;
  escalationSlaHours: number;
}

type Tab = 'slack' | 'troubleshooting' | 'environment';

export function SettingsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('slack');
  const [slack, setSlack] = useState<SlackDraft | null>(null);
  const [troubleshooting, setTroubleshooting] = useState<TroubleshootingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: SystemSettingsDto }>('/api/settings'),
  });

  const { data: slackUsers } = useQuery({
    queryKey: ['slack-users'],
    queryFn: () => api.get<{ users: SlackUserOption[] }>('/api/slack/users'),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!data?.settings) return;
    const settings = data.settings;
    setSlack({
      botToken: '',
      signingSecret: '',
      appToken: '',
      triggerEmoji: settings.slack.triggerEmoji,
      enableMentions: settings.slack.enableMentions,
      verifySignature: settings.slack.verifySignature,
      threadOnly: settings.slack.threadOnly,
      redactSecrets: settings.slack.redactSecrets,
      allowedUserIds: settings.slack.allowedUserIds.join(', '),
      channels: settings.slack.channels.map((channel) => ({
        channelId: channel.channelId,
        name: channel.name,
        isActive: channel.isActive,
      })),
    });
    setTroubleshooting({
      maxAttempts: settings.troubleshooting.maxAttempts,
      escalationInfoItems: settings.troubleshooting.escalationInfoItems.join('\n'),
      sessionStaleAfterHours: settings.troubleshooting.sessionStaleAfterHours,
      maxScreenshotsPerMessage: settings.troubleshooting.maxScreenshotsPerMessage,
      maxAttachmentBytes: settings.troubleshooting.maxAttachmentBytes,
      kbMaxArticles: settings.troubleshooting.kbMaxArticles,
      kbMaxSteps: settings.troubleshooting.kbMaxSteps,
      escalationContact: settings.troubleshooting.escalationContact ?? '',
      escalationNotifyUserIds: settings.troubleshooting.escalationNotifyUserIds.join(', '),
      itTechnicianUserId: settings.troubleshooting.itTechnicianUserId ?? '',
      escalationCcGroup: settings.troubleshooting.escalationCcGroup ?? '',
      escalationSlaHours: settings.troubleshooting.escalationSlaHours ?? 24,
    });
  }, [data]);

  const slackMutation = useMutation({
    mutationFn: () =>
      api.put('/api/settings/slack', {
        botToken: slack?.botToken || undefined,
        signingSecret: slack?.signingSecret || undefined,
        appToken: slack?.appToken || undefined,
        triggerEmoji: slack?.triggerEmoji,
        enableMentions: slack?.enableMentions,
        verifySignature: slack?.verifySignature,
        threadOnly: slack?.threadOnly,
        redactSecrets: slack?.redactSecrets,
        allowedUserIds: split(slack?.allowedUserIds ?? ''),
        channels: (slack?.channels ?? [])
          .filter((channel) => channel.channelId.trim())
          .map((channel) => ({ channelId: channel.channelId.trim(), name: channel.name, isActive: channel.isActive })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to save Slack settings'),
  });

  const troubleshootingMutation = useMutation({
    mutationFn: () =>
      api.put('/api/settings/troubleshooting', {
        maxAttempts: troubleshooting?.maxAttempts,
        escalationInfoItems: splitLines(troubleshooting?.escalationInfoItems ?? ''),
        sessionStaleAfterHours: troubleshooting?.sessionStaleAfterHours,
        maxScreenshotsPerMessage: troubleshooting?.maxScreenshotsPerMessage,
        maxAttachmentBytes: troubleshooting?.maxAttachmentBytes,
        kbMaxArticles: troubleshooting?.kbMaxArticles,
        kbMaxSteps: troubleshooting?.kbMaxSteps,
        escalationContact: troubleshooting?.escalationContact || undefined,
        escalationNotifyUserIds: split(troubleshooting?.escalationNotifyUserIds ?? ''),
        itTechnicianUserId: troubleshooting?.itTechnicianUserId || null,
        escalationCcGroup: troubleshooting?.escalationCcGroup || null,
        escalationSlaHours: Number(troubleshooting?.escalationSlaHours ?? 24),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to save troubleshooting settings'),
  });

  const memberList = slackUsers?.users ?? [];
  const techValue = troubleshooting?.itTechnicianUserId.trim() ?? '';
  const techMatches = memberList.some(
    (user) =>
      user.id.toLowerCase() === techValue.toLowerCase() ||
      user.handle.toLowerCase() === techValue.toLowerCase() ||
      user.name.toLowerCase() === techValue.replace(/^@/, '').toLowerCase(),
  );
  const techLooksLikeChannelId = /^D[A-Z0-9]{8,}$/i.test(techValue);
  const techUnresolved =
    Boolean(techValue) && memberList.length > 0 && !techMatches && !/^U[W]?[A-Z0-9]{8,}$/i.test(techValue);

  if (isLoading || !data || !slack || !troubleshooting) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const updateSlack = (patch: Partial<SlackDraft>) => setSlack((current) => (current ? { ...current, ...patch } : current));
  const updateTroubleshooting = (patch: Partial<TroubleshootingDraft>) =>
    setTroubleshooting((current) => (current ? { ...current, ...patch } : current));

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'slack', label: 'Slack' },
    { id: 'troubleshooting', label: 'Troubleshooting' },
    { id: 'environment', label: 'Environment' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
          <p className="text-sm text-slate-400">Integration, engine and environment configuration</p>
        </div>
        {saved ? <span className="text-xs text-emerald-400">Saved</span> : null}
      </div>

      <div className="flex gap-1 border-b border-[var(--color-line)]">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm transition',
              tab === entry.id
                ? 'border-indigo-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      ) : null}

      {tab === 'slack' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Credentials"
              description={data.settings.slack.connected ? 'Connected' : 'Bot token and signing secret required'}
              actions={
                <Badge
                  className={
                    data.settings.slack.connected
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                  }
                >
                  {data.settings.slack.connected ? 'configured' : 'incomplete'}
                </Badge>
              }
            />
            <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-3">
              <Field label="Bot token" hint={data.settings.slack.botTokenPreview ?? 'Not set'}>
                <Input
                  type="password"
                  placeholder="xoxb-…"
                  value={slack.botToken}
                  onChange={(event) => updateSlack({ botToken: event.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Signing secret" hint={data.settings.slack.signingSecretPreview ?? 'Not set'}>
                <Input
                  type="password"
                  placeholder="…"
                  value={slack.signingSecret}
                  onChange={(event) => updateSlack({ signingSecret: event.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="App token" hint={data.settings.slack.appTokenPreview ?? 'Not set'}>
                <Input
                  type="password"
                  placeholder="xapp-…"
                  value={slack.appToken}
                  onChange={(event) => updateSlack({ appToken: event.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Behaviour" />
            <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
              <Field label="Trigger emoji">
                <Input value={slack.triggerEmoji} onChange={(event) => updateSlack({ triggerEmoji: event.target.value })} disabled={!isAdmin} />
              </Field>
              <Field label="Allowed user IDs (comma separated, empty = everyone)">
                <Input
                  value={slack.allowedUserIds}
                  onChange={(event) => updateSlack({ allowedUserIds: event.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
              <div className="flex flex-col gap-3 md:col-span-2">
                <Toggle checked={slack.enableMentions} onChange={(next) => updateSlack({ enableMentions: next })} label="Enable @mention triggers" />
                <Toggle checked={slack.verifySignature} onChange={(next) => updateSlack({ verifySignature: next })} label="Verify request signatures" />
                <Toggle checked={slack.threadOnly} onChange={(next) => updateSlack({ threadOnly: next })} label="Reply in threads only" />
                <Toggle checked={slack.redactSecrets} onChange={(next) => updateSlack({ redactSecrets: next })} label="Redact secrets from messages" />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Monitored channels"
              description="Only these channels are handled by the bot"
              actions={
                isAdmin ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => updateSlack({ channels: [...slack.channels, { channelId: '', name: '', isActive: true }] })}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                ) : null
              }
            />
            <div className="space-y-2 px-5 py-4">
              {slack.channels.length === 0 ? (
                <p className="text-xs text-slate-500">No channels configured. Add at least one channel ID.</p>
              ) : (
                slack.channels.map((channel, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="C0123ABCD"
                      value={channel.channelId}
                      onChange={(event) =>
                        updateSlack({
                          channels: slack.channels.map((entry, i) => (i === index ? { ...entry, channelId: event.target.value } : entry)),
                        })
                      }
                      disabled={!isAdmin}
                    />
                    <Input
                      placeholder="Name"
                      value={channel.name}
                      onChange={(event) =>
                        updateSlack({
                          channels: slack.channels.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)),
                        })
                      }
                      disabled={!isAdmin}
                    />
                    <Toggle
                      checked={channel.isActive}
                      onChange={(next) =>
                        updateSlack({
                          channels: slack.channels.map((entry, i) => (i === index ? { ...entry, isActive: next } : entry)),
                        })
                      }
                    />
                    {isAdmin ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => updateSlack({ channels: slack.channels.filter((_, i) => i !== index) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>

          {isAdmin ? (
            <div className="flex justify-end">
              <Button onClick={() => slackMutation.mutate()} loading={slackMutation.isPending}>
                <Save className="h-4 w-4" /> Save Slack settings
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'troubleshooting' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Engine thresholds" />
            <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
              <Field label="Max attempts before escalation">
                <Input
                  type="number"
                  value={troubleshooting.maxAttempts}
                  onChange={(event) => updateTroubleshooting({ maxAttempts: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Session stale after (hours)">
                <Input
                  type="number"
                  value={troubleshooting.sessionStaleAfterHours}
                  onChange={(event) => updateTroubleshooting({ sessionStaleAfterHours: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Max screenshots per message">
                <Input
                  type="number"
                  value={troubleshooting.maxScreenshotsPerMessage}
                  onChange={(event) => updateTroubleshooting({ maxScreenshotsPerMessage: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Max attachment bytes">
                <Input
                  type="number"
                  value={troubleshooting.maxAttachmentBytes}
                  onChange={(event) => updateTroubleshooting({ maxAttachmentBytes: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="KB articles per request">
                <Input
                  type="number"
                  value={troubleshooting.kbMaxArticles}
                  onChange={(event) => updateTroubleshooting({ kbMaxArticles: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="KB steps per request">
                <Input
                  type="number"
                  value={troubleshooting.kbMaxSteps}
                  onChange={(event) => updateTroubleshooting({ kbMaxSteps: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Escalation" />
            <div className="space-y-4 px-5 py-4">
              <Field label="Escalation contact">
                <Input
                  value={troubleshooting.escalationContact}
                  onChange={(event) => updateTroubleshooting({ escalationContact: event.target.value })}
                  placeholder="e.g. #it-help or helpdesk@example.com"
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="Required info items (one per line)">
                <Textarea
                  className="font-sans"
                  value={troubleshooting.escalationInfoItems}
                  onChange={(event) => updateTroubleshooting({ escalationInfoItems: event.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
              <Field label="IT technician (the person escalated tickets are assigned to)">
                <Input
                  list="slack-member-options"
                  value={troubleshooting.itTechnicianUserId}
                  onChange={(event) => updateTroubleshooting({ itTechnicianUserId: event.target.value })}
                  placeholder="e.g. @mostafa.salah or U012AB3CD"
                  disabled={!isAdmin}
                />
                <datalist id="slack-member-options">
                  {memberList.map((user) => (
                    <option key={user.id} value={user.handle}>
                      {user.name} — {user.id}
                    </option>
                  ))}
                </datalist>
                {techValue && techLooksLikeChannelId ? (
                  <p className="mt-1 text-xs text-rose-600">
                    That looks like a DM/channel ID, not a user. Pick the person from the list instead.
                  </p>
                ) : techUnresolved ? (
                  <p className="mt-1 text-xs text-rose-600">
                    No Slack member matches this — it will post as plain text instead of notifying anyone.
                  </p>
                ) : techValue && techMatches ? (
                  <p className="mt-1 text-xs text-emerald-600">Matches a workspace member.</p>
                ) : null}
              </Field>
              <Field label="Escalation CC group (Slack user group handle)">
                <Input
                  value={troubleshooting.escalationCcGroup}
                  onChange={(event) => updateTroubleshooting({ escalationCcGroup: event.target.value })}
                  placeholder="e.g. @it-report"
                  disabled={!isAdmin}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Slack rewrites this into a real group mention when the escalation is posted, so everyone in
                  the group is notified. Leave empty to skip the CC.
                </p>
              </Field>
              <Field label="Escalation SLA (hours)">
                <Input
                  type="number"
                  min={1}
                  max={336}
                  value={troubleshooting.escalationSlaHours}
                  onChange={(event) => updateTroubleshooting({ escalationSlaHours: Number(event.target.value) })}
                  disabled={!isAdmin}
                />
              </Field>
              <p className="text-xs text-slate-500">
                On escalation the bot posts one message in the thread that mentions the IT technician, CCs the
                group above, and includes the ticket ID, summary and SLA window.
              </p>
            </div>
          </Card>

          {isAdmin ? (
            <div className="flex justify-end">
              <Button onClick={() => troubleshootingMutation.mutate()} loading={troubleshootingMutation.isPending}>
                <Save className="h-4 w-4" /> Save troubleshooting settings
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'environment' ? (
        <Card>
          <CardHeader title="Runtime" />
          <dl className="divide-y divide-[var(--color-line)] text-sm">
            <Row label="Environment" value={data.settings.environment.nodeEnv} />
            <Row label="Log level" value={data.settings.environment.logLevel} />
            <Row label="File storage" value={data.settings.environment.fileStorage} />
            <Row label="Version" value={data.settings.environment.version} />
            <Row label="Started" value={new Date(data.settings.environment.startedAt).toLocaleString()} />
            <Row label="Primary AI" value={data.settings.ai.primaryProvider ? humanize(data.settings.ai.primaryProvider) : 'Not configured'} />
            <Row label="Fallback AI" value={data.settings.ai.fallbackProvider ? humanize(data.settings.ai.fallbackProvider) : 'None'} />
          </dl>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-slate-300">{value}</dd>
    </div>
  );
}

function split(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
