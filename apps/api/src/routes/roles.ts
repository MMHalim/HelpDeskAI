import type { FastifyInstance } from 'fastify';
import { createRoleSchema, updateRoleSchema, setRolePermissionsSchema } from '@helpdesk/shared';
import { requireAdmin, requireUser } from '../plugins/auth.js';
import { parse } from './helpers.js';
import {
  createRole,
  deleteRole,
  listRoles,
  setRolePermissions,
  updateRole,
  type RoleWithPermissions,
} from '../modules/roles/service.js';

function toDto(role: RoleWithPermissions) {
  return {
    id: role.id,
    key: role.key,
    label: role.label,
    description: role.description,
    isSystem: role.isSystem,
    userCount: role.userCount,
    createdAt: role.createdAt.toISOString(),
    permissions: role.permissions.map((permission) => ({
      featureKey: permission.featureKey,
      enabled: permission.enabled,
    })),
  };
}

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/roles', async (request) => {
    await requireUser(request);
    const roles = await listRoles();
    return { roles: roles.map(toDto) };
  });

  app.post('/api/roles', async (request) => {
    await requireAdmin(request);
    const input = parse(createRoleSchema, request.body);
    const created = await createRole(input);
    return { role: toDto(created) };
  });

  app.patch('/api/roles/:id', async (request) => {
    await requireAdmin(request);
    const params = request.params as { id: string };
    const input = parse(updateRoleSchema, request.body);
    const updated = await updateRole(params.id, input);
    return { role: toDto(updated) };
  });

  app.delete('/api/roles/:id', async (request) => {
    await requireAdmin(request);
    const params = request.params as { id: string };
    await deleteRole(params.id);
    return { ok: true };
  });

  app.put('/api/roles/:id/permissions', async (request) => {
    await requireAdmin(request);
    const params = request.params as { id: string };
    const input = parse(setRolePermissionsSchema, request.body);
    const updated = await setRolePermissions(params.id, input.permissions);
    return { role: toDto(updated) };
  });
}