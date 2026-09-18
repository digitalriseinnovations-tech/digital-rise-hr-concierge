import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { getAnthropicClient, CONCIERGE_AI_MODEL } from "./anthropic-client";
import { CONCIERGE_ANTHROPIC_TOOLS } from "./tools";
import { executeTool, type ToolExecutionResult } from "./tool-executor";
import { buildConciergeSystemPrompt } from "./prompt";

/**
 * The reasoning loop: Employee Request → HR Concierge Reasoning →
 * permission-controlled Tool → deterministic knowledge service → grounded
 * response / escalation. This module owns turn orchestration only — it
 * never touches the database except via tool-executor (business writes)
 * and its own conversation/message bookkeeping (audit trail, not business
 * logic).
 */

const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_HISTORY_MESSAGES = 20; // most recent N stored messages used as context

// The four write tools that use the preview -> confirm -> cryptographic-
// token pattern (via confirmation.ts). Used by getPendingConfirmation to
// find the relevant call within a message's tool_calls array — NOT
// necessarily the array's last entry: a real observed case is the model
// calling a supplementary read tool (e.g. get_my_leave_balance, to
// double-check a number before writing its reply) AFTER the actual write-
// tool preview in the same turn, which used to hide the preview from a
// naive "just look at the last entry" check.
const CONFIRMATION_WRITE_TOOL_NAMES = new Set([
  "create_leave_request",
  "request_training_enrollment",
  "create_mentorship_request",
  "create_coaching_request",
  "escalate_to_hr",
]);

export interface ConciergeTurnResult {
  reply: string;
  usedKnowledge: boolean;
  escalated: boolean;
  toolCallSummaries: string[];
}

interface StoredMessage {
  role: "employee" | "assistant" | "system";
  content: string;
}

/** What actually gets persisted into concierge_messages.tool_calls now —
 * structured, not just a display string — specifically so a pending
 * preview/confirmation-token can be recovered deterministically from
 * conversation history (see getPendingConfirmation below) instead of
 * relying on the model to remember and re-derive it. */
export interface StoredToolCall {
  toolName: string;
  output: unknown;
  isError: boolean;
}

async function loadHistory(conversationId: string): Promise<StoredMessage[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("concierge_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);

  if (error || !data) return [];
  return data.map((row) => ({ role: row.role as StoredMessage["role"], content: row.content }));
}

const PENDING_CONFIRMATION_TTL_MS = 15 * 60 * 1000; // 15 minutes
const PENDING_CONFIRMATION_SCAN_LIMIT = 6; // how far back to look for a preview to recover

// Reconstruct the exact input a confirmed call needs from a preview's own
// stored output. Five write tools use this preview/confirm shape today:
// create_leave_request (Slice 3), request_training_enrollment (Slice 4),
// create_mentorship_request / create_coaching_request (Slice 5), and
// escalate_to_hr (Showcase Hardening), all via confirmation.ts.
function reconstructConfirmInput(toolName: string, output: { confirmation_token?: string }): { toolName: string; input: Record<string, unknown> } | null {
  if (toolName === "create_leave_request") {
    const o = output as unknown as { start_date: string; end_date: string; leave_type: string };
    return {
      toolName: "create_leave_request",
      input: { start_date: o.start_date, end_date: o.end_date, leave_type: o.leave_type, confirmed: true, confirmation_token: output.confirmation_token },
    };
  }
  if (toolName === "request_training_enrollment") {
    const o = output as unknown as { program_name: string };
    return {
      toolName: "request_training_enrollment",
      input: { program_name: o.program_name, confirmed: true, confirmation_token: output.confirmation_token },
    };
  }
  if (toolName === "create_mentorship_request") {
    const o = output as unknown as { focus_area: string | null; note: string };
    return {
      toolName: "create_mentorship_request",
      input: { focus_area: o.focus_area ?? undefined, note: o.note, confirmed: true, confirmation_token: output.confirmation_token },
    };
  }
  if (toolName === "create_coaching_request") {
    const o = output as unknown as { note: string };
    return {
      toolName: "create_coaching_request",
      input: { note: o.note, confirmed: true, confirmation_token: output.confirmation_token },
    };
  }
  if (toolName === "escalate_to_hr") {
    const o = output as unknown as { category: string; reason: string };
    return {
      toolName: "escalate_to_hr",
      input: { category: o.category, reason: o.reason, confirmed: true, confirmation_token: output.confirmation_token },
    };
  }
  return null;
}

/**
 * Deterministically recovers a pending write-tool preview from the
 * conversation's own history — NOT from LLM memory. Scans backward through
 * the most recent few assistant messages (not just the single last one):
 * an assistant message with NO tool call at all (a plain informational
 * reply, a clarifying question, or the reconcileReplyWithRealOutcome
 * fallback text below) is transparently skipped, since none of those
 * represent a new topic or a completed/failed action. An EMPLOYEE message
 * is also skipped, but ONLY if it is itself a clear-affirmative repeat
 * (isClearAffirmative) — e.g. the employee saying "yes" again after the
 * false-claim backstop asked them to; a genuinely different employee
 * message (a new question, changed details, anything not a bare "yes")
 * stops the scan and returns null, exactly as before — real conversation
 * turns always alternate employee/assistant, so without this an
 * intervening "yes" that didn't (yet) lead to a real tool call would make
 * the original preview permanently unrecoverable. Scanning otherwise stops
 * (returns null) the moment it hits an assistant message whose last tool
 * call was something OTHER than a fresh preview (a real completion, a
 * failure, or a different write) — that genuinely does invalidate whatever
 * was pending before it. A preview found this way is still subject to the
 * same TTL, measured from ITS OWN timestamp, so a stale preview from long
 * ago can never be silently resurrected.
 */
export async function getPendingConfirmation(
  conversationId: string,
): Promise<{ toolName: string; input: Record<string, unknown> } | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("concierge_messages")
    .select("role, content, tool_calls, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(PENDING_CONFIRMATION_SCAN_LIMIT);

  if (error || !data) return null;

  for (const row of data) {
    if (row.role === "employee") {
      if (isClearAffirmative(row.content)) continue; // a repeated "yes" doesn't invalidate — keep looking further back
      return null; // any other employee message supersedes whatever was pending before it
    }
    if (row.role !== "assistant") continue; // e.g. a 'system' row, if any — inert either way

    if (!Array.isArray(row.tool_calls) || row.tool_calls.length === 0) continue; // no-op turn — keep looking further back

    const calls = row.tool_calls as StoredToolCall[];
    // The relevant call is the LAST write-tool call in this message — NOT
    // necessarily the array's last entry (a trailing read-only call, e.g.
    // a balance re-check made after the actual preview, must not hide it).
    const lastWriteCall = [...calls].reverse().find((c) => CONFIRMATION_WRITE_TOOL_NAMES.has(c.toolName));
    if (!lastWriteCall) continue; // this message only made read-only calls — keep looking further back
    if (lastWriteCall.isError) return null; // a failure invalidates anything pending before it

    const output = lastWriteCall.output as { status?: string; confirmation_token?: string } | null;
    if (!output || output.status !== "preview" || typeof output.confirmation_token !== "string") {
      return null; // a real completion (or anything else non-preview) invalidates anything pending before it
    }

    if (Date.now() - new Date(row.created_at).getTime() > PENDING_CONFIRMATION_TTL_MS) return null;

    return reconstructConfirmInput(lastWriteCall.toolName, output);
  }

  return null;
}

/**
 * A narrow, deliberately conservative deterministic classifier — NOT an
 * LLM call, NOT a generic "contains the word yes somewhere" search. It
 * only matches when the ENTIRE message (trimmed, minor trailing
 * punctuation allowed) is one of a short, curated list of unambiguous
 * affirmations. Anything else — including a message that merely mentions
 * "yes" as part of a longer, more complex reply — deliberately falls
 * through to normal LLM reasoning, which will ask again if it isn't sure.
 * This is intentionally NOT a "yes means execute anything" mechanism: it
 * only ever fires when combined with a genuinely pending, TTL-bounded,
 * cryptographically-tokened preview from getPendingConfirmation above.
 */
export function isClearAffirmative(message: string): boolean {
  // Commas are pure filler in a short confirmation ("yes, go ahead" means
  // exactly what "yes go ahead" means) — stripped before matching so the
  // curated set below doesn't need every comma-punctuated variant spelled
  // out separately.
  const normalized = message.trim().toLowerCase().replace(/[.!]+$/, "").replace(/,/g, "").replace(/\s+/g, " ");
  const AFFIRMATIVES = new Set([
    "yes",
    "yes please",
    "yeah",
    "yep",
    "yup",
    "confirm",
    "confirmed",
    "go ahead",
    "yes go ahead",
    "yes please go ahead",
    "please go ahead",
    "yeah go ahead",
    "sure go ahead",
    "sure",
    "go for it",
    "do it",
    "submit it",
    "submit",
    "please submit",
    "please submit it",
    "yes submit it",
    "yes please submit it",
    "yes please submit",
    "yeah submit it",
    "yes confirm",
    "yes confirmed",
    "yes confirm it",
    "please confirm",
    "please confirm it",
    "sounds good",
    "that works",
    "correct",
    "proceed",
    "ok",
    "okay",
    "ok submit it",
    "okay submit it",
    "ok go ahead",
    "okay go ahead",
  ]);
  return AFFIRMATIVES.has(normalized);
}

function toAnthropicHistory(history: StoredMessage[]): Anthropic.MessageParam[] {
  return history
    .filter((m) => m.role === "employee" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "employee" ? "user" : "assistant",
      content: m.content,
    }));
}

async function persistMessage(
  conversationId: string,
  role: StoredMessage["role"],
  content: string,
  toolCalls?: unknown,
) {
  const supabase = createServiceClient();
  await supabase.from("concierge_messages").insert({
    conversation_id: conversationId,
    role,
    content,
    tool_calls: toolCalls ?? null,
  });
}

async function touchConversation(conversationId: string, turnIncrement: number, escalated: boolean) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("concierge_conversations")
    .select("turn_count")
    .eq("id", conversationId)
    .maybeSingle();

  await supabase
    .from("concierge_conversations")
    .update({
      turn_count: (data?.turn_count ?? 0) + turnIncrement,
      last_activity_at: new Date().toISOString(),
      ...(escalated ? { status: "escalated" } : {}),
    })
    .eq("id", conversationId);
}

/** Deterministic reply text for the fast confirmation path — no LLM call
 * involved in producing this, so its correctness doesn't depend on model
 * sampling at exactly the one moment (the actual submission) where that
 * matters most. */
function buildFastPathReply(result: ToolExecutionResult): string {
  const output = result.output as { status?: string; message?: string; manager_display_name?: string; program_name?: string };
  if (result.toolName === "create_leave_request") {
    if (output.status === "submitted") {
      const manager = output.manager_display_name ? ` to ${output.manager_display_name}` : "";
      return `Your leave request has been submitted${manager} and is now pending approval. I'll let you know once there's a decision.`;
    }
    if (output.status === "already_pending") {
      return "You already have a pending request for these exact dates — no need to submit it again.";
    }
  }
  if (result.toolName === "request_training_enrollment") {
    const program = output.program_name ? ` for ${output.program_name}` : "";
    if (output.status === "requested") {
      return `Your enrollment request${program} has been submitted and is awaiting manager/HR approval. I'll let you know once there's a decision.`;
    }
    if (output.status === "confirmed") {
      return `You're registered${program}. I'll let you know if anything changes.`;
    }
    if (output.status === "waitlisted") {
      return `Seats were full, so you've been waitlisted${program}. I'll let you know if a seat opens up.`;
    }
    if (output.status === "already_registered") {
      return "You already have a registration for this program — no need to submit it again.";
    }
  }
  if (result.toolName === "create_mentorship_request") {
    if (output.status === "submitted") {
      return "Your mentorship request has been logged for HR to follow up on — this isn't an automatic mentor match, a real person will reach out.";
    }
    if (output.status === "already_open") {
      return "You already have an open mentorship request with these exact details — no need to submit it again.";
    }
  }
  if (result.toolName === "create_coaching_request") {
    if (output.status === "submitted") {
      return "Your executive coaching request has been logged for HR to review and confirm eligibility — this isn't a coaching approval.";
    }
    if (output.status === "already_open") {
      return "You already have an open coaching request with these exact details — no need to submit it again.";
    }
  }
  if (result.toolName === "escalate_to_hr") {
    if (output.status === "submitted") {
      return "HR has been notified — a real person will follow up with you directly.";
    }
    if (output.status === "already_open") {
      return "HR has already been notified about this — no need to ask again.";
    }
  }
  return output.message || "Done.";
}

// The five write tools and, for each, which output.status values mean a
// real, completed outcome (as opposed to "preview" — nothing written yet).
// Used only by reconcileReplyWithRealOutcome below.
const COMPLETION_STATUSES: Record<string, readonly string[]> = {
  create_leave_request: ["submitted", "already_pending"],
  request_training_enrollment: ["requested", "confirmed", "waitlisted", "already_registered"],
  create_mentorship_request: ["submitted", "already_open"],
  create_coaching_request: ["submitted", "already_open"],
  escalate_to_hr: ["submitted", "already_open"],
};

// Real-world observed failure (Slice 5 manual showcase run): even with an
// explicit system-prompt rule against it, the model sometimes claims a
// write action completed ("has been submitted", "is now pending", "you're
// registered") in a turn where it made NO tool call at all, or only a
// preview call — a false claim the employee would have no way to detect.
// Prompt wording alone did not reliably prevent this, so this is a
// deterministic, code-level backstop, applied unconditionally to every
// LLM-path turn (the fast path is already 100% tool-result-grounded and
// doesn't need it): if a real completing write happened this turn, the
// reply is ALWAYS replaced with the canonical tool-result-grounded text
// for it (ignoring whatever the model wrote, even if similar) — the
// employee-facing message can then never diverge from what was actually
// recorded. If the reply merely CLAIMS completion with no real completing
// call to back it up, it is replaced with a safe, honest, non-committal
// message instead of ever reaching the employee.
// Deliberately a growing, curated list rather than one clever pattern —
// each addition here is a real phrasing variant observed in live testing
// (most recently "has been sent to HR", which the narrower original
// pattern missed). This can never be exhaustive against arbitrary
// paraphrasing; see the Slice 5 report's known-limitations section.
const FALSE_COMPLETION_CLAIM_PATTERN =
  /\b(has been (submitted|logged|registered|sent|forwarded|shared|passed along)|is now (pending|registered)|you'?re (now )?registered|i'?ve (submitted|logged|registered|sent|forwarded) (it|your|this|that))\b/i;

export function reconcileReplyWithRealOutcome(finalText: string, structuredToolCalls: StoredToolCall[]): string {
  const completingCall = [...structuredToolCalls]
    .reverse()
    .find((call) => {
      if (call.isError) return false;
      const completionStatuses = COMPLETION_STATUSES[call.toolName];
      if (!completionStatuses) return false;
      const status = (call.output as { status?: string } | null)?.status;
      return typeof status === "string" && completionStatuses.includes(status);
    });

  if (completingCall) {
    return buildFastPathReply({ toolName: completingCall.toolName, output: completingCall.output, isError: false, summary: "" });
  }

  if (FALSE_COMPLETION_CLAIM_PATTERN.test(finalText)) {
    console.error("[concierge] blocked a false completion claim with no backing tool call:", finalText);
    return "Let's make sure that's actually been submitted before I confirm anything — could you say \"yes\" or \"confirm\" one more time?";
  }

  return finalText;
}

// Matches two related failure phrasings the model has been observed to
// produce WITHOUT having called the underlying tool: (a) narrating that
// it's ABOUT TO preview/submit/confirm something ("does this look
// correct?", "I'll log this...", "shall I proceed?"), and (b) — the
// harder-to-catch variant, found during Slice 5 manual showcase testing —
// claiming completion outright on the very first attempt ("has been
// logged", "I've submitted it") with no preceding preview stage at all.
// Both only show up when the model believes SOME action is pending or
// done, never in ordinary informational answers, so this is used only to
// decide whether a single forced-tool-use retry is worth attempting (see
// runConciergeTurn) — it never lets text reach the employee unchecked,
// that's still reconcileReplyWithRealOutcome's job as the last line of
// defense if this retry doesn't fix it.
const UNBACKED_ACTION_NARRATION_PATTERN =
  /does this look (correct|good)|shall i (proceed|go ahead)|please confirm|i'?ll (log|submit|prepare|register)|once you confirm|does .* look good|has been (submitted|logged|registered|sent|forwarded|shared|passed along)|is now (pending|registered)|you'?re (now )?registered|i'?ve (submitted|logged|registered|sent|forwarded) (it|your|this|that)/i;

export function looksLikeUnbackedActionNarration(text: string): boolean {
  return UNBACKED_ACTION_NARRATION_PATTERN.test(text);
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Runs one employee turn to completion (including any within-turn tool
 * round-trips) and persists the result. Never lets the model claim a tool
 * action happened without a real executeTool() call having produced it —
 * the only way text ends up in `reply` is either (a) the model's own
 * final text after zero or more real tool calls this function made, or
 * (b) a hard-coded fallback string this function returns itself on error.
 */
export async function runConciergeTurn(params: {
  conversationId: string;
  employeeId: string;
  employeeFirstName: string;
  employeeFullName: string;
  userMessage: string;
}): Promise<ConciergeTurnResult> {
  const { conversationId, employeeId, employeeFirstName, employeeFullName, userMessage } = params;

  // Deterministic confirmation fast-path — checked BEFORE persisting the
  // employee message or calling the model at all. Only fires when BOTH:
  // (a) this exact message is one of a short, curated, unambiguous
  //     affirmative phrases (isClearAffirmative — not a substring search),
  // (b) the immediately preceding assistant turn's last tool call was a
  //     fresh, unexpired preview with a real confirmation_token
  //     (getPendingConfirmation — reads conversation history, not LLM
  //     memory). Anything else — including "yes" buried in a longer or
  //     more nuanced reply — falls through to normal LLM reasoning below,
  //     unchanged. The token itself is still the only thing that actually
  //     authorizes the write; this only makes RECOGNIZING a clear "yes"
  //     reliable instead of leaving that judgment to model sampling.
  if (isClearAffirmative(userMessage)) {
    const pending = await getPendingConfirmation(conversationId);
    if (pending) {
      await persistMessage(conversationId, "employee", userMessage);
      const result = await executeTool(pending.toolName, pending.input, { employeeId, employeeFullName, conversationId });
      const reply = buildFastPathReply(result);
      // escalate_to_hr can now reach this fast path too (Showcase
      // Hardening) — only a real completion (submitted/already_open)
      // counts, never a preview/error.
      const fastPathStatus = (result.output as { status?: string } | null)?.status;
      const escalatedFast =
        result.toolName === "escalate_to_hr" &&
        !result.isError &&
        (fastPathStatus === "submitted" || fastPathStatus === "already_open");
      await persistMessage(conversationId, "assistant", reply, [
        { toolName: result.toolName, output: result.output, isError: result.isError },
      ]);
      await touchConversation(conversationId, 1, escalatedFast);
      return { reply, usedKnowledge: false, escalated: escalatedFast, toolCallSummaries: [result.summary] };
    }
  }

  await persistMessage(conversationId, "employee", userMessage);

  const history = await loadHistory(conversationId);
  const messages: Anthropic.MessageParam[] = [
    ...toAnthropicHistory(history),
    { role: "user", content: userMessage },
  ];

  const client = getAnthropicClient();
  const system = buildConciergeSystemPrompt(employeeFirstName);

  let usedKnowledge = false;
  let escalated = false;
  const toolCallSummaries: string[] = [];
  const structuredToolCalls: StoredToolCall[] = [];
  let finalText = "";
  let forceToolUseNextRound = false;
  let usedNarrationRetry = false;
  // Tokens minted as a fresh PREVIEW earlier in THIS SAME turn's loop — see
  // the confirmed-token interception below.
  const previewTokensMintedThisTurn = new Set<string>();

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: CONCIERGE_AI_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools: CONCIERGE_ANTHROPIC_TOOLS,
        ...(forceToolUseNextRound ? { tool_choice: { type: "any" as const } } : {}),
        messages,
      });
      forceToolUseNextRound = false;

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
        const candidateText = extractText(response.content);
        // Real-world observed failure mode (Slice 5 manual showcase): the
        // model sometimes narrates a preview or asks for confirmation in
        // plain text ("does this look correct?", "I'll log this...")
        // WITHOUT calling the tool that would actually produce a real
        // preview/token — leaving nothing genuine for a later confirmation
        // to complete. Since nothing has been said to the employee yet
        // (finalText is still unset) and nothing was pushed to `messages`,
        // discarding this attempt and retrying once with tool_choice
        // forced is a true no-op if it doesn't help, and directly fixes
        // the failure if it does — bounded to a single retry per turn.
        if (!usedNarrationRetry && round < MAX_TOOL_ROUNDS - 1 && looksLikeUnbackedActionNarration(candidateText)) {
          usedNarrationRetry = true;
          forceToolUseNextRound = true;
          continue;
        }
        finalText = candidateText;
        break;
      }

      // Record the assistant's tool-use turn, then execute every requested
      // tool call through the single fail-closed entry point.
      messages.push({ role: "assistant", content: response.content });

      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        // Structural guarantee (not just a prompt instruction) that a write
        // can never complete within the very same turn its own preview was
        // generated: real-world testing showed the model sometimes chains
        // preview -> confirm together on the employee's FIRST message,
        // skipping the required "wait for their actual yes" checkpoint. If
        // this call's confirmation_token was minted as a preview earlier in
        // THIS turn's loop (not a genuinely earlier, separate turn), force
        // it back to a preview request — the employee always gets a real
        // preview to respond to before anything can be written.
        let input = block.input as Record<string, unknown>;
        if (
          CONFIRMATION_WRITE_TOOL_NAMES.has(block.name) &&
          input?.confirmed === true &&
          typeof input.confirmation_token === "string" &&
          previewTokensMintedThisTurn.has(input.confirmation_token)
        ) {
          input = { ...input, confirmed: false };
        }

        const result: ToolExecutionResult = await executeTool(block.name, input, {
          employeeId,
          employeeFullName,
          conversationId,
        });

        if (CONFIRMATION_WRITE_TOOL_NAMES.has(result.toolName) && !result.isError) {
          const output = result.output as { status?: string; confirmation_token?: string } | null;
          if (output?.status === "preview" && typeof output.confirmation_token === "string") {
            previewTokensMintedThisTurn.add(output.confirmation_token);
          }
        }

        toolCallSummaries.push(result.summary);
        structuredToolCalls.push({ toolName: result.toolName, output: result.output, isError: result.isError });
        // Escalation is now preview -> confirm gated (Showcase Hardening) —
        // a PREVIEW result must not mark the conversation escalated; only a
        // real completion (a fresh submission, or a confirmed retry that
        // reused an existing open request) does.
        if (result.toolName === "escalate_to_hr" && !result.isError) {
          const escalationStatus = (result.output as { status?: string } | null)?.status;
          if (escalationStatus === "submitted" || escalationStatus === "already_open") escalated = true;
        }
        if (
          ["search_hr_knowledge", "get_onboarding_information", "get_mentorship_information", "get_coaching_information"].includes(
            result.toolName,
          ) &&
          !result.isError &&
          typeof result.output === "object" &&
          result.output !== null &&
          (result.output as { found?: boolean }).found === true
        ) {
          usedKnowledge = true;
        }

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result.output),
          is_error: result.isError,
        });
      }

      messages.push({ role: "user", content: toolResultBlocks });

      // If this was the last allowed round, force a final answer instead
      // of silently looping forever or returning nothing.
      if (round === MAX_TOOL_ROUNDS - 1) {
        const closing = await client.messages.create({
          model: CONCIERGE_AI_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages, // no `tools` — force a plain text answer now
        });
        finalText = extractText(closing.content);
      }
    }
  } catch (err) {
    console.error("[concierge] orchestrator error", err);
    finalText =
      "Sorry, something went wrong on my side just now. Please try again, or ask to speak with HR if this keeps happening.";
  }

  if (!finalText) {
    finalText = "I couldn't confirm that from Northstar Global's HR knowledge. Would you like me to connect you with HR?";
  }

  finalText = reconcileReplyWithRealOutcome(finalText, structuredToolCalls);

  await persistMessage(conversationId, "assistant", finalText, structuredToolCalls.length > 0 ? structuredToolCalls : null);
  await touchConversation(conversationId, 1, escalated);

  return { reply: finalText, usedKnowledge, escalated, toolCallSummaries };
}

/** Creates a new conversation row for a session, returning its id. */
export async function startConversation(employeeId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("concierge_conversations")
    .insert({ employee_id: employeeId, channel: "web", status: "active" })
    .select("id")
    .single();

  if (error || !data) {
    // Diagnostic-only, server-side log — narrowly scoped to the Supabase
    // client library's own error shape (message/code/details/hint), never
    // the employee identity, message content, or any credential/token.
    // This is what makes the actual failure visible in Vercel's function
    // logs instead of only ever seeing the generic message thrown below.
    console.error("[concierge] startConversation failed", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    });
    throw new Error("Could not start a new Concierge conversation.");
  }
  return data.id;
}
