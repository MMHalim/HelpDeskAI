/**
 * Request authentication helpers (§21).
 *
 * The dashboard talks to the API with an httpOnly session cookie. These helpers
 * resolve the current administrator and enforce the admin role.
 */
import type { FastifyRequest } from 'fastify';
import type { User } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { SESSION_COOKIE, validateSession } from '../modules/auth/service.js';
import { hasFeature } from '../modules/roles/service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw request body captured for Slack signature verification. */
    rawBody?: string;
    currentUser?: User;
  }
}

export async function getCurrentUser(request: FastifyRequest): Promise<User | null> {
  if (request.currentUser) return request.currentUser;
  const token = request.cookies?.[SESSION_COOKIE];
  const user = await validateSession(token);
  if (user) request.currentUser = user;
  return user;
}

export async function requireUser(request: FastifyRequest): Promise<User> {
  const user = await getCurrentUser(request);
  if (!user) throw AppError.unauthorized();
  return user;
}

export async function requireAdmin(request: FastifyRequest): Promise<User> {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw AppError.forbidden('Administrator access is required');
  return user;
}

/**
 * Grants access when the current user's role has `featureKey` ticked in the
 * Roles screen. The `admin` role always passes; every other role must have an
 * explicit permission row (or inherit the default, which is "visible").
 */
export async function requireFeature(request: FastifyRequest, featureKey: string): Promise<User> {
  const user = await requireUser(request);
  if (!(await hasFeature(user, featureKey))) {
    throw AppError.forbidden(`This account cannot access ${featureKey}`);
  }
  return user;
}
