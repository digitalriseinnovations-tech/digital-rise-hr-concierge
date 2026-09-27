import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { runConciergeTurn, startConversation, reconcileReplyWithRealOutcome, isClearAffirmative } from "../../src/lib/concierge/orchestrator";
import { executeTool } from "../../src/lib/concierge/tool-executor";
import { computeConfirmationToken, verifyConfirmationToken, resolveCurrentManagerAssignment } from "../../src/lib/concierge/leave";
import { resolveManagerEmailDeliveryTarget } from "../../src/lib/email";

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
// SAFETY (TAQA Demo Sprint, Phase 0): a genuinely COMPLETED confirmed
// create_leave_request reaches submitLeaveRequest(), which makes a REAL
// fetch() to NEXT_PUBLIC_SITE_URL + /api/leave-submit — handled by a
// separately running dev server process if one is up, which does not
// have process.env.VITEST/NODE_ENV=test set, so the email test-runtime
// guard would not block a real SMTP send there. Only the two tests that
// actually complete a submission for a REAL employee (Sarah) are gated on
// this — the "nonexistent employee" failure test never reaches
// submitLeaveRequest's fetch at all (getEmployeeEmail returns null
// first), and every other test here is a pure-function/DB-read test.
const liveServerTestsEnabled = process.env.CONCIERGE_ALLOW_LIVE_MODEL_TESTS === "1";
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
  it.skipIf(!hasCreds || !liveServerTestsEnabled)(
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
    // A nonexistent employee resolves to managerEmail: "" (no matching
    // employees row) — the token must be computed against that same
    // resolved value to verify at confirm time.
    const details = { employeeId: fakeEmployeeId, startDate: "2027-06-01", endDate: "2027-06-01", leaveType: "annual" as const, daysCount: 1, managerEmail: "" };
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

/**
 * Manager Routing & Approver Consistency Gate — the production preview
 * displayed "Approver: Neha", which no tool or prompt instruction ever
 * supplied (confirmed by code inspection: the preview output had no
 * manager field at all) — the model invented it. Fixed by making
 * employees.manager_email, via resolveCurrentManagerAssignment(), the
 * single authoritative source for both the preview's displayed approver
 * and the confirmed submission's actual manager, and binding that
 * assignment into the confirmation token so a manager change between
 * preview and "yes" invalidates the token instead of silently redirecting
 * the approval.
 */
describe("Manager Routing — approver display is deterministic, never LLM-generated", () => {
  it.skipIf(!hasCreds)("Sarah's approver resolves deterministically from employees.manager_email, not from any tool the model could improvise", async () => {
    const first = await resolveCurrentManagerAssignment(sarahId!);
    const second = await resolveCurrentManagerAssignment(sarahId!);
    expect(first).toEqual(second);
    expect(first.managerEmail).toBeTruthy();
    expect(first.managerDisplayName).toBeTruthy();
    // Documents the actual current assignment this task investigated —
    // if this ever fails, the underlying employees.manager_email data
    // changed, which is exactly the kind of drift the token-binding fix
    // is designed to make safe (see the "different manager" test in
    // leave.test.ts), not something this specific test should mask.
    expect(first.managerDisplayName).toBe("Daniel");
  });

  it.skipIf(!hasCreds || !liveServerTestsEnabled)("preview's manager_display_name and the confirmed submission's manager come from the same resolution — never independently drift", async () => {
    const conversationId = await startConversation(sarahId!);
    createdConversationIds.push(conversationId);
    const ctx = { employeeId: sarahId!, employeeFullName: "Sarah Ahmed", conversationId };

    const preview = await executeTool(
      "create_leave_request",
      { start_date: "2027-05-20", end_date: "2027-05-20", leave_type: "annual", confirmed: false },
      ctx,
    );
    const previewOutput = preview.output as { manager_display_name: string; manager_assigned: boolean; confirmation_token: string };
    expect(previewOutput.manager_assigned).toBe(true);
    expect(previewOutput.manager_display_name).toBe("Daniel");

    const confirmed = await executeTool(
      "create_leave_request",
      { start_date: "2027-05-20", end_date: "2027-05-20", leave_type: "annual", confirmed: true, confirmation_token: previewOutput.confirmation_token },
      ctx,
    );
    const confirmedOutput = confirmed.output as { status: string; leave_request_id: string; manager_display_name: string };
    expect(confirmedOutput.status).toBe("submitted");
    expect(confirmedOutput.manager_display_name).toBe(previewOutput.manager_display_name);
    createdLeaveRequestIds.push(confirmedOutput.leave_request_id);

    const { data: row } = await client!.from("leave_requests").select("manager_email").eq("id", confirmedOutput.leave_request_id).single();
    const authoritative = await resolveCurrentManagerAssignment(sarahId!);
    expect(row?.manager_email).toBe(authoritative.managerEmail);
  });

  it("a manager change between preview and confirmation invalidates the token — never a silent redirect to a different manager (Phase 4)", () => {
    const base = { employeeId: "emp-x", startDate: "2027-07-01", endDate: "2027-07-01", leaveType: "annual" as const, daysCount: 1, managerEmail: "manager-a@example.test" };
    const previewToken = computeConfirmationToken(base);

    // Same everything, EXCEPT the manager assignment changed in between —
    // exactly what a fresh resolveCurrentManagerAssignment() call at
    // confirm time would produce if HR reassigned the employee mid-
    // conversation.
    const stillVerifiesForOriginalManager = verifyConfirmationToken(previewToken, base);
    const verifiesForNewManager = verifyConfirmationToken(previewToken, { ...base, managerEmail: "manager-b@example.test" });

    expect(stillVerifiesForOriginalManager).toBe(true);
    expect(verifiesForNewManager).toBe(false);
  });
});

describe("Manager Routing — demo notification override (HR_CONCIERGE_DEMO_MANAGER_EMAIL)", () => {
  const ORIGINAL = process.env.HR_CONCIERGE_DEMO_MANAGER_EMAIL;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.HR_CONCIERGE_DEMO_MANAGER_EMAIL;
    else process.env.HR_CONCIERGE_DEMO_MANAGER_EMAIL = ORIGINAL;
  });

  it("with the override set, the email delivery target is the override address, never the real manager's", () => {
    process.env.HR_CONCIERGE_DEMO_MANAGER_EMAIL = "demo-safe-inbox@example.test";
    expect(resolveManagerEmailDeliveryTarget("daniel.carter@northstarglobal.com")).toBe("demo-safe-inbox@example.test");
  });

  it("with no override set, the email delivery target is the real manager's address unchanged", () => {
    delete process.env.HR_CONCIERGE_DEMO_MANAGER_EMAIL;
    expect(resolveManagerEmailDeliveryTarget("daniel.carter@northstarglobal.com")).toBe("daniel.carter@northstarglobal.com");
  });

  it.skipIf(!hasCreds)("the override never leaks into the logical manager assignment — resolveCurrentManagerAssignment (what the UI/preview shows) is completely unaffected by it", async () => {
    process.env.HR_CONCIERGE_DEMO_MANAGER_EMAIL = "demo-safe-inbox@example.test";
    const assignment = await resolveCurrentManagerAssignment(sarahId!);
    expect(assignment.managerEmail).toBe("daniel.carter@northstarglobal.com");
    expect(assignment.managerDisplayName).toBe("Daniel");
    expect(assignment.managerEmail).not.toContain("demo-safe-inbox");
    expect(assignment.managerDisplayName).not.toContain("demo-safe-inbox");
  });
});
