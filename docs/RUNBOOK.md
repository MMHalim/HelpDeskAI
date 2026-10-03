# Runbook

Operational procedures for HelpDeskAI. Commands assume the repository root.

## Health & monitoring

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Liveness — returns `{ status: "ok" }`. |
| `GET /api/health` | Readiness — includes `database: true/false`, environment and version. |

Dashboard surfaces for triage:

- **Dashboard** — session volume, resolution rate, escalation count, AI spend.
- **Sessions** — every troubleshooting session, its state, attempts and transcript.
- **Escalations** — open and historical handovers with collected details.
- **Logs** — filterable application logs by category and level.
- **Audit** — who changed settings, users, providers or knowledge base.

Recommended alerts:

- `GET /api/health` returns non-200 or `database:false`.
- AI provider health shows a persistent `lastError`.
- Sustained spike in escalations or fallback-provider usage.
- 5xx rate on `/slack/events` or `/api/*`.

## Routine tasks

### Apply migrations

```bash
pnpm db:migrate
```

(The API also applies pending migrations on startup.)

### Create/refresh the admin seed

```bash
pnpm db:seed
```

Idempotent: creates the admin if missing and upserts starter articles.

### Rotate the credential encryption key

1. Generate a new key:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. Because stored secrets become undecryptable, re-enter them after rotating:
   - **Settings → Slack → Credentials**
   - **AI Providers**
3. Update `CREDENTIAL_ENCRYPTION_KEY` in the secret store and restart the API.

### Clear application logs

Use **Logs → Clear** in the dashboard, or:

```bash
curl -X DELETE -b cookies.txt https://<host>/api/analytics/logs
```

Sessions are purged automatically every hour; expired dashboard sessions are
removed by the same job.

### Backups

- Back up the PostgreSQL database (sessions, knowledge base, settings, usage).
- If `FILE_STORAGE=local`, back up `STORAGE_LOCAL_DIR`.
- If `FILE_STORAGE=supabase`, rely on the bucket's backup/versioning policy.

## Incident playbooks

### The bot does not respond in Slack

1. Check `GET /api/health` — if the database is down, fix that first.
2. In **Logs**, filter category `slack`:
   - `Rejected Slack request` → signature/timestamp problem (see below).
   - No entries at all → Slack is not reaching the API. Verify the Request URL,
     DNS and HTTPS, and that the proxy does not rewrite the body.
3. Confirm the channel is in **Settings → Slack → Monitored channels** and the
   bot is invited to it.
4. Confirm the reaction matches the trigger emoji.
5. Confirm a provider is configured and healthy under **AI Providers**.

### Slack requests rejected with 401

- The signing secret does not match the app, or the request is older than
  `SLACK_SIGNATURE_MAX_AGE_SECONDS` (clock skew / replay).
- Re-copy the **Signing Secret** into Settings (or `SLACK_SIGNING_SECRET`) and
  ensure the host clock is synchronized (NTP).
- Never set `SLACK_VERIFY_SIGNATURE=false` in production.

### AI provider failing / outage

1. Open **AI Providers** and read `lastError` for the primary provider.
2. Symptoms and fixes:
   - `401/403` — invalid or revoked key; re-enter it.
   - `429` — quota/rate limit; the fallback provider is used automatically.
   - Timeouts — check outbound network access to the provider base URL.
3. If the primary is down and the fallback is configured, the bot keeps working;
   switch the primary when service is restored.
4. If both are down, Slack receives the generic safe error message. Monitor the
   **AI usage** panel to confirm recovery.

### Database unavailable / migration failure

1. `GET /api/health` shows `database:false`.
2. Confirm `DATABASE_URL`, pool mode and TLS settings still match the provider.
3. If startup fails with a migration error, run `pnpm db:migrate` manually and read
   the error — a migration may need `pg_trgm`/extension privileges.
4. Restore from backup if the database is corrupted, then re-run `pnpm db:migrate`.

### Disk full (local storage)

- Symptom: screenshot/KB image uploads fail; log writes may fail.
- Check `STORAGE_LOCAL_DIR` usage; storage is content-addressed so identical files
  are de-duplicated, but screenshots accumulate.
- Free space or migrate to `FILE_STORAGE=supabase`, then restart the API.

### Elevated escalations or fallback usage

- Review **Escalations** for common issues and add missing articles to the
  knowledge base (**Knowledge → Import**).
- Review **Sessions → AI usage** for token/cost anomalies.
- Tighten or expand retrieval with `KB_MAX_ARTICLES` / `KB_MAX_STEPS` and the
  troubleshooting thresholds.

## Useful commands

```bash
pnpm smoke                      # in-process HTTP smoke test against the target DB
pnpm --filter @helpdesk/api test  # unit tests
pnpm typecheck                  # type-check all packages
pnpm --filter @helpdesk/api start # run the compiled API
```

## Escalation contacts

Record the on-call owner for the API, the database and the Slack app here in your
own copy of this runbook.
