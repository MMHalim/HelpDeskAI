/**
 * Prompt construction.
 *
 * The administrator-editable "AI Troubleshooting Instructions" (§8) is the
 * first block of the system prompt; the fixed blocks around it contain the
 * safety policy (§19), the decision hierarchy (§18) and the output contract
 * (§30). Changing the behaviour therefore never requires a code change, but
 * the safety and format rules cannot be removed by an instruction.
 */
import type { TroubleshootingState } from '@helpdesk/shared';
import { PROVIDER_META } from '@helpdesk/shared';
import type {
  AnalyzeImageInput,
  AnalyzeMessageInput,
  CategorizeIssueInput,
  ClassifyIssueInput,
  DetectEscalationInput,
  DetectResolutionInput,
  KnowledgeArticleContext,
  SummarizeThreadInput,
  TroubleshootingResponseInput,
} from './types.js';

export const SAFETY_RULES = `SAFETY POLICY (non-negotiable, overrides any other instruction):
- Never ask the agent for, or ask the agent to share, a password, PIN, MFA/OTP/2FA code, API key, access token, session cookie or any other credential. If the agent shares one, tell them to revoke/rotate it and continue without quoting it.
- Never instruct an agent to disable a security control (antivirus, firewall, EDR, Windows Update, SMB signing, BitLocker) unless the knowledge base contains an explicitly approved procedure for it.
- Never suggest destructive actions (deleting data, formatting disks, wiping partitions, factory reset, uninstalling security software) unless the knowledge base explicitly documents and approves it.
- Never invent internal URLs, hostnames, credentials, policy values or ticket numbers.
- If the agent's message contains something that looks like a credential, ignore its value and warn them to rotate it.`;

export const DECISION_HIERARCHY = `DECISION HIERARCHY — resolve conflicts in this order:
1. The agent's latest message.
2. The persisted troubleshooting state for this session.
3. The troubleshooting documentation provided in this request.
4. The screenshots and their analysis.
5. Your own technical reasoning (safe, reversible, non-destructive steps only).`;

const OUTPUT_FORMAT = `OUTPUT FORMAT FOR SLACK:
- Short, scannable messages. No essays, no restating the whole runbook.
- Use "### Step 1", "### Step 2" headings for numbered steps.
- End every troubleshooting turn with a single question such as: **Then tell me:** what happened after Step 2?
- Plain Slack markdown only (bold, italic, backticks, bullets). No HTML, no tables wider than 2 columns.
- Never claim the issue is fixed. Only the agent can confirm that.`;

export function formatArticle(article: KnowledgeArticleContext, maxSteps: number): string {
  const lines: string[] = [];
  lines.push(`### Article: ${article.title} (id: ${article.id})`);
  lines.push(`Category: ${article.category} | Priority: ${article.priority}`);
  if (article.issueDescription) lines.push(`Issue: ${article.issueDescription}`);
  if (article.symptoms.length > 0) lines.push(`Symptoms: ${article.symptoms.join('; ')}`);
  lines.push('Documented procedure:');
  if (article.steps.length > 0) {
    for (const step of article.steps.slice(0, maxSteps)) {
      lines.push(`- Step ${step.position}${step.title ? ` — ${step.title}` : ''}: ${step.instruction}`);
      if (step.expectedResult) lines.push(`  - Expected: ${step.expectedResult}`);
      if (step.failureResult) lines.push(`  - If it fails: ${step.failureResult}`);
      if (step.nextStep) lines.push(`  - Then: ${step.nextStep}`);
      if (step.escalationInstructions) lines.push(`  - Escalate when: ${step.escalationInstructions}`);
      if (step.requiresAdminApproval) {
        lines.push('  - NOTE: this step is flagged as requiring explicit administrator approval. Never instruct the agent to perform it; ask them to contact IT instead.');
      }
      if (step.isDestructive) {
        lines.push('  - NOTE: this step is flagged as destructive. Only give it if the agent explicitly asks for it, and warn them about the impact first.');
      }
    }
    if (article.steps.length > maxSteps) {
      lines.push(`- (${article.steps.length - maxSteps} further documented steps exist and may be requested later.)`);
    }
  } else if (article.troubleshootingSteps) {
    lines.push(article.troubleshootingSteps);
  } else {
    lines.push('- (No step-by-step procedure is documented for this article.)');
  }
  if (article.expectedResult) lines.push(`Overall expected result: ${article.expectedResult}`);
  if (article.failureResult) lines.push(`If the whole procedure fails: ${article.failureResult}`);
  if (article.nextStep) lines.push(`Next step: ${article.nextStep}`);
  if (article.escalationInstructions) lines.push(`Escalation instructions: ${article.escalationInstructions}`);
  if (article.notes) lines.push(`Notes: ${article.notes}`);
  if (article.images.length > 0) {
    lines.push(
      `Reference screenshots: ${article.images
        .map((img) => `${img.label || 'image'}${img.description ? ` (${img.description})` : ''}`)
        .join(' | ')}`,
    );
  }
  return lines.join('\n');
}

export function formatState(state: TroubleshootingState): string {
  return [
    `issue: ${state.issue || '(not yet determined)'}`,
    `diagnosis: ${state.diagnosis || '(none)'}`,
    `steps completed: ${state.stepsCompleted.length ? state.stepsCompleted.join(' -> ') : '(none)'}`,
    `steps failed: ${state.stepsFailed.length ? state.stepsFailed.join(' -> ') : '(none)'}`,
    `current step: ${state.currentStep || '(none)'}`,
    `observations: ${state.observations.length ? state.observations.join('; ') : '(none)'}`,
    `possible causes: ${state.possibleCauses.length ? state.possibleCauses.join('; ') : '(none)'}`,
    `status: ${state.resolutionStatus}`,
    `escalation required: ${state.escalationRequired}`,
  ].join('\n');
}

export interface SystemPromptInput {
  instructions: string;
  state: TroubleshootingState;
  attemptCount: number;
  maxAttempts: number;
  articles: KnowledgeArticleContext[];
  maxStepsPerArticle: number;
  knowledgeBaseEmpty: boolean;
  adminDirection: string | null;
  escalationInfoItems: string[];
  agentName: string;
  sessionCode: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const blocks: string[] = [];

  blocks.push(input.instructions.trim());
  blocks.push(SAFETY_RULES);
  blocks.push(DECISION_HIERARCHY);
  blocks.push(OUTPUT_FORMAT);

  blocks.push(
    `SESSION CONTEXT\nSession: ${input.sessionCode}\nAgent: ${input.agentName}\nTroubleshooting attempt: ${input.attemptCount} of a maximum ${input.maxAttempts}.\n${formatState(input.state)}`,
  );

  if (input.articles.length > 0) {
    blocks.push(
      `TROUBLESHOOTING DOCUMENTATION (retrieved for this issue — this is the authoritative company procedure; base your next step on it whenever it applies)\n${input.articles
        .map((article) => formatArticle(article, input.maxStepsPerArticle))
        .join('\n\n')}`,
    );
  } else if (input.knowledgeBaseEmpty) {
    blocks.push(
      'TROUBLESHOOTING DOCUMENTATION\nNo article in the knowledge base matches this issue. You may suggest safe, reversible, non-destructive diagnostic steps from your own technical reasoning, and you must label them as your own suggestion. Stay within the safety policy and recommend escalation if the problem needs privileged access, account changes or anything you cannot verify.',
    );
  } else {
    blocks.push(
      'TROUBLESHOOTING DOCUMENTATION\nNo article was retrieved for this turn. Use the session state, then suggest a safe next diagnostic step, or recommend escalation.',
    );
  }

  if (input.adminDirection) {
    blocks.push(
      `ADMINISTRATOR DIRECTION (follow this, it overrides your own plan for the next reply only)\n${input.adminDirection}`,
    );
  }

  blocks.push(
    `ESCALATION CHECKLIST — include exactly these items when you escalate:\n${input.escalationInfoItems
      .map((item) => `- ${item}`)
      .join('\n')}`,
  );

  return blocks.join('\n\n');
}

/* -------------------------------------------------------------------------- */
/* Operation prompts                                                           */
/* -------------------------------------------------------------------------- */

const BASE_SYSTEM =
  'You are a precise IT troubleshooting analysis engine. You always answer with a single valid JSON object and no surrounding prose, no markdown fences, no commentary.';

export function classificationPrompt(input: ClassifyIssueInput): {
  system: string;
  user: string;
} {
  return {
    system: `${BASE_SYSTEM}

TASK: classify this IT support issue so the right knowledge-base articles can be retrieved.
Return JSON with exactly these keys:
{
  "summary": "one sentence describing the reported problem, max 120 chars",
  "category": "one of: Network, VPN, Hardware, Software, Accounts & Access, Email, Telephony, Printing, Security, Performance, Remote Access, Other",
  "keywords": ["up to 10 short lowercase keywords for search"],
  "errorCodes": ["exact error codes or messages visible in the text, [] if none"],
  "applications": ["application or product names mentioned, [] if none"],
  "urgency": "low | normal | high | critical",
  "confidence": 0.0
}`,
    user: [
      input.messageText ? `AGENT MESSAGE:\n${input.messageText}` : '',
      input.threadContext ? `EARLIER THREAD CONTEXT:\n${input.threadContext}` : '',
      input.screenshotSummaries?.length
        ? `SCREENSHOT ANALYSIS:\n${input.screenshotSummaries.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export function imageAnalysisPrompt(input: AnalyzeImageInput): { system: string; user: string } {
  const references = input.referenceImages.length
    ? input.referenceImages
        .map(
          (ref, index) =>
            `Reference image ${index + 1}: id=${ref.id}, label="${ref.label}", description="${
              ref.description || 'none'
            }"`,
        )
        .join('\n')
    : 'No reference images are available for comparison.';

  return {
    system: `${BASE_SYSTEM}

TASK: read the attached screenshot from an IT support agent.
- Transcribe every readable error message, dialog title, error code, URL and application name EXACTLY as shown.
- If the screenshot is unreadable, blank, too small, or you cannot identify the problem, set "readable": false and explain in "unreadableReason". Never guess or invent content you cannot see.
- Compare it with the reference images and report which one it matches, if any.

Return JSON with exactly these keys:
{
  "summary": "2-3 sentence factual description of what the screenshot shows",
  "readable": true,
  "unreadableReason": null,
  "application": "application/product name or null",
  "osHint": "operating system or version hint or null",
  "errorCodes": ["exact codes visible"],
  "errorMessages": ["exact messages visible, transcribed"],
  "uiState": "short description of the UI state (e.g. 'login dialog with error banner') or null",
  "matches": [{"referenceId": "id from the reference list or empty string", "label": "label of the matching reference", "confidence": 0.0, "reason": "why it matches"}],
  "confidence": 0.0,
  "notes": ["anything else an IT technician would need"]
}`,
    user: `REFERENCE IMAGES AVAILABLE FOR COMPARISON:\n${references}\n\nCONTEXT FROM THE CONVERSATION:\n${input.context}`,
  };
}

export function messageAnalysisPrompt(input: AnalyzeMessageInput): { system: string; user: string } {
  return {
    system: `${BASE_SYSTEM}

TASK: analyse the agent's latest message against the troubleshooting state.
Return JSON with exactly these keys:
{
  "observations": ["short factual observations, each <= 160 chars"],
  "stepOutcomes": [{"step": "the step the agent refers to", "outcome": "completed | failed | partial | unknown", "note": "why"}],
  "newInformation": ["facts we did not know before"],
  "resolution": {"detected": false, "confidence": 0.0, "evidence": "the exact words that indicate the issue is fixed"},
  "escalation": {"required": false, "confidence": 0.0, "reason": "why escalation is needed"},
  "agentNeedsEscalation": false,
  "summary": "one sentence describing where the troubleshooting stands"
}
Rules:
- "resolution.detected" is true only for explicit confirmations such as "it's working now", "fixed", "solved", "problem resolved", "everything is working". Statements like "I restarted it" are NOT resolution.
- "escalation.required" is true when the agent explicitly asks for a human/IT, when the issue needs privileges the agent cannot have, or when the same failure has repeated ${input.attemptCount} of ${input.maxAttempts} allowed attempts.`,
    user: `TRoubleshooting STATE:\n${formatState(input.state)}\n\nATTEMPT ${input.attemptCount} OF ${input.maxAttempts}\n\nRECENT THREAD:\n${input.threadTranscript || '(no earlier replies)'}\n\nAGENT'S LATEST MESSAGE:\n${input.messageText}`,
  };
}

export function resolutionPrompt(input: DetectResolutionInput): { system: string; user: string } {
  return {
    system: `${BASE_SYSTEM}

TASK: decide whether the agent has explicitly confirmed the issue is resolved.
Return JSON: {"resolved": true|false, "confidence": 0.0, "evidence": "quote or empty string"}
- Only explicit confirmations count ("it's working now", "fixed", "solved", "that worked", "all good now", "problem resolved").
- "I tried that" or "still broken" or a question is NOT a confirmation.`,
    user: `THREAD:\n${input.threadTranscript || '(none)'}\n\nLATEST MESSAGE:\n${input.messageText}`,
  };
}

export function escalationPrompt(input: DetectEscalationInput): { system: string; user: string } {
  return {
    system: `${BASE_SYSTEM}

TASK: decide whether this troubleshooting session must be escalated to a human IT technician.
Return JSON: {"escalate": true|false, "confidence": 0.0, "reason": "one sentence"}
Escalate when:
- the escalation threshold has been reached (attempt ${input.attemptCount} of ${input.maxAttempts});
- the agent explicitly asked for a human;
- the fix requires account privileges, server-side changes, hardware replacement, security-sensitive actions or credentials the agent must not share;
- the symptoms are dangerous (security incident, data loss, suspected malware).`,
    user: `TRoubleshooting STATE:\n${formatState(input.state)}\n\nAGENT'S LATEST MESSAGE:\n${input.messageText || '(none)'}${
      input.reason ? `\n\nSYSTEM NOTE: ${input.reason}` : ''
    }`,
  };
}

export function categorizationPrompt(input: CategorizeIssueInput): {
  system: string;
  user: string;
} {
  const choices = input.choices
    .map(
      (choice) =>
        `- id=${choice.id} | ${choice.categoryName} > ${choice.name} | typical priority: ${choice.priorityLevel} | ${choice.description}`,
    )
    .join('\n');

  return {
    system: `${BASE_SYSTEM}

TASK: file this RESOLVED IT troubleshooting issue under exactly one sub-category, for reporting on which issues the support desk receives most often.
You may only use the ids listed below. Never invent a category or invent an id.

ALLOWED SUB-CATEGORIES:
${choices || '- (none available)'}

Return JSON with exactly these keys:
{
  "subcategoryId": "the id of the single best matching sub-category",
  "confidence": 0.0,
  "rationale": "one short sentence explaining the choice"
}

RULES:
- Pick exactly ONE sub-category: the root cause that had to be fixed, not the symptom that was reported.
- Judge on what actually happened, using the knowledge-base article that solved it when there was one.
- When two sub-categories are plausible, choose the one describing the underlying fault (e.g. an agent who cannot send chat messages because the workstation is frozen is "Freshchat Lagging / Freezing", not "Message Delivery Failures"; a network outage that also drops calls is "Internet Connectivity Issues" when connectivity itself was the fault).
- Set "confidence" low when the issue does not fit any listed sub-category; never guess to appear certain.`,
    user: [
      `ISSUE TITLE:\n${input.issueTitle || '(not set)'}`,
      `ISSUE SUMMARY:\n${input.issueSummary || '(none)'}`,
      input.diagnosis ? `DIAGNOSIS:\n${input.diagnosis}` : '',
      input.articlesUsed.length ? `KNOWLEDGE-BASE ARTICLES USED:\n${input.articlesUsed.map((a) => `- ${a}`).join('\n')}` : '',
      `AGENT'S CONFIRMATION:\n${input.agentMessage}`,
      input.threadTranscript ? `THREAD:\n${input.threadTranscript}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export function troubleshootingResponsePrompt(input: TroubleshootingResponseInput): {
  system: string;
  user: string;
} {
  return {
    system: `You are responding to an IT support agent inside a Slack thread.

TASK: decide what to say next, and update the structured troubleshooting state.

You MUST return a single valid JSON object with exactly these keys:
{
  "reply": "the Slack message, markdown, concise",
  "state": {
    "issue": "short description of the issue",
    "diagnosis": "current best diagnosis",
    "stepsCompleted": ["steps that succeeded"],
    "stepsFailed": ["steps that failed, with the observed failure"],
    "currentStep": "the step the agent is being asked to do now, or empty",
    "observations": ["new facts learned"],
    "possibleCauses": ["candidate causes, most likely first"],
    "resolutionStatus": "in_progress | resolved | escalated | abandoned",
    "escalationRequired": false
  },
  "resolutionDetected": false,
  "escalationDetected": false,
  "escalationReason": null,
  "kbArticleIds": ["ids of the documentation articles you actually used"],
  "usedDocumentation": true,
  "nextStepTitle": "title of the step you asked for, or null",
  "internalNotes": "short private note for the dashboard, never shown in Slack",
  "options": [
    { "label": "short button text (max 75 chars)", "value": "the agent's reply when this button is clicked" }
  ]
}

BEHAVIOUR:
- Give ONE logical step (or at most two tightly-coupled steps) per reply, then ask what happened.
- Never repeat a step from state.stepsFailed unless you have a specific, new reason; if you do, explain why in one clause.
- If the documentation covers the issue, follow its steps IN ORDER, stay on-script, and set usedDocumentation to true and include its id in kbArticleIds. Do not improvise around a documented procedure.
- If the documentation does not cover the issue, keep helping with safe diagnostic steps and set usedDocumentation to false, kbArticleIds to [].
- If the agent confirms it is fixed, set resolutionDetected true, state.resolutionStatus "resolved", and make the reply a short thank-you (do not add new steps).
- If the issue must go to a human, set escalationDetected true, state.resolutionStatus "escalated", state.escalationRequired true, and write a reply that states the situation, lists the required information as bullets, and ends with a clear status line.
- Never invent company-specific URLs, hostnames, credentials or policies.
- If a screenshot could not be read reliably, say so and ask the agent for the exact text of the error instead of guessing.
- QUICK-REPLY OPTIONS (this field is REQUIRED and must always be present): whenever your reply ends in a question whose answer is one of a small, known set of choices, you MUST fill "options" with 2-5 choices. Examples that ALWAYS get options: the operating system (Windows 10/11, macOS, Linux, Other), yes/no confirmations, which of a few applications, which of a few symptoms. Each option's "label" is the button text (<=75 chars) and "value" is the answer sent back when clicked (usually the same as the label). The choices are the AGENT'S possible answers, never shell commands for the agent to run.
- YES/NO RULE: any question that asks whether something is true, happened, or worked (e.g. "Did reloading fix it?", "Is the laptop still frozen?", "Does it happen in another browser?") MUST get exactly two options labelled "Yes" and "No".
- HARD RULE: if your "reply" contains a question mark ("?"), "options" MUST be a non-empty array. The only questions allowed to have empty options are pure free-form requests where no small answer set exists (e.g. "paste the exact error text", "describe what you see").
- When you provide options, ask ONE clear question in "reply" so the buttons map unambiguously to the answer.
- Return an EMPTY "options" array ONLY for free-form questions (the agent must run a command, paste an error, or describe something) or when you are confirming resolution/escalating. Never omit the key.
- OUTPUT FORMAT: respond with ONLY the JSON object. The Slack message text MUST be under the exact key "reply". Never use alternative key names such as "slack_message", "message" or "text". Do not add prose, explanations or markdown fences around the JSON. Keep "reply" concise so the whole object fits in the token budget.`,
    user: [
      `SESSION ${input.sessionCode} (attempt ${input.attemptCount} of ${input.maxAttempts})`,
      `AGENT: ${input.agentName}`,
      `PERSISTED STATE:\n${formatState(input.state)}`,
      `RECENT THREAD:\n${input.threadTranscript || '(no earlier replies)'}`,
      input.screenshotAnalyses.length
        ? `SCREENSHOT ANALYSIS:\n${input.screenshotAnalyses
            .map(
              (analysis) =>
                `- ${analysis.summary}\n  readable=${analysis.readable}${
                  analysis.errorMessages.length ? `\n  messages: ${analysis.errorMessages.join(' | ')}` : ''
                }${analysis.errorCodes.length ? `\n  codes: ${analysis.errorCodes.join(' | ')}` : ''}${
                  analysis.matches.length
                    ? `\n  matches documentation image: ${analysis.matches
                        .map((m) => `${m.label} (${Math.round(m.confidence * 100)}%)`)
                        .join(', ')}`
                    : ''
                }${analysis.unreadableReason ? `\n  unreadable: ${analysis.unreadableReason}` : ''}`,
            )
            .join('\n')}`
        : '',
      input.adminDirection ? `ADMINISTRATOR DIRECTION:\n${input.adminDirection}` : '',
      `AGENT'S LATEST MESSAGE:\n${input.agentMessage}`,
      `Respond with JSON only.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  };
}

export function summarizePrompt(input: SummarizeThreadInput): { system: string; user: string } {
  return {
    system: 'Summarise an IT troubleshooting conversation for a colleague picking the ticket up. Plain text, no preamble, max 120 words: the issue, what was tried, the result, and the current state.',
    user: input.transcript,
  };
}

export function providerLabel(provider: 'gemini' | 'openai'): string {
  return PROVIDER_META[provider].label;
}
