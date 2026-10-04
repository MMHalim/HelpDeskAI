/**
 * Slack reply text composition.
 *
 * Kept free of database and environment imports so it can be unit-tested in
 * isolation (see tests/greeting.test.ts).
 */

/** Slack user mention for a member id, or an empty string when unknown. */
export function slackMention(userId: string | null | undefined): string {
  return userId ? `<@${userId}>` : '';
}

/** A leading greeting plus the person's name, e.g. "Hi Halim, " or "Hello! ". */
const LEADING_GREETING =
  /^(hi|hello|hey|good\s+(?:morning|afternoon|evening))\b[\s,]*[A-Za-z\u00C0-\u024F .'-]{0,40}?[!,.:]?\s+/i;

/**
 * Greets the agent with a real Slack mention inside the greeting ("Hi <@U1> I
 * can help with that") instead of a bare mention in front of a greeting the
 * model already wrote ("<@U1> Hi Halim, ..."). Replies without a greeting keep
 * the plain leading mention so the notification is never lost.
 */
export function buildGreetingReply(text: string, mention: string): string {
  if (!mention) return text;
  const match = LEADING_GREETING.exec(text);
  if (!match) return `${mention} ${text}`;
  const greeting = match[1] ?? 'Hi';
  const rest = text.slice(match[0].length);
  return rest ? `${greeting} ${mention} ${rest}` : `${greeting} ${mention}`;
}