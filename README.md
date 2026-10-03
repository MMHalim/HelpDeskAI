# HelpDeskAI

Slack-first IT troubleshooting bot for remote customer-support agents. An agent
reacts to a message with `:troubleshoot:`, the bot keeps the whole conversation
inside the Slack thread, analyses screenshots, draws on a curated knowledge base,
and either walks the agent to a resolution or escalates to IT with the details
already collected.

A React admin dashboard lets IT staff curate the knowledge base, watch sessions
and escalations, inspect logs, and manage AI providers, Slack configuration and
users.

## Architecture

| Package | Stack | Responsibility |
| --- | --- | --- |
| `packages/shared` | TypeScript + Zod | Cross-cutting enums, contracts/DTOs, safety patterns, default prompts. Consumed by both apps. |
| `apps/api` | Fastify 5, Drizzle ORM, PostgreSQL | Slack Events API, troubleshooting state machine, AI provider abstraction, knowledge base, storage, auth, analytics. |
| `apps/web` | React 19, Vite 6, Tailwind CSS 4, TanStack Query 5, React Router 7 | Admin dashboard. |

```text
Slack (Events API) ──POST /slack/events──▶ apps/api ──▶ PostgreSQL
                                              │  ├── AI providers (Gemini / OpenAI)
                                              │  ├── Knowledge base (Postgres full-text + trigram)
                                              │  └── File storage (local disk or Supabase Storage)
React dashboard (apps/web) ──/api/*──▶ apps/api
```

## Requirements

- Node.js **>= 20.11**
- pnpm **>= 9** (`packageManager` is pinned to `pnpm@11.6.0`)
- PostgreSQL **>= 14** (local, managed, or Supabase)
- A Slack app (see [docs/SETUP_SLACK.md](docs/SETUP_SLACK.md))
- An AI provider key — Gemini and/or OpenAI (see [docs/SETUP_AI.md](docs/SETUP_AI.md))

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure the environment
cp .env.example .env
#   - set DATABASE_URL (required)
#   - optionally set SLACK_* and GEMINI_*/OPENAI_* (can also be set later in the dashboard)

# 3. Create the schema and an admin user (idempotent)
pnpm db:migrate
pnpm db:seed

# 4. Run the API and the dashboard together
pnpm dev
```

| Service | URL |
| --- | --- |
| API | http://localhost:4000 |
| Health check | http://localhost:4000/api/health |
| Admin dashboard | http://localhost:5173 |
| Default admin | `admin@example.com` / `ChangeMe_Admin_2026!` |

> Change the seeded admin password immediately, and generate a real
> `CREDENTIAL_ENCRYPTION_KEY` before storing any provider keys (see below).

## Scripts

Run from the repository root:

| Command | Description |
| --- | --- |
| `pnpm dev` | Run API and dashboard in parallel. |
| `pnpm dev:api` / `pnpm dev:web` | Run a single app. |
| `pnpm build` | Build shared, then API, then the dashboard. |
| `pnpm typecheck` | Type-check every workspace package. |
| `pnpm test` | Run the API unit tests (Vitest). |
| `pnpm test:watch` | Watch mode. |
| `pnpm check` | `typecheck` + `test`. |
| `pnpm db:migrate` | Apply Drizzle SQL migrations. |
| `pnpm db:generate` | Generate a new migration from `schema.ts`. |
| `pnpm db:seed` | Create the admin user and starter knowledge-base articles. |
| `pnpm db:studio` | Open Drizzle Studio. |
| `pnpm smoke` | Boot the app in-process and assert core HTTP behaviour. |
| `pnpm format` | Format each package with its configured formatter. |

## Core behaviour

- **Trigger** — a reaction with `SLACK_TRIGGER_EMOJI` (default `:troubleshoot:`),
  an `@mention` (when enabled), or a message inside an existing troubleshooting
  thread. A Slack message is acknowledged immediately; work happens inline.
- **Thread-only** — the bot never starts a new conversation; all replies go back
  into the originating thread.
- **Thread state** — every session tracks attempts, collected information,
  analysis results, screenshots and resolution/escalation status.
- **Screenshots** — Slack files are downloaded, validated, stored (content
  addressed), and passed to a vision-capable model.
- **Knowledge base** — articles are ingested from the dashboard (Markdown, plain
  text or PDF), parsed into symptoms and steps, and retrieved with weighted
  Postgres full-text search plus trigram similarity. Only relevant articles and
  steps are sent to the model.
- **AI** — a provider abstraction with Gemini primary / OpenAI fallback,
  structured JSON output, retries, per-attempt usage tracking, and encrypted
  keys at rest. If primary fails, the fallback is tried before surfacing a safe
  error to Slack.
- **Escalation** — after the attempt budget is exhausted, or on an escalation
  request, a handover summary is produced with the configured required info
  items.
- **Analytics** — dashboard metrics for sessions, resolution rate, escalations,
  AI usage/cost by provider, and a filterable log and audit trail.

## Security & safety

- Slack request signatures are verified on the raw request body (`SLACK_VERIFY_SIGNATURE`).
- Destructive or security-disabling instructions are blocked by an
  independent safety layer (`apps/api/src/modules/ai/guard.ts`), not just by prompt.
- Credential-like values are redacted from logs and from messages sent to AI providers.
- Provider keys and Slack tokens are encrypted at rest with `CREDENTIAL_ENCRYPTION_KEY`.
- The dashboard uses httpOnly cookie sessions with a configurable TTL.
- Rate limiting is applied globally and separately to Slack events.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for production hardening and
[docs/RUNBOOK.md](docs/RUNBOOK.md) for operations.

## Documentation

- [docs/SETUP_SLACK.md](docs/SETUP_SLACK.md) — create and configure the Slack app.
- [docs/SETUP_AI.md](docs/SETUP_AI.md) — configure Gemini and/or OpenAI.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — environment reference and deployment.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — health, troubleshooting and routine tasks.
