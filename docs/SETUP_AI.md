# AI provider setup

HelpDeskAI answers through a provider abstraction. A **primary** provider is
used first; if it fails (network error, rate limit, invalid response), the
**fallback** provider is tried before the bot posts a generic error to Slack.

| Provider | Default model | Vision | Key |
| --- | --- | --- | --- |
| Google Gemini | `gemini-3.5-flash` | Yes | <https://aistudio.google.com/app/apikey> |
| OpenAI | `gpt-4.1-mini` | Yes | <https://platform.openai.com/api-keys> |

At least one provider is required to answer Slack requests. A vision-capable
model is required to analyse screenshots.

## Option A — configure from the dashboard (recommended)

1. Sign in as an admin and open **AI Providers**.
2. Enter the API key, model and base URL for Gemini and/or OpenAI.
3. Choose the primary and fallback providers.
4. Use the provider's **Test** action to confirm connectivity.

Keys entered here are stored encrypted (AES-256-GCM) using
`CREDENTIAL_ENCRYPTION_KEY`, and take precedence over environment variables.

## Option B — configure from the environment

```env
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=openai

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.5-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta

OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

Set `AI_FALLBACK_PROVIDER=none` to disable the fallback.

## Encryption key

Stored provider keys and Slack tokens are encrypted with a 32-byte key. Generate
one and set it before saving any secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

```env
CREDENTIAL_ENCRYPTION_KEY=<base64 of 32 bytes>
```

- In **production** the key is required; the API refuses to start without it.
- In **development** a stable key is derived when none is set, so the stack boots
  without secrets. Never rely on the derived key for anything real.

> Changing `CREDENTIAL_ENCRYPTION_KEY` makes previously stored values
> undecryptable. Re-enter them after rotating the key.

## Vision / screenshots

Screenshots shared in a thread are downloaded, stored, and sent to a
vision-capable model (both defaults above support images). Relevant knobs:

```env
MAX_SCREENSHOTS_PER_MESSAGE=4
MAX_ATTACHMENT_BYTES=8388608
```

## System instructions

The behaviour prompt injected into every request can be edited under
**AI Providers → System instructions**. Each save creates a new version and the
history is tracked with the author and a change note, so you can roll back to a
previous version.

## Knowledge base & solution guides

Solution guides are authored as **knowledge-base articles** (dashboard →
**Knowledge base**). When an article matches the issue, its steps are retrieved
and the model is instructed to follow them **in order, on-script**, instead of
improvising. Write each article as an ordered list of concrete steps with the
expected result; the AI will walk the agent through them one at a time.

To steer a specific session, an admin can pin an article to it (dashboard →
session → **Pin article**), which forces that article into the next reply.

## Quick-reply buttons

When the next question has a small, known set of answers (operating system,
yes/no, which application, which symptom), the model also returns clickable
**options**. The API renders them as Slack buttons; clicking one submits the
choice as the agent's reply. No Slack scope beyond `chat:write` is needed, but
**Interactivity** must be enabled in the Slack app — see `docs/SETUP_SLACK.md`.

## Usage and cost

Every request is logged with provider, model, token counts and an estimated cost.
Open **Dashboard → AI usage** to inspect spend by provider over time, and use the
provider health panel to spot failing keys early.

## How responses are produced

1. Retrieve relevant knowledge-base articles and steps for the thread.
2. Build a structured prompt with the session state, history and screenshots.
3. Ask the primary provider for a JSON result (diagnosis, next steps, whether to
   escalate).
4. Validate the JSON; on failure or provider error, try the fallback.
5. Run the result through the safety guard before it reaches Slack.
6. Persist usage and update session state.

## Troubleshooting

- **"not fully configured" in Slack** — no provider is enabled, or the key is
  missing/invalid. Check **AI Providers** health.
- **Fallback keeps firing** — inspect the primary provider's last error in the
  health panel (bad key, quota, or a blocked model).
- **No screenshot analysis** — the selected model does not support images, or the
  file was too large.
- **Stored key stopped working** — `CREDENTIAL_ENCRYPTION_KEY` changed; re-enter
  the key.
