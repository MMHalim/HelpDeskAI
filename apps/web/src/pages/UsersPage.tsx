import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserCog } from 'lucide-react';
import type { RoleDto, UserDto } from '@helpdesk/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Toggle } from '../components/ui';
import { cn, formatDateTime } from '../lib/utils';

interface CreateForm {
  email: string;
  name: string;
  password: string;
  role: string;
}

interface LinkForm {
  id: string;
  name: string;
  email: string;
  password: string;
}

function PasswordField({
  value,
  onChange,
  label = 'Password',
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint ?? 'At least 12 characters'}>
      <Input type="password" value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canManage = can('users.manage');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>({ email: '', name: '', password: '', role: 'viewer' });
  const [link, setLink] = useState<LinkForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserDto[] }>('/api/users'),
  });

  const rolesQuery = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ roles: RoleDto[] }>('/api/roles'),
  });
  const roles = rolesQuery.data?.roles ?? [];

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

  const linkMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post(`/api/users/${id}/supabase-auth`, { password }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      setLink(null);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to move the account to Supabase Auth'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch(`/api/users/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Unable to update the user'),
  });

  const users = data?.users ?? [];
  const pendingLinks = users.filter((user) => !user.authUserId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Users</h1>
          <p className="text-sm text-slate-400">
            Administrators and read-only viewers of the console. New accounts are created in Supabase Auth and linked
            to the console automatically.
          </p>
        </div>
        {canManage ? (
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" /> New user
          </Button>
        ) : null}
      </div>

      {pendingLinks.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {pendingLinks.length === 1
            ? `${pendingLinks[0]?.name} was created before the Supabase Auth link`
            : `${pendingLinks.length} accounts were created before the Supabase Auth link`}
          . Move{' '}
          {pendingLinks.length === 1 ? 'it' : 'them'} over so their passwords live in Supabase Auth.
        </div>
      ) : null}

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
                  <th className="px-5 py-3 font-medium">Supabase Auth</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Last login</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-2 font-medium text-slate-200">
                        <UserCog className="h-3.5 w-3.5 text-slate-500" />
                        {user.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-400">{user.email}</td>
                    <td className="px-5 py-3">
                      {user.authUserId ? (
                        <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">linked</Badge>
                      ) : canManage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setLink({ id: user.id, name: user.name, email: user.email, password: '' })}
                        >
                          Move to Supabase
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-500">local</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {canManage ? (
                        <Select
                          value={user.role}
                          onChange={(event) => updateMutation.mutate({ id: user.id, patch: { role: event.target.value } })}
                          className="h-8 w-32 text-xs"
                        >
                          {roles.map((role) => (
                            <option key={role.id} value={role.key}>
                              {role.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-xs text-slate-300">{user.role}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {canManage ? (
                          <Toggle
                            checked={user.isActive}
                            onChange={(next) => updateMutation.mutate({ id: user.id, patch: { isActive: next } })}
                          />
                        ) : null}
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
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value.trim() })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value.trim() })} />
          </Field>
          <PasswordField value={form.password} onChange={(password) => setForm({ ...form, password })} />
          <Field label="Role">
            <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              {roles.map((role) => (
                <option key={role.id} value={role.key}>
                  {role.label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2 text-xs text-slate-400">
            One request creates the Supabase Auth user (auto-confirmed, no confirmation email) and links it to this
            console account. They can sign in with this password straight away.
          </p>
        </div>
      </Modal>

      <Modal
        open={link !== null}
        onClose={() => setLink(null)}
        title="Move account to Supabase Auth"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLink(null)}>
              Cancel
            </Button>
            <Button
              loading={linkMutation.isPending}
              disabled={!link || link.password.length < 12}
              onClick={() => {
                if (!link) return;
                setError(null);
                linkMutation.mutate({ id: link.id, password: link.password });
              }}
            >
              Move account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            <span className="font-medium text-slate-200">{link?.name}</span> ({link?.email}) predates the Supabase
            link, so its password is still stored in this database. Set a new password to create the Supabase Auth
            identity, move the credential there and discard the local hash.
          </p>
          <PasswordField
            value={link?.password ?? ''}
            onChange={(password) => setLink((current) => (current ? { ...current, password } : current))}
            label="New password"
          />
          <p className="text-xs text-slate-500">
            The identity is auto-confirmed and all of this account&rsquo;s existing sessions are revoked, so they
            sign in again with the new password.
          </p>
        </div>
      </Modal>
    </div>
  );
}
