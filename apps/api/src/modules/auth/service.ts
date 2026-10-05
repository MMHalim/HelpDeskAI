/**
 * Administrator authentication (§21).
 *
 * Accounts are Supabase Auth identities: `users.auth_user_id` links each row to
 * its `auth.users` record through a foreign key and the password is verified by
 * GoTrue. Rows predating that link keep a local scrypt hash so an existing
 * administrator is never locked out, and `linkUserToSupabaseAuth` moves them
 * over on the next password change.
 *
 * Browser sessions are opaque tokens stored hashed in PostgreSQL and delivered
 * as httpOnly cookies, so a database leak cannot be replayed as a login.
 */
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { CreateUserInput, UserRole } from '@helpdesk/shared';
import { db } from '../../db/client.js';
import { authSessions, users, type User } from '../../db/schema.js';
import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { env } from '../../env.js';
import { log } from '../logging/service.js';
import {
  createAuthUser,
  deleteAuthUser,
  isSupabaseAuthConfigured,
  updateAuthPassword,
  verifyAuthPassword,
} from './supabase-auth.js';

export const SESSION_COOKIE = 'hdai_session';

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: User;
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    authUserId: user.authUserId,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function login(
  email: string,
  password: string,
  meta: SessionMeta = {},
): Promise<LoginResult> {
  const rows = await db.select().from(users).where(eq(sql`lower(${users.email})`, email.toLowerCase())).limit(1);
  const user = rows[0];

  let valid: boolean;
  if (user?.authUserId && isSupabaseAuthConfigured()) {
    // The credential lives in Supabase Auth; a wrong password returns false and
    // only an Auth outage throws, so outages are not reported as bad logins.
    valid = await verifyAuthPassword(email, password);
  } else {
    // Always run a hash comparison to keep the timing of unknown-user and
    // wrong-password logins indistinguishable.
    const storedHash = user?.passwordHash ?? 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA';
    valid = await verifyPassword(password, storedHash);
  }

  if (!user || !valid) {
    log.warn({ category: 'auth', metadata: { email } }, 'Failed login attempt');
    throw AppError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) {
    throw AppError.forbidden('This account has been deactivated');
  }

  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx
      .insert(authSessions)
      .values({
        userId: user.id,
        tokenHash: hashToken(token),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
        expiresAt,
      });
    await tx.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  });

  log.info({ category: 'auth', metadata: { userId: user.id, email: user.email } }, 'Admin logged in');
  return { token, expiresAt, user: { ...user, lastLoginAt: new Date() } };
}

export async function validateSession(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ session: authSessions, user: users })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, hashToken(token)), isNull(authSessions.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() < Date.now()) return null;
  if (!row.user.isActive) return null;

  // Refresh `lastSeenAt` at most once a minute to avoid a write per request.
  if (Date.now() - row.session.lastSeenAt.getTime() > 60_000) {
    void db
      .update(authSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(authSessions.id, row.session.id))
      .catch(() => undefined);
  }

  return row.user;
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.tokenHash, hashToken(token)));
}

export async function listUsers(): Promise<ReturnType<typeof toPublicUser>[]> {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt));
  return rows.map(toPublicUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createUser(input: CreateUserInput): Promise<ReturnType<typeof toPublicUser>> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) throw AppError.conflict('A user with that email already exists');

  const email = input.email.trim().toLowerCase();

  // Provision the Supabase identity first: it is the credential store, so a
  // half-created account would be unusable. If the row insert then fails the
  // identity is removed again so the email is not left half-registered.
  const identity = isSupabaseAuthConfigured()
    ? await createAuthUser({ email, password: input.password, name: input.name, role: input.role })
    : null;

  let user: User;
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        authUserId: identity?.id ?? null,
        email,
        name: input.name,
        // Supabase Auth owns the password; the local hash is a fallback for
        // deployments without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
        passwordHash: identity ? null : await hashPassword(input.password),
        role: input.role as UserRole,
      })
      .returning();
    if (!inserted) throw new AppError('Failed to create user');
    user = inserted;
  } catch (error) {
    if (identity) {
      await deleteAuthUser(identity.id).catch(() => undefined);
    }
    throw error;
  }

  log.info(
    { category: 'auth', metadata: { userId: user.id, authUserId: user.authUserId, supabase: Boolean(identity) } },
    'User created',
  );
  return toPublicUser(user);
}

/**
 * Move an account created before the Supabase link onto Supabase Auth.
 *
 * The caller supplies the new password because the local scrypt hash cannot be
 * converted into GoTrue's format without the plaintext; once linked, the local
 * hash is discarded so Supabase Auth is the only credential store.
 */
export async function linkUserToSupabaseAuth(
  id: string,
  password: string,
): Promise<ReturnType<typeof toPublicUser>> {
  if (!isSupabaseAuthConfigured()) {
    throw AppError.configuration('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  const user = await getUserById(id);
  if (!user) throw AppError.notFound('User');
  if (user.authUserId) return toPublicUser(user);

  const identity = await createAuthUser({
    email: user.email,
    password,
    name: user.name,
    role: user.role,
  });

  const [updated] = await db
    .update(users)
    .set({ authUserId: identity.id, passwordHash: null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!updated) {
    await deleteAuthUser(identity.id).catch(() => undefined);
    throw new AppError('Failed to link the account to Supabase Auth');
  }

  await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.userId, id));
  log.info(
    { category: 'auth', metadata: { userId: id, authUserId: identity.id } },
    'User linked to Supabase Auth; sessions revoked',
  );
  return toPublicUser(updated);
}

export async function updateUser(
  id: string,
  patch: { name?: string; role?: UserRole; isActive?: boolean; password?: string },
): Promise<ReturnType<typeof toPublicUser>> {
  const existing = await getUserById(id);
  if (!existing) throw AppError.notFound('User');

  // Keep the Supabase identity in step before the row is written, so the two
  // never disagree about who the account belongs to.
  if (existing.authUserId && isSupabaseAuthConfigured()) {
    if (patch.password) await updateAuthPassword(existing.authUserId, patch.password);
  }

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.role !== undefined) values.role = patch.role;
  if (patch.isActive !== undefined) values.isActive = patch.isActive;
  if (patch.password && !existing.authUserId) values.passwordHash = await hashPassword(patch.password);

  const rows = await db.update(users).set(values as never).where(eq(users.id, id)).returning();
  const user = rows[0];
  if (!user) throw AppError.notFound('User');

  if (patch.isActive === false || patch.password) {
    await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.userId, id));
  }
  return toPublicUser(user);
}

export async function countAdmins(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  return rows[0]?.count ?? 0;
}

export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(authSessions)
    .where(lt(authSessions.expiresAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
    .returning({ id: authSessions.id });
  return deleted.length;
}
