import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { runConciergeTurn, startConversation, reconcileReplyWithRealOutcome, isClearAffirmative } from "../../src/lib/concierge/orchestrator";
import { executeTool } from "../../src/lib/concierge/tool-executor";
import { computeConfirmationToken } from "../../src/lib/concierge/leave";

/**
 * Production incident: a real employee's confirmed leave submission
 * ("yes" after a correct preview) failed twice, created no database row,
 * and sent no email — traced to an unguarded fetch() inside
 * submitLeaveRequest() (leave.ts), the server-to-server call to
 * /api/leave-submit. A network-level failure there was an uncaught throw,
 * propagating through the deterministic confirmation fast-path (which has
 * no try/catch of its own) and crashing the whole turn instead of
 * producing a safe reply. Fixed with a try/catch + safe diagnostic log in
 * leave.ts, a defense-in-depth try/catch in tool-executor.ts, and
 * corrected messaging that never conflates DB-success with email-success.
 *
 * This file proves the confirmed fast-path itself: preview -> "yes" ->
 * real submission, entirely deterministic. Every runConciergeTurn() call
 * here is expected to take the fast path and therefore never construct a
 * real Anthropic client — if it ever fell through to the LLM path instead,
 * the test-runtime Anthropic guard (anthropic-client.ts) would throw and
 * these tests would fail loudly, not silently pass. That failure mode IS
 * the proof of "no Anthropic call" — no mocking required.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let sarahId: string | null = null;
const createdConversationIds: string[] = [];
const createdLeaveRequestIds: string[] = [];

// Distinctive, unused-elsewhere-in-the-suite date range, to avoid any
// cross-file idempotency-guard collision with other parallel test files
// that also create real Sarah leave requests on their own dates.
const START_DATE = "2027-05-17";
const END_DATE = "2027-05-18";

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id").eq("employee_code", "NSG-1001").single();
  sarahId = data!.id;
});

afterAll(async () => {
  if (!client) return;
  if (createdLeaveRequestIds.length > 0) {
    await client.from("leave_requests").delete().in("id", createdLeaveRequestIds);
  }
  for (const id of createdConversationIds) {
    await client.from("concierge_messages").delete().eq("conversation_id", id);
    await client.from("concierge_conversations").delete().eq("id", id);
  }
});

describe("Leave confirmation — real fast-path integration (Anthropic-safe by construction)", () => {
  it.skipIf(!hasCreds)(
    "preview creates no leave request, then 'yes' executes deterministically (no Anthropic call) and returns a clear submitted/pending response",
    async () => {
      const conversationId = await startConversation(sarahId!);
      createdConversationIds.push(conversationId);

      // Generate the preview deterministically, the same way
      // leave-tool-executor.test.ts does — directly through the tool, not
      // through a live model turn. A natural-language leave request would
      // require the model to decide to call the tool, which needs a real
      // Anthropic call; that's not what this test is proving. What IS
      // being proven here is the deterministic fast-path's own behavior
      // once a preview already exists in conversation history, which is
      // exactly what a real preview turn would have left behind.
      const previewResult = await executeTool(
        "create_leave_request",
        { start_date: START_DATE, end_date: END_DATE, leave_type: "annual", confirmed: false },
        { employeeId: sarahId!, employeeFullName: "Sarah Ahmed", conversationId },
      );
      const previewOutput = previewResult.output as { status: string; confirmation_token: string };
      expect(previewOutput.status).toBe("preview");

      // Persist it exactly as the orchestrator's fast-path/LLM-path would
      // have, so getPendingConfirmation can recover it from history.
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Here is your leave preview...",
        tool_calls: [{ toolName: "create_leave_request", output: previewResult.output, isError: false }],
      });

      const { count: beforeCount } = await client!
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", sarahId!)
        .eq("start_date", START_DATE)
        .eq("end_date", END_DATE);
      expect(beforeCount ?? 0).toBe(0);

      // The ONLY call in this test that goes through the orchestrator.
      // If "yes" fell through to the LLM path instead of the deterministic
      // fast path, getAnthropicClient() would throw under test (the guard
      // is not bypassed anywhere in this file) and this await would
      // reject — the test would fail here, not silently pass.
      const confirmResult = await runConciergeTurn({
        conversationId,
        employeeId: sarahId!,
        employeeFirstName: "Sarah",
        employeeFullName: "Sarah Ahmed",
        userMessage: "yes",
      });

      expect(confirmResult.reply.toLowerCase()).toMatch(/submitted|pending/);

      const { data: rows, count } = await client!
        .from("leave_requests")
        .select("id, status, employee_id, leave_type", { count: "exact" })
        .eq("employee_id", sarahId!)
        .eq("start_date", START_DATE)
        .eq("end_date", END_DATE);
      expect(count).toBe(1);
      expect(rows?.[0]?.status).toBe("pending");
      createdLeaveRequestIds.push(rows![0].id);
    },
    30000,
  );
});

describe("Leave confirmation — transactional messaging honesty", () => {
  it("a successful DB submission with a failed manager email is reported as submitted, never as a failure, and never suggests resubmitting", () => {
    // Exercises the exact same messaging layer (buildFastPathReply, via
    // its exported wrapper) with a fabricated tool result — DB succeeded
    // (status: 'submitted') but the email did not (manager_notified: false).
    const reply = reconcileReplyWithRealOutcome("placeholder", [
      {
        toolName: "create_leave_request",
        isError: false,
        output: {
          status: "submitted",
          leave_request_id: "fake-id-for-message-test",
          manager_notified: false,
          manager_display_name: "Daniel",
        },
      },
    ]);

    expect(reply.toLowerCase()).toMatch(/submitted/);
    // Must not claim failure or invite a resubmission attempt — "no need
    // to submit it again" (a reassurance NOT to retry) is fine and
    // expected; "please try again" / "could not submit" are not.
    expect(reply.toLowerCase()).not.toMatch(/\bfailed\b|could not submit|please try again/);
    expect(reply.toLowerCase()).toContain("no need");
  });

  it("a genuinely successful submission WITH a working email still credits the manager by name, unchanged from before", () => {
    const reply = reconcileReplyWithRealOutcome("placeholder", [
      {
        toolName: "create_leave_request",
        isError: false,
        output: {
          status: "submitted",
          leave_request_id: "fake-id-for-message-test-2",
          manager_notified: true,
          manager_display_name: "Daniel",
        },
      },
    ]);

    expect(reply).toContain("Daniel");
    expect(reply.toLowerCase()).toMatch(/submitted/);
  });
});

describe("Leave confirmation — a failed submission never claims success", () => {
  it.skipIf(!hasCreds)("confirming for a nonexistent employee fails gracefully (status: failed, isError: true) — never status: submitted", async () => {
    const fakeEmployeeId = "00000000-0000-0000-0000-000000000000";
    const details = { employeeId: fakeEmployeeId, startDate: "2027-06-01", endDate: "2027-06-01", leaveType: "annual" as const, daysCount: 1 };
    const token = computeConfirmationToken(details);

    const result = await executeTool(
      "create_leave_request",
      { start_date: "2027-06-01", end_date: "2027-06-01", leave_type: "annual", confirmed: true, confirmation_token: token },
      { employeeId: fakeEmployeeId, employeeFullName: "Nobody", conversationId: "00000000-0000-0000-0000-000000000000" },
    );

    expect(result.isError).toBe(true);
    const output = result.output as { status?: string; message?: string };
    expect(output.status).toBe("failed");
    expect(output.status).not.toBe("submitted");
    expect(output.message?.toLowerCase()).not.toMatch(/\bsubmitted\b/);

    // Confirms nothing was persisted for this fabricated id either.
    const { count } = await client!.from("leave_requests").select("id", { count: "exact", head: true }).eq("employee_id", fakeEmployeeId);
    expect(count ?? 0).toBe(0);
  });
});

describe("Leave confirmation — 'no' does not execute the pending action", () => {
  it("isClearAffirmative rejects 'no' (existing coverage: confirmation-reliability.test.ts) — the fast path structurally cannot fire for it, so no tool is ever invoked and nothing is ever written", () => {
    // This is a documentation/consistency check, not a duplicate of the
    // existing isClearAffirmative unit tests: it exists so this file's own
    // "no cancels" requirement has a visible, explicit assertion here
    // too, without needing a live-model turn to prove a negative.
    expect(isClearAffirmative("no")).toBe(false);
    expect(isClearAffirmative("not yet")).toBe(false);
  });
});
