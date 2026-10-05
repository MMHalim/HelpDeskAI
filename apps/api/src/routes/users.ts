import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createUserSchema, idParamSchema, linkSupabaseAuthSchema } from '@helpdesk/shared';
import { AppError } from '../lib/errors.js';
import { requireAdmin } from '../plugins/auth.js';
import { parse } from './helpers.js';
import {
  countAdmins,
  createUser,
  linkUserToSupabaseAuth,
  listUsers,
  updateUser,
} from '../modules/auth/service.js';
import { recordAudit } from '../modules/audit/service.js';

const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(['admin', 'viewer']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12).max(200).optional(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users', async (request) => {
    await requireAdmin(request);
    return { users: await listUsers() };
  });

  app.post('/api/users', async (request, reply) => {
    const actor = await requireAdmin(request);
    const input = parse(createUserSchema, request.body);
    // One request provisions the Supabase Auth identity (auto-confirmed) and
    // the console row that points at it.
    const user = await createUser(input);
    await recordAudit({ user: actor, action: 'user.create', entityType: 'user', entityId: user.id });
    return reply.status(201).send({ user });
  });

  app.post('/api/users/:id/supabase-auth', async (request) => {
    const actor = await requireAdmin(request);
    const { id } = parse(idParamSchema, request.params);
    const { password } = parse(linkSupabaseAuthSchema, request.body);
    // Linking revokes that account's sessions, so whoever performs it — the
    // current administrator included — signs in again with the new password.
    const user = await linkUserToSupabaseAuth(id, password);
    await recordAudit({
      user: actor,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      after: { linkedToSupabaseAuth: true },
    });
    return { user };
  });

  app.patch('/api/users/:id', async (request) => {
    const actor = await requireAdmin(request);
    const { id } = parse(idParamSchema, request.params);
    const patch = parse(updateUserSchema, request.body);

    if ((patch.role === 'viewer' || patch.isActive === false) && (await countAdmins()) <= 1) {
      const target = (await listUsers()).find((user) => user.id === id);
      if (target?.role === 'admin') {
        throw AppError.conflict('At least one active administrator is required');
      }
    }

    const user = await updateUser(id, patch);
    await recordAudit({ user: actor, action: 'user.update', entityType: 'user', entityId: id, after: patch });
    return { user };
  });
}
