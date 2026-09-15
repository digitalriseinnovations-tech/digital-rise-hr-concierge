import { describe, expect, it } from "vitest";
import { reconcileReplyWithRealOutcome, type StoredToolCall } from "../../src/lib/concierge/orchestrator";

/**
 * Slice 5 hardening — a real, repeatedly-observed failure mode during
 * manual showcase testing: the model claimed a write action completed
 * ("has been submitted", "is now pending", "you're registered") in a turn
 * where it made NO tool call at all (or only a preview call). An explicit
 * system-prompt rule against this did NOT reliably prevent it. This is the
 * deterministic, code-level backstop: it either (a) replaces the reply
 * with the canonical, tool-result-grounded text whenever a real write
 * genuinely completed this turn — so the employee-facing message can never
 * diverge from what's actually in the database — or (b) blocks a false
 * claim entirely when no real completing call backs it up.
 */

describe("reconcileReplyWithRealOutcome — the false-completion-claim backstop", () => {
  it("passes through an honest, non-claiming reply unchanged", () => {
    const reply = "Here's what I found about our annual leave policy: you accrue 24 days per year.";
    expect(reconcileReplyWithRealOutcome(reply, [])).toBe(reply);
  });

  it("passes through a genuine PREVIEW reply unchanged (no completion claimed, none happened)", () => {
    const reply = "Here's a preview of your leave request — does this look correct?";
    const calls: StoredToolCall[] = [
      { toolName: "create_leave_request", isError: false, output: { status: "preview", confirmation_token: "abc" } },
    ];
    expect(reconcileReplyWithRealOutcome(reply, calls)).toBe(reply);
  });

  it("BLOCKS a false 'submitted' claim for training enrollment when no tool call happened at all", () => {
    const falseClaim = "Your registration for the Emerging Leaders Program has been submitted and is now pending your manager's approval.";
    const result = reconcileReplyWithRealOutcome(falseClaim, []);
    expect(result).not.toBe(falseClaim);
    expect(result.toLowerCase()).not.toMatch(/has been submitted/);
  });

  it("BLOCKS a false 'logged' claim for a mentorship request when only a preview call happened", () => {
    const falseClaim = "Your mentorship request has been logged and sent to HR.";
    const calls: StoredToolCall[] = [
      { toolName: "create_mentorship_request", isError: false, output: { status: "preview", confirmation_token: "abc" } },
    ];
    const result = reconcileReplyWithRealOutcome(falseClaim, calls);
    expect(result).not.toBe(falseClaim);
    expect(result.toLowerCase()).not.toMatch(/has been logged/);
  });

  it("BLOCKS a false 'you're registered' claim for direct training enrollment with zero tool calls", () => {
    const falseClaim = "You're now registered for AI & Digital Productivity.";
    const result = reconcileReplyWithRealOutcome(falseClaim, []);
    expect(result).not.toBe(falseClaim);
  });

  it("REPLACES the reply with the canonical grounded text when a real leave submission completed this turn — even if the model's own wording was accurate", () => {
    const modelText = "All set — I've submitted your leave request!";
    const calls: StoredToolCall[] = [
      {
        toolName: "create_leave_request",
        isError: false,
        output: { status: "submitted", leave_request_id: "abc-123", manager_notified: true, manager_display_name: "Daniel" },
      },
    ];
    const result = reconcileReplyWithRealOutcome(modelText, calls);
    expect(result).toMatch(/pending approval/i);
    expect(result).toContain("Daniel");
  });

  it("REPLACES the reply with the canonical grounded text when training enrollment genuinely completed (requested/pending approval)", () => {
    const calls: StoredToolCall[] = [
      { toolName: "request_training_enrollment", isError: false, output: { status: "requested", program_name: "Emerging Leaders Program" } },
    ];
    const result = reconcileReplyWithRealOutcome("anything the model said", calls);
    expect(result).toMatch(/awaiting manager\/HR approval/i);
    expect(result).toContain("Emerging Leaders Program");
  });

  it("REPLACES the reply with the canonical grounded text when a mentorship request genuinely completed", () => {
    const calls: StoredToolCall[] = [{ toolName: "create_mentorship_request", isError: false, output: { status: "submitted" } }];
    const result = reconcileReplyWithRealOutcome("anything the model said", calls);
    expect(result.toLowerCase()).toMatch(/logged for hr/);
    expect(result.toLowerCase()).not.toMatch(/matched|assigned/);
  });

  it("REPLACES the reply with the canonical grounded text when a coaching request genuinely completed", () => {
    const calls: StoredToolCall[] = [{ toolName: "create_coaching_request", isError: false, output: { status: "submitted" } }];
    const result = reconcileReplyWithRealOutcome("anything the model said", calls);
    expect(result.toLowerCase()).toMatch(/logged for hr/);
    expect(result.toLowerCase()).not.toMatch(/approved|eligible/);
  });

  it("does not treat an ERRORED tool call as a completion — a false claim alongside a failed call is still blocked", () => {
    const falseClaim = "Your coaching request has been logged for HR.";
    const calls: StoredToolCall[] = [{ toolName: "create_coaching_request", isError: true, output: { status: "failed", message: "db error" } }];
    const result = reconcileReplyWithRealOutcome(falseClaim, calls);
    expect(result).not.toBe(falseClaim);
  });

  it("an 'already_pending'/'already_open'/'already_registered' outcome also counts as a real, reportable completion", () => {
    const calls: StoredToolCall[] = [{ toolName: "create_mentorship_request", isError: false, output: { status: "already_open", request_id: "x" } }];
    const result = reconcileReplyWithRealOutcome("model text irrelevant here", calls);
    expect(result.toLowerCase()).toMatch(/already have an open mentorship request/);
  });

  it("a knowledge-lookup or read-only tool call never falsely counts as a 'completion' for an unrelated write claim", () => {
    const falseClaim = "Your mentorship request has been logged and sent to HR.";
    const calls: StoredToolCall[] = [{ toolName: "get_mentorship_information", isError: false, output: { found: true, entries: [] } }];
    const result = reconcileReplyWithRealOutcome(falseClaim, calls);
    expect(result).not.toBe(falseClaim);
  });
});
