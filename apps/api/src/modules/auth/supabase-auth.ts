/**
 * Supabase Auth (GoTrue) administration (§21).
 *
 * Console credentials live in Supabase Auth rather than in this database: an
 * account row carries the `auth.users` id in `users.auth_user_id` through a
 * foreign key, and the password is verified by GoTrue. The service-role key is
 * used server-side only — it is never sent to the dashboard.
 *
 * GoTrue is called over plain `fetch`, like the Supabase storage client, to
 * keep the API free of another dependency.
 */
import { AppError } from '../../lib/errors.js';
import { env } from '../../env.js';

const TIMEOUT_MS = 10_000;

export interface AuthUserIdentity {
  id: string;
  email: string;
}

/** GoTrue error bodies are `{ code, error_code, msg }`. */
interface GoTrueError {
  code?: number;
  error_code?: string;
  msg?: string;
  message?: string;
  error_description?: string;
}

function isConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Whether console accounts are backed by Supabase Auth on this deployment. */
export function isSupabaseAuthConfigured(): boolean {
  return isConfigured();
}

function serviceHeaders(): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, authorization: `Bearer ${key}` };
}

async function call<T>(
  path: string,
  init: { method: string; body?: unknown; auth?: boolean },
): Promise<{ status: number; data: T | null; error: GoTrueError | null }> {
  const base = env.SUPABASE_URL!.replace(/\/$/, '');
  const headers: Record<string, string> = init.auth
    ? { 'content-type': 'application/json', apikey: env.SUPABASE_SERVICE_ROLE_KEY! }
    : { 'content-type': 'application/json', ...serviceHeaders() };

  let response: Response;
  try {
    response = await fetch(`${base}/auth/v1${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw AppError.internal('Supabase Auth is unreachable', cause);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  return {
    status: response.status,
    data: response.ok ? (parsed as T) : null,
    error: response.ok ? null : ((parsed as GoTrueError) ?? {}),
  };
}

/** Translate GoTrue failures into messages that are safe for the dashboard. */
function throwFor(what: string, error: GoTrueError | null, status: number): never {
  const raw = (error?.msg ?? error?.message ?? error?.error_description ?? '').toLowerCase();

  if (raw.includes('already registered') || raw.includes('already been registered') || error?.error_code === 'email_exists') {
    throw AppError.conflict('A Supabase Auth user with that email already exists');
  }
  if (raw.includes('email address') && (raw.includes('invalid') || raw.includes('not valid'))) {
    throw AppError.validation('Supabase rejected that email address');
  }
  if (status === 429) {
    throw AppError.internal('Supabase Auth is rate limiting this project; try again shortly');
  }
  if (status >= 500 || status === 0) {
    throw AppError.internal('Supabase Auth is unavailable', error);
  }
  throw AppError.internal(`Failed to ${what} in Supabase Auth`, error);
}

/**
 * Create an email/password identity and return its id.
 *
 * `email_confirm: true` skips the confirmation email so an administrator can
 * onboard a colleague from the dashboard in a single request; the address is
 * already verified by the administrator who owns the Supabase project.
 */
export async function createAuthUser(input: {
  email: string;
  password: string;
  name: string;
  role: string;
}): Promise<AuthUserIdentity> {
  const { data, error, status } = await call<{ id: string; email: string }>('/admin/users', {
    method: 'POST',
    body: {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name, role: input.role, provisioned_by: 'helpdesk_console' },
    },
  });

  if (!data) throwFor('create the user', error, status);
  return { id: data.id, email: data.email };
}

/**
 * Verify a password against Supabase Auth.
 *
 * Returns false for wrong credentials. Throws only when Auth itself is broken,
 * so a Supabase outage surfaces as a 500 instead of locking everyone out with a
 * misleading "invalid password".
 */
export async function verifyAuthPassword(email: string, password: string): Promise<boolean> {
  const { status } = await call('/token?grant_type=password', {
    method: 'POST',
    auth: true,
    body: { email: email.trim().toLowerCase(), password },
  });

  if (status === 200) return true;
  if (status === 400 || status === 401 || status === 422) return false;
  throw AppError.internal('Supabase Auth is unavailable', { status });
}

/** Replace the password of an existing identity (admin resets). */
export async function updateAuthPassword(id: string, password: string): Promise<void> {
  const { data, error, status } = await call(`/admin/users/${id}`, {
    method: 'PUT',
    body: { password, email_confirm: true },
  });

  if (!data) throwFor('update the password', error, status);
}

/** Remove an identity. Used to roll back a failed account creation. */
export async function deleteAuthUser(id: string): Promise<void> {
  const { status } = await call(`/admin/users/${id}`, { method: 'DELETE' });
  if (status === 404) return;
  if (status >= 400 && status < 500) return;
  if (status >= 500) throw AppError.internal('Supabase Auth is unavailable', { status });
}
