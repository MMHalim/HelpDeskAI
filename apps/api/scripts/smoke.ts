/**
 * Lightweight end-to-end smoke test that boots the API in-process and exercises
 * the health and authentication surfaces without external credentials.
 *
 * Run with: pnpm --filter @helpdesk/api smoke
 */
import { buildApp } from '../src/app.js';
import { env } from '../src/env.js';
import { runMigrations } from '../src/db/migrate.js';
import { closeDatabase } from '../src/db/client.js';

async function main(): Promise<void> {
  await runMigrations();
  const app = await buildApp();
  await app.ready();

  let failures = 0;
  const check = (name: string, condition: boolean, detail?: string): void => {
    const status = condition ? 'PASS' : 'FAIL';
    if (!condition) failures += 1;
    console.log(`[${status}] ${name}${detail ? ` - ${detail}` : ''}`);
  };

  const health = await app.inject({ method: 'GET', url: '/api/health' });
  check('GET /api/health returns 200', health.statusCode === 200, `status=${health.statusCode}`);
  const healthBody = health.json() as { status?: string; database?: boolean };
  check('database reachable', healthBody.database === true);

  const unauth = await app.inject({ method: 'GET', url: '/api/sessions' });
  check('unauthenticated /api/sessions returns 401', unauth.statusCode === 401, `status=${unauth.statusCode}`);

  const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
  check('unauthenticated /api/auth/me returns 401', me.statusCode === 401, `status=${me.statusCode}`);

  if (env.ADMIN_PASSWORD.length >= 12) {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    check('POST /api/auth/login succeeds', login.statusCode === 200, `status=${login.statusCode}`);

    const cookie = login.cookies[0]?.value ?? '';
    const sessions = await app.inject({
      method: 'GET',
      url: '/api/sessions?page=1&pageSize=5',
      cookies: { [login.cookies[0]?.name ?? 'hdai_session']: cookie },
    });
    check('authenticated GET /api/sessions returns 200', sessions.statusCode === 200, `status=${sessions.statusCode}`);

    const analytics = await app.inject({
      method: 'GET',
      url: '/api/analytics?days=7',
      cookies: { [login.cookies[0]?.name ?? 'hdai_session']: cookie },
    });
    check('authenticated GET /api/analytics returns 200', analytics.statusCode === 200, `status=${analytics.statusCode}`);
  } else {
    console.log('[SKIP] login flow (ADMIN_PASSWORD not configured)');
  }

  const slackNoSignature = await app.inject({
    method: 'POST',
    url: '/slack/events',
    payload: { type: 'event_callback', event_id: 'smoke-test', event: { type: 'message', channel: 'C000', ts: '1.0' } },
  });
  check(
    'Slack events without a signature is rejected in production',
    env.isProduction ? slackNoSignature.statusCode === 401 : true,
    `status=${slackNoSignature.statusCode}`,
  );

  await app.close();
  await closeDatabase();

  if (failures > 0) {
    console.error(`\n${failures} smoke check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed');
}

main().catch((error: unknown) => {
  console.error('Smoke test crashed', error);
  process.exit(1);
});
