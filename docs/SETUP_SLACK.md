# Slack setup

This guide creates the Slack app that drives HelpDeskAI and wires it to the API.
You can configure Slack either through environment variables (`.env`) or through
the dashboard **Settings → Slack** page. Values saved in the dashboard override
the environment defaults.

## 1. Create the app

1. Go to <https://api.slack.com/apps> and choose **Create New App → From scratch**.
2. Pick a workspace and a name (e.g. `HelpDeskAI`).

## 2. Bot token scopes

Open **OAuth & Permissions → Scopes → Bot Token Scopes** and add:

| Scope | Why |
| --- | --- |
| `chat:write` | Post replies into threads. |
| `reactions:read` | Receive `reaction_added` events (the trigger). |
| `reactions:write` | Optional — for the bot to add its own reaction. |
| `files:read` | Download screenshots shared in threads. |
| `users:read` | Resolve usernames for logging/analytics. |
| `channels:history` | Read messages in public channels. |
| `groups:history` | Read messages in private channels. |
| `im:history` | Read direct messages (if enabled). |
| `mpim:history` | Read group direct messages (if enabled). |

## 3. Event subscriptions

Open **Event Subscriptions**, toggle **Enable Events** on, and set the
**Request URL** to:

```text
https://<your-api-host>/slack/events
```

The URL must be reachable from Slack and served over HTTPS in production. The
API verifies the signing secret on the raw body, so do not put a body-rewriting
proxy in front of it. Slack sends a `url_verification` challenge first; the API
answers it automatically.

Subscribe to these **bot events**:

```text
reaction_added
app_mention
message.channels
message.groups
message.im
message.mpim
file_shared
file_created
file_change
```

`reaction_added` is the primary trigger; the message and file events keep the
thread in sync and deliver screenshots.

## 3.1 Interactivity (quick-reply buttons)

Clarifying questions can be answered with one click. Open **Interactivity &
Shortcuts**, toggle **Interactivity** on, and set the **Request URL** to:

```text
https://<your-api-host>/slack/interactions
```

No extra scopes are required — `chat:write` also covers the `chat.update` call
used to clear the buttons once an option is chosen. The API acknowledges the
interaction immediately and feeds the clicked option back into the session as
the agent's reply, so the conversation continues exactly as if the text had been
typed. Re-install the app after enabling interactivity so the new setting is
applied.

## 4. Install and copy credentials

1. **Install App → Install to Workspace**, then authorize.
2. From **OAuth & Permissions**, copy the **Bot User OAuth Token** (`xoxb-…`).
3. From **Basic Information → App Credentials**, copy the **Signing Secret**.

Put them in `.env`:

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

…or paste them into the dashboard under **Settings → Slack → Credentials**.
Dashboard-stored values are encrypted with `CREDENTIAL_ENCRYPTION_KEY`.

> `SLACK_APP_TOKEN` (`xapp-…`) is only needed if you run Socket Mode instead of
> the Events API. The default deployment uses the HTTP Events API.

## 5. Add the bot to channels and record channel IDs

Invite the bot to every channel it should monitor:

```text
/invite @HelpDeskAI
```

Record the channel ID for each (**channel name → right-click → Copy link** — the
ID is the trailing `C0…` segment, or use **View channel details → About**).

Configure monitored channels in `.env`:

```env
SLACK_CHANNELS=C0123ABCD,C0456EFGH
```

…or manage them on the dashboard **Settings → Slack → Monitored channels**.
Channels can be individually enabled/disabled. An empty list means the bot
ignores every channel.

## 6. Behaviour switches

| Setting | Env var | Default | Effect |
| --- | --- | --- | --- |
| Trigger emoji | `SLACK_TRIGGER_EMOJI` | `:troubleshoot:` | Reaction that starts a session. |
| Mention triggers | `SLACK_ENABLE_MENTIONS` | `false` | Also start on `@HelpDeskAI`. |
| Allowed users | `SLACK_ALLOWED_USERS` | empty (everyone) | Restrict who can trigger the bot. |
| Verify signatures | `SLACK_VERIFY_SIGNATURE` | `true` | Never disable in production. |
| Signature max age | `SLACK_SIGNATURE_MAX_AGE_SECONDS` | `300` | Anti-replay window. |

The dashboard also exposes thread-only replies and secret redaction toggles.

## 7. Try it

1. In a monitored channel, post an issue, e.g. *"My VPN won't connect, error 809"*.
2. Add the `:troubleshoot:` reaction.
3. The bot replies in a thread, asks for details, and requests a screenshot if needed.
4. When the bot asks a question with a small set of answers (OS, yes/no, which
   app), click one of the buttons instead of typing.
5. Continue in the thread; reply with `resolved`, `fixed`, or `it works` to close
   the session, or ask to **escalate** to hand it to IT.

## Troubleshooting the integration

- **`url_verification` fails / URL not saved** — the API is not reachable from
  Slack. Confirm `PUBLIC_API_URL` is correct and the host is public HTTPS.
- **Requests rejected with 401** — the signing secret does not match, or the
  request is older than `SLACK_SIGNATURE_MAX_AGE_SECONDS`. Confirm
  `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET` belong to the same app.
- **Bot never replies** — check that the channel is in `SLACK_CHANNELS` (or the
  dashboard), the bot is invited, and the reaction matches `SLACK_TRIGGER_EMOJI`.
- **No screenshot analysis** — `files:read` is missing, or the file exceeds
  `MAX_ATTACHMENT_BYTES`.
- **Buttons do nothing / `dispatch_failed`** — Interactivity is off, the Request
  URL is wrong, or the app was not re-installed after enabling interactivity.
  Confirm `https://<your-api-host>/slack/interactions` returns `200` when posted
  with a `payload` form field.
- **Escalation does not @mention anyone** — add the technician's member ID
  (`U0…`) under **Settings → Escalation → Notify & mention Slack user IDs**.
