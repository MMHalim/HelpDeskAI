# Deployment

This guide covers building and running HelpDeskAI in a production-like
environment. For local development see the [README](../README.md).

## Build

```bash
pnpm install --frozen-lockfile
pnpm build
```

Artifacts:

| Path | What |
| --- | --- |
| `packages/shared/dist` | Compiled shared contracts. |
| `apps/api/dist/src/index.js` | API entrypoint (`pnpm --filter @helpdesk/api start`). |
| `apps/api/drizzle` | SQL migrations (read at runtime, not copied by `tsc`). |
| `apps/web/dist` | Static dashboard bundle to serve from any web server/CDN. |

## Environment reference

Required values are marked. See `.env.example` for the full annotated list.

### Runtime

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set `production` in production. |
| `API_PORT` | `4000` | API listen port. |
| `API_HOST` | `0.0.0.0` | API bind address. |
| **`PUBLIC_API_URL`** | `http://localhost:4000` | Public base URL; used for file URLs and Slack reachability. |
| `CORS_ORIGINS` | — | Comma-separated dashboard origins. |
| `LOG_LEVEL` | `info` | `debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent`. |

### Database

| Variable | Default | Notes |
| --- | --- | --- |
| **`DATABASE_URL`** | — | PostgreSQL connection string (required). |
| `DATABASE_POOL_MODE` | `transaction` | `transaction` for pooled/Supabase connections, `session` for direct. |
| `DATABASE_SSL` | `disable` | `ssl` for managed databases that require TLS. |

### File storage

| Variable | Default | Notes |
| --- | --- | --- |
| `FILE_STORAGE` | `local` | `local` or `supabase`. |
| `STORAGE_LOCAL_DIR` | `./storage` | Directory for local storage (resolved from the repo root). |
| `STORAGE_PUBLIC_BASE_URL` | `${PUBLIC_API_URL}/api/files` | Base URL used to serve/point at stored files. |
| `SUPABASE_URL` | — | Required when `FILE_STORAGE=supabase`. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Required when `FILE_STORAGE=supabase`. |
| `SUPABASE_STORAGE_BUCKET` | `helpdesk-ai` | Supabase Storage bucket. |

### Security

| Variable | Default | Notes |
| --- | --- | --- |
| **`CREDENTIAL_ENCRYPTION_KEY`** | — | **Required in production.** 32 bytes, base64. Encrypts provider keys and Slack tokens. |
| `SESSION_PEPPER` | dev-only | Salt for session token hashing. Set a unique value. |
| `SESSION_TTL_HOURS` | `12` | Dashboard session lifetime. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Used only by `pnpm db:seed` to create the first admin. |

### Slack, AI and behaviour

Slack credentials (`SLACK_*`), AI provider config (`AI_*`, `GEMINI_*`,
`OPENAI_*`) and troubleshooting thresholds (`MAX_TROUBLESHOOTING_ATTEMPTS`,
`KB_MAX_ARTICLES`, …) are documented in
[SETUP_SLACK.md](SETUP_SLACK.md) and [SETUP_AI.md](SETUP_AI.md). They can also be
managed at runtime from the dashboard.

### Rate limiting

| Variable | Default |
| --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `60000` |
| `RATE_LIMIT_MAX` | `120` |
| `SLACK_EVENT_RATE_LIMIT_MAX` | `600` |

## Migrations

The API runs pending migrations on startup (`apps/api/src/index.ts`) except when
`NODE_ENV=test`. You can also apply them explicitly:

```bash
pnpm db:migrate
```

Create the first admin and starter articles:

```bash
pnpm db:seed
```

Both are idempotent and safe to re-run.

## Database options

### Local / managed PostgreSQL (>= 14)

```env
DATABASE_URL=postgresql://user:password@db-host:5432/helpdesk_ai
DATABASE_POOL_MODE=session
DATABASE_SSL=ssl
```

The migrations enable `pg_trgm` and `tsvector` search support; the database user
must be allowed to create extensions or they must be enabled in advance.

### Supabase

Use the pooled connection string (transaction mode) plus TLS:

```env
DATABASE_URL=postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_POOL_MODE=transaction
DATABASE_SSL=ssl
FILE_STORAGE=supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_STORAGE_BUCKET=helpdesk-ai
```

When `FILE_STORAGE=supabase`, screenshots and KB images are uploaded to Supabase
Storage; otherwise they are written to `STORAGE_LOCAL_DIR`.

## Serving the dashboard

`apps/web/dist` is a static bundle. Serve it with any static host or via a
reverse proxy that also forwards the API. In development, Vite proxies `/api` and
`/slack` to the API; in production point the dashboard at the API with
`VITE_API_URL` at build time if it is not same-origin:

```bash
VITE_API_URL=https://helpdesk.example.com pnpm --filter @helpdesk/web build
```

Set `CORS_ORIGINS` to the dashboard origin(s) when it is served from a different
host.

## Reverse proxy / HTTPS

Slack requires a public HTTPS endpoint for the Events API:

```text
https://<host>/slack/events  ->  http://127.0.0.1:4000/slack/events
```

- Do **not** buffer or rewrite the request body — signature verification uses the
  raw bytes.
- Keep `PUBLIC_API_URL` in sync with the public hostname so generated file URLs
  and the dashboard are correct.
- Terminate TLS at the proxy and forward `X-Forwarded-*` headers.

## Production checklist

- [ ] `NODE_ENV=production`.
- [ ] Unique `CREDENTIAL_ENCRYPTION_KEY` generated and stored in a secret manager.
- [ ] Unique `SESSION_PEPPER`.
- [ ] `DATABASE_SSL=ssl` (and pool mode appropriate to the provider).
- [ ] `SLACK_VERIFY_SIGNATURE=true`.
- [ ] `CORS_ORIGINS` limited to the dashboard origin.
- [ ] Seeded admin password changed; `ADMIN_PASSWORD` removed from the runtime env.
- [ ] Provider keys added in the dashboard (encrypted) rather than plaintext env.
- [ ] `pnpm smoke` passes against the target database.
- [ ] Backups enabled for the database and (if local) `STORAGE_LOCAL_DIR`.

## Scaling notes

- The API is stateless apart from Postgres and file storage; run multiple replicas
  behind a load balancer.
- Slack events are de-duplicated via the `processed_events` table, so retries and
  duplicate deliveries are safe.
- For local storage, mount a shared volume across replicas or switch to Supabase.
- Run migrations once (or let one replica apply them) before rolling out others.
