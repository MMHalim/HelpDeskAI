import type { FastifyInstance } from 'fastify';
import { loginSchema } from '@helpdesk/shared';
import { env } from '../env.js';
import { parse } from './helpers.js';
import { requireUser } from '../plugins/auth.js';
import { login, logout, SESSION_COOKIE } from '../modules/auth/service.js';
import type { User } from '../db/schema.js';

function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const result = await login(input.email, input.password, {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProduction,
      path: '/',
      expires: result.expiresAt,
    });

    return { user: publicUser(result.user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    const user = await requireUser(request);
    return { user: publicUser(user) };
  });
}
