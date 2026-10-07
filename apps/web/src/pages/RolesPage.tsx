import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Save, Trash2 } from 'lucide-react';
import { DASHBOARD_FEATURES, type RoleDto } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Spinner, Toggle } from '../components/ui';

type Draft = Record<RoleDto['id'], Record<string, boolean>>;

function groups() {
  const tabs = DASHBOARD_FEATURES.filter((feature) => feature.group === 'Tabs');
  const actions = DASHBOARD_FEATURES.filter((feature) => feature.group === 'Actions');
  return [
    { heading: 'Tabs', features: tabs },
    { heading: 'Actions', features: actions },
  ];
}

export function RolesPage() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ key: '', label: '', description: '' });
  const [confirmRole, setConfirmRole] = useState<RoleDto | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ roles: RoleDto[] }>('/api/roles'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/roles', createForm),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      setCreateOpen(false);
      setCreateForm({ key: '', label: '', description: '' });
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to create the role'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/roles/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      setConfirmRole(null);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to delete the role'),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: { featureKey: string; enabled: boolean }[] }) =>
      api.put(`/api/roles/${id}/permissions`, { permissions }),
    onSuccess: (_result, { id }) => {
      setDraft((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to save permissions'),
  });

  const roles = data?.roles ?? [];
  const rows = useMemo(() => groups(), []);

  const currentValue = (role: RoleDto, featureKey: string): boolean => {
    if (role.key === 'admin') return true;
    if (draft[role.id]?.[featureKey] !== undefined) return draft[role.id]?.[featureKey] ?? false;
    return role.permissions.find((permission) => permission.featureKey === featureKey)?.enabled ?? true;
  };

  const isDirty = (role: RoleDto): boolean => {
    const roleDraft = draft[role.id];
    if (!roleDraft) return false;
    return DASHBOARD_FEATURES.some((feature) => roleDraft[feature.key] !== undefined);
  };

  const toggle = (role: RoleDto, featureKey: string, next: boolean): void => {
    if (!isAdmin || role.key === 'admin') return;
    setDraft((current) => ({ ...current, [role.id]: { ...(current[role.id] ?? {}), [featureKey]: next } }));
  };

  const save = (role: RoleDto): void => {
    setError(null);
    const permissions = DASHBOARD_FEATURES.map((feature) => ({
      featureKey: feature.key,
      enabled: currentValue(role, feature.key),
    }));
    saveMutation.mutate({ id: role.id, permissions });
  };

  const slugify = (value: string): string =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Roles &amp; Permissions</h1>
          <p className="text-sm text-slate-400">
            Each column is a role; each row is a tab or a privileged action. Anything unticked is hidden from that
            role (and blocked by the API) the moment you save.
          </p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New role
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      ) : null}

      <Card>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner className="h-6 w-6" />
          </div>
        ) : isError || !data ? (
          <EmptyState title="Unable to load roles" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 bg-[var(--color-surface)] px-5 py-3 font-medium">Feature</th>
                  {roles.map((role) => (
                    <th key={role.id} className="px-3 py-3 text-center font-medium">
                      <div className="flex items-center justify-center gap-1">
                        <span>{role.label}</span>
                        <Badge className="ml-0.5 border-slate-600/40 bg-slate-600/20 text-slate-400">
                          {role.userCount}
                        </Badge>
                        {role.key === 'admin' ? (
                          <Lock className="h-3 w-3 text-slate-500" aria-label="System role" />
                        ) : !role.isSystem && isAdmin ? (
                          <button
                            type="button"
                            onClick={() => setConfirmRole(role)}
                            className="rounded p-0.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                            aria-label={`Delete ${role.label}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {rows.map(({ heading, features }) => (
                  <Fragment key={heading}>
                    <tr className="bg-[var(--color-surface-muted)]/60">
                      <td className="px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {heading}
                      </td>
                      {roles.map((role) => (
                        <td key={`${heading}-${role.id}`} className="px-3 py-2" />
                      ))}
                    </tr>
                    {features.map((feature) => (
                      <tr key={feature.key} className="align-top">
                        <td className="sticky left-0 bg-[var(--color-surface)] px-5 py-3">
                          <p className="text-sm font-medium text-slate-200">{feature.label}</p>
                          <p className="mt-0.5 max-w-xs text-xs text-slate-500">{feature.description}</p>
                        </td>
                        {roles.map((role) => {
                          const locked = role.key === 'admin';
                          const checked = currentValue(role, feature.key);
                          return (
                            <td key={`${role.id}-${feature.key}`} className="px-3 py-3 text-center">
                              {locked ? (
                                <span
                                  className="inline-flex h-5 w-9 items-center justify-center rounded-full bg-indigo-600/90"
                                  title="Administrator always has every feature"
                                >
                                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3 text-white">
                                    <path
                                      fillRule="evenodd"
                                      d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </span>
                              ) : (
                                <Toggle
                                  checked={checked}
                                  onChange={(next) => toggle(role, feature.key, next)}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {isAdmin ? (
        <div className="flex flex-wrap gap-3">
          {roles
            .filter((role) => role.key !== 'admin' && isDirty(role))
            .map((role) => (
              <Button key={role.id} size="sm" loading={saveMutation.isPending} onClick={() => save(role)}>
                <Save className="h-3.5 w-3.5" /> Save {role.label}
              </Button>
            ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          You are viewing roles read-only. Only administrators can create roles or change permissions.
        </p>
      )}

      <p className="text-xs text-slate-500">
        The Administrator column is fixed: admins always have every feature, so an admin can never be locked out.
        Deleting a role is blocked while a user still has it.
      </p>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create role"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={!createForm.key || !createForm.label}
              onClick={() => {
                setError(null);
                createMutation.mutate();
              }}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Key" hint="Identifier shown in the Users list. Lowercase letters, numbers and dashes.">
            <Input
              value={createForm.key}
              placeholder="it-technician"
              onChange={(event) => setCreateForm((current) => ({ ...current, key: slugify(event.target.value) }))}
            />
          </Field>
          <Field label="Name">
            <Input
              value={createForm.label}
              placeholder="IT Technician"
              onChange={(event) => setCreateForm((current) => ({ ...current, label: event.target.value }))}
            />
          </Field>
          <Field label="Description" hint="Optional. Shown under the role name.">
            <Input
              value={createForm.description}
              placeholder="Handles escalations from the Slack agent"
              onChange={(event) => setCreateForm((current) => ({ ...current, description: event.target.value }))}
            />
          </Field>
          <p className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
            New roles start with every tab visible and no actions. Tune the matrix after creating it.
          </p>
        </div>
      </Modal>

      <Modal
        open={confirmRole !== null}
        onClose={() => setConfirmRole(null)}
        title="Delete role"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRole(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (!confirmRole) return;
                setError(null);
                deleteMutation.mutate(confirmRole.id);
              }}
            >
              Delete role
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-medium text-slate-100">{confirmRole?.label}</span>? It is currently assigned
          to {confirmRole?.userCount ?? 0} user(s); deletion is blocked until they are moved to another role.
        </p>
      </Modal>
    </div>
  );
}