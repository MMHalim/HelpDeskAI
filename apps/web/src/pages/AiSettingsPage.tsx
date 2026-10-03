import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, Trash2 } from 'lucide-react';
import type { AiInstructionsDto, AiProviderDto, AiProviderHealthDto, AiProviderId } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
  Toggle,
} from '../components/ui';
import { useAuth } from '../auth';
import { cn, formatCurrency, formatDateTime, formatNumber, formatPercent } from '../lib/utils';

interface ProviderDraft {
  provider: AiProviderId;
  label: string;
  enabled: boolean;
  model: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  maxOutputTokens: number;
  maxRetries: number;
  timeoutMs: number;
  visionEnabled: boolean;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
}

const HEALTH_STYLES: Record<string, string> = {
  healthy: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  degraded: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  unconfigured: 'border-slate-500/30 bg-slate-500/15 text-slate-400',
  disabled: 'border-slate-500/30 bg-slate-500/15 text-slate-500',
  unknown: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
};

function toDraft(provider: AiProviderDto): ProviderDraft {
  return {
    provider: provider.provider,
    label: provider.label,
    enabled: provider.enabled,
    model: provider.model,
    apiKey: '',
    baseUrl: provider.baseUrl ?? '',
    temperature: provider.temperature,
    maxOutputTokens: provider.maxOutputTokens,
    maxRetries: provider.maxRetries,
    timeoutMs: provider.timeoutMs,
    visionEnabled: provider.visionEnabled,
    inputCostPerMillion: provider.inputCostPerMillion,
    outputCostPerMillion: provider.outputCostPerMillion,
    hasApiKey: provider.hasApiKey,
    apiKeyPreview: provider.apiKeyPreview,
  };
}

export function AiSettingsPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<ProviderDraft[]>([]);
  const [primaryProvider, setPrimaryProvider] = useState('');
  const [fallbackProvider, setFallbackProvider] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [changeNote, setChangeNote] = useState('');

  const { data: providersData, isLoading: providersLoading } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => api.get<{ providers: AiProviderDto[] }>('/api/ai/providers'),
  });

  const { data: healthData } = useQuery({
    queryKey: ['ai-health'],
    queryFn: () => api.get<{ providers: AiProviderHealthDto[] }>('/api/ai/providers/health'),
  });

  const { data: instructionsData } = useQuery({
    queryKey: ['ai-instructions'],
    queryFn: () => api.get<{ instructions: AiInstructionsDto }>('/api/ai/instructions'),
  });

  useEffect(() => {
    if (!providersData?.providers) return;
    setDrafts(providersData.providers.map(toDraft));
    const primary = providersData.providers.find((provider) => provider.role === 'primary');
    const fallback = providersData.providers.find((provider) => provider.role === 'fallback');
    setPrimaryProvider(primary?.provider ?? '');
    setFallbackProvider(fallback?.provider ?? '');
  }, [providersData]);

  useEffect(() => {
    if (instructionsData?.instructions) setInstructions(instructionsData.instructions.content);
  }, [instructionsData]);

  const healthMap = useMemo(
    () => new Map((healthData?.providers ?? []).map((entry) => [entry.provider, entry])),
    [healthData],
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put('/api/ai/providers', {
        primaryProvider: primaryProvider || undefined,
        fallbackProvider: fallbackProvider || undefined,
        providers: drafts.map((draft) => ({
          provider: draft.provider,
          label: draft.label,
          enabled: draft.enabled,
          role: draft.provider === primaryProvider ? 'primary' : draft.provider === fallbackProvider ? 'fallback' : 'disabled',
          model: draft.model,
          apiKey: draft.apiKey || undefined,
          baseUrl: draft.baseUrl || undefined,
          temperature: draft.temperature,
          maxOutputTokens: draft.maxOutputTokens,
          maxRetries: draft.maxRetries,
          timeoutMs: draft.timeoutMs,
          visionEnabled: draft.visionEnabled,
          inputCostPerMillion: draft.inputCostPerMillion,
          outputCostPerMillion: draft.outputCostPerMillion,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
      void queryClient.invalidateQueries({ queryKey: ['ai-health'] });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to save providers'),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (provider: AiProviderId) => api.delete(`/api/ai/providers/${provider}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['ai-providers'] }),
  });

  const instructionsMutation = useMutation({
    mutationFn: () =>
      api.put('/api/ai/instructions', { content: instructions, changeNote: changeNote || undefined, activate: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-instructions'] });
      setChangeNote('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to save instructions'),
  });

  const updateDraft = (provider: AiProviderId, patch: Partial<ProviderDraft>) =>
    setDrafts((current) => current.map((draft) => (draft.provider === provider ? { ...draft, ...patch } : draft)));

  if (providersLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">AI Providers</h1>
          <p className="text-sm text-slate-400">Primary and fallback models, keys and generation settings</p>
        </div>
        {isAdmin ? (
          <div className="flex items-center gap-3">
            {saved ? <span className="text-xs text-emerald-400">Saved</span> : null}
            <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
              <Save className="h-4 w-4" /> Save providers
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Routing" description="Which provider handles requests first" />
          <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Primary provider">
              <Select value={primaryProvider} onChange={(event) => setPrimaryProvider(event.target.value)} disabled={!isAdmin}>
                <option value="">Not set</option>
                {drafts.map((draft) => (
                  <option key={draft.provider} value={draft.provider}>
                    {draft.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fallback provider">
              <Select value={fallbackProvider} onChange={(event) => setFallbackProvider(event.target.value)} disabled={!isAdmin}>
                <option value="">None</option>
                {drafts.map((draft) => (
                  <option key={draft.provider} value={draft.provider}>
                    {draft.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Usage (30 days)" />
          <div className="divide-y divide-[var(--color-line)]">
            {(healthData?.providers ?? []).length === 0 ? (
              <EmptyState title="No usage data" />
            ) : (
              (healthData?.providers ?? []).map((entry) => (
                <div key={entry.provider} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize text-slate-200">{entry.label}</span>
                    <Badge className={cn(HEALTH_STYLES[entry.status] ?? HEALTH_STYLES.unknown)}>{entry.status}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>{formatNumber(entry.requests)} req</span>
                    <span>{formatPercent(entry.successRate)} ok</span>
                    <span>{formatNumber(entry.totalTokens)} tokens</span>
                    <span>{formatCurrency(entry.estimatedCost)}</span>
                    {entry.avgLatencyMs != null ? <span>{Math.round(entry.avgLatencyMs)}ms avg</span> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {drafts.map((draft) => {
          const health = healthMap.get(draft.provider);
          return (
            <Card key={draft.provider}>
              <CardHeader
                title={draft.label}
                description={draft.provider}
                actions={
                  <>
                    <Toggle
                      checked={draft.enabled}
                      onChange={(next) => updateDraft(draft.provider, { enabled: next })}
                      label="Enabled"
                    />
                    {draft.hasApiKey && isAdmin ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteKeyMutation.mutate(draft.provider)}
                        loading={deleteKeyMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Key
                      </Button>
                    ) : null}
                  </>
                }
              />
              <div className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field label="API key" hint={draft.apiKeyPreview ? `Stored: ${draft.apiKeyPreview}` : 'No key stored'}>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      <Input
                        type="password"
                        className="pl-9"
                        placeholder={draft.hasApiKey ? '•••••••• (unchanged)' : 'Paste API key'}
                        value={draft.apiKey}
                        onChange={(event) => updateDraft(draft.provider, { apiKey: event.target.value })}
                        disabled={!isAdmin}
                      />
                    </div>
                  </Field>
                </div>
                <Field label="Model">
                  <Input value={draft.model} onChange={(event) => updateDraft(draft.provider, { model: event.target.value })} disabled={!isAdmin} />
                </Field>
                <Field label="Base URL">
                  <Input value={draft.baseUrl} onChange={(event) => updateDraft(draft.provider, { baseUrl: event.target.value })} disabled={!isAdmin} />
                </Field>
                <Field label="Temperature">
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={draft.temperature}
                    onChange={(event) => updateDraft(draft.provider, { temperature: Number(event.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Max output tokens">
                  <Input
                    type="number"
                    value={draft.maxOutputTokens}
                    onChange={(event) => updateDraft(draft.provider, { maxOutputTokens: Number(event.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Max retries">
                  <Input
                    type="number"
                    value={draft.maxRetries}
                    onChange={(event) => updateDraft(draft.provider, { maxRetries: Number(event.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Timeout (ms)">
                  <Input
                    type="number"
                    value={draft.timeoutMs}
                    onChange={(event) => updateDraft(draft.provider, { timeoutMs: Number(event.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Input cost / 1M">
                  <Input
                    type="number"
                    step="0.01"
                    value={draft.inputCostPerMillion}
                    onChange={(event) => updateDraft(draft.provider, { inputCostPerMillion: Number(event.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Output cost / 1M">
                  <Input
                    type="number"
                    step="0.01"
                    value={draft.outputCostPerMillion}
                    onChange={(event) => updateDraft(draft.provider, { outputCostPerMillion: Number(event.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <div className="flex items-center gap-4 sm:col-span-2">
                  <Toggle
                    checked={draft.visionEnabled}
                    onChange={(next) => updateDraft(draft.provider, { visionEnabled: next })}
                    label="Vision (screenshots)"
                  />
                  {health?.lastError ? <span className="truncate text-xs text-rose-400">{health.lastError}</span> : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader
          title="System instructions"
          description="The behaviour prompt injected into every AI request"
          actions={
            isAdmin ? (
              <Button onClick={() => instructionsMutation.mutate()} loading={instructionsMutation.isPending}>
                <Save className="h-4 w-4" /> Save instructions
              </Button>
            ) : null
          }
        />
        <div className="space-y-4 px-5 py-4">
          <Textarea
            className="min-h-[320px]"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            disabled={!isAdmin}
          />
          {isAdmin ? (
            <Field label="Change note">
              <Input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="What changed?" />
            </Field>
          ) : null}
          {instructionsData?.instructions.history.length ? (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Version history</p>
              <ul className="divide-y divide-[var(--color-line)] text-xs">
                {instructionsData.instructions.history.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between py-2">
                    <span className="text-slate-400">
                      v{entry.version} · {entry.changeNote ?? 'No note'} · {entry.updatedByName ?? 'System'}
                    </span>
                    <span className="flex items-center gap-2 text-slate-600">
                      {entry.isActive ? <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">active</Badge> : null}
                      {formatDateTime(entry.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
