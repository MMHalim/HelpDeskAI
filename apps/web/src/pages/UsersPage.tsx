import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCog } from 'lucide-react';
import type { UserDto } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Toggle } from '../components/ui';
import { cn, formatDateTime } from '../lib/utils';

interface CreateForm {
  email: string;
  name: string;
  password: string;
  role: 'admin' | 'viewer';
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({ email: '', name: '', password: '', role: 'viewer' });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserDto[] }>('/api/users'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/users', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setModalOpen(false);
      setForm({ email: '', name: '', password: '', role: 'viewer' });
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to create the user'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch(`/api/users/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to update the user'),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Users</h1>
          <p className="text-sm text-slate-400">Administrators and read-only viewers of the console</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> New user
        </Button>
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
          <EmptyState title="Unable to load users" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last login</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {data.users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2 font-medium text-slate-200">
                        <UserCog className="h-3.5 w-3.5 text-slate-500" />
                        {user.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400">{user.email}</td>
                    <td className="px-5 py-3">
                      <Select
                        value={user.role}
                        onChange={(event) => updateMutation.mutate({ id: user.id, patch: { role: event.target.value } })}
                        className="h-8 w-28 text-xs"
                      >
                        <option value="admin">Admin</option>
                        <option value="viewer">Viewer</option>
                      </Select>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Toggle
                          checked={user.isActive}
                          onChange={(next) => updateMutation.mutate({ id: user.id, patch: { isActive: next } })}
                        />
                        <Badge
                          className={cn(
                            user.isActive
                              ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                              : 'border-slate-500/30 bg-slate-500/15 text-slate-400',
                          )}
                        >
                          {user.isActive ? 'active' : 'disabled'}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-400">{formatDateTime(user.lastLoginAt)}</td>
                    <td className="px-5 py-3 text-slate-400">{formatDateTime(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Create user"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={!form.email || !form.name || form.password.length < 12}
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
          <Field label="Name">
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field label="Password" hint="At least 12 characters">
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as 'admin' | 'viewer' })}>
              <option value="viewer">Viewer</option>
              <option value="admin">Administrator</option>
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
