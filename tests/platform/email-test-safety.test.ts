import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

/**
 * Regression coverage for the test-runtime email safety guard.
 *
 * Root cause this guards against: `.env.local` supplies real Gmail SMTP
 * credentials, and that SAME file is loaded by both `npm run dev` and
 * `npx vitest run` (tests/setup/load-env.ts makes no dev/test distinction).
 * Before this fix, `src/lib/email.ts`'s `send()` had no test-environment
 * guard, so every test that reached a leave-submission or escalation code
 * path sent a real email through real SMTP.
 *
 * These tests prove the guard is structural, not incidental: even with
 * real-looking Gmail env vars present (as they are for this entire suite,
 * via .env.local), no real SMTP transport is ever constructed while running
 * under Vitest.
 */

describe("email test-runtime safety guard", () => {
  it("isTestRuntime() is true under this actual Vitest process", async () => {
    const { isTestRuntime } = await import("../../src/lib/email");
    expect(isTestRuntime()).toBe(true);
    // The two independent signals the guard relies on — proves this isn't
    // a coincidental true, but the documented detection mechanism.
    expect(Boolean(process.env.VITEST)).toBe(true);
  });

  it("nodemailer.createTransport is NEVER called when sendLeaveRequestToManager runs under test, even though real-looking Gmail credentials are present in the environment", async () => {
    expect(process.env.GMAIL_USER).toBeTruthy();
    expect(process.env.GMAIL_APP_PASSWORD).toBeTruthy();

    const createTransportSpy = vi.spyOn(nodemailer, "createTransport");
    const { sendLeaveRequestToManager } = await import("../../src/lib/email");

    const result = await sendLeaveRequestToManager({
      managerEmail: "manager@example.test",
      managerName: "Test Manager",
      employeeName: "Test Employee",
      leaveType: "annual",
      startDate: "2099-01-01",
      endDate: "2099-01-02",
      daysCount: 1,
      reason: null,
      approvalToken: "test-token",
      remainingDays: 10,
    });

    expect(createTransportSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect((result as { dryRun?: boolean }).dryRun).toBe(true);
    createTransportSpy.mockRestore();
  });

  it("nodemailer.createTransport is NEVER called when sendLeaveDecisionToEmployee runs under test", async () => {
    const createTransportSpy = vi.spyOn(nodemailer, "createTransport");
    const { sendLeaveDecisionToEmployee } = await import("../../src/lib/email");

    const result = await sendLeaveDecisionToEmployee({
      employeeEmail: "employee@example.test",
      employeeName: "Test Employee",
      decision: "approved",
      leaveType: "annual",
      startDate: "2099-01-01",
      endDate: "2099-01-02",
      daysCount: 1,
      decisionBy: "Test Manager",
    });

    expect(createTransportSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect((result as { dryRun?: boolean }).dryRun).toBe(true);
    createTransportSpy.mockRestore();
  });

  it("nodemailer.createTransport is NEVER called when sendHrEscalationNotification runs under test", async () => {
    expect(process.env.HR_CONCIERGE_ESCALATION_EMAIL).toBeTruthy();

    const createTransportSpy = vi.spyOn(nodemailer, "createTransport");
    const { sendHrEscalationNotification } = await import("../../src/lib/email");

    const result = await sendHrEscalationNotification({
      employeeName: "Test Employee",
      category: "general",
      reason: "test",
      conversationId: "test-conversation-id",
    });

    expect(createTransportSpy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect((result as { dryRun?: boolean }).dryRun).toBe(true);
    createTransportSpy.mockRestore();
  });

  it("getTransport()'s underlying real-SMTP path is unreachable under test even if called directly (defense in depth) — proven via module internals not being exposed, and via the three public send paths above never invoking createTransport despite valid credentials being present", async () => {
    // getTransport() itself is intentionally not exported (no direct-call
    // surface exists for a test to bypass send()'s guard) — its own
    // internal isTestRuntime() throw is the second, independent layer
    // documented in src/lib/email.ts. The three tests above already prove
    // the only reachable path (through send()) never reaches nodemailer.
    const emailModule = await import("../../src/lib/email");
    expect((emailModule as Record<string, unknown>).getTransport).toBeUndefined();
  });
});
