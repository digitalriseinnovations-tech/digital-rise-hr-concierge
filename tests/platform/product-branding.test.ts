import { describe, expect, it, afterEach } from "vitest";
import { getProductMode, getProductBranding } from "../../src/lib/product-mode";
import { leaveRequestEmail, employeeDecisionEmail } from "../../src/lib/email";

/**
 * Deployment-level branding for the shared leave-approval workflow
 * (Slice 7 hardening). One env var (APP_PRODUCT_MODE) controls it — never
 * request-level, never tenant-level (no "Northstar Global" anywhere in
 * this config or its output). Existing Finance behavior (no env var set)
 * must be provably unchanged.
 */

const ORIGINAL_MODE = process.env.APP_PRODUCT_MODE;

afterEach(() => {
  if (ORIGINAL_MODE === undefined) delete process.env.APP_PRODUCT_MODE;
  else process.env.APP_PRODUCT_MODE = ORIGINAL_MODE;
});

describe("getProductMode / getProductBranding", () => {
  it("defaults to 'finance' when APP_PRODUCT_MODE is unset — existing behavior unchanged", () => {
    delete process.env.APP_PRODUCT_MODE;
    expect(getProductMode()).toBe("finance");
    expect(getProductBranding().fullName).toBe("Verofax Finance");
  });

  it("returns 'hr' branding when APP_PRODUCT_MODE=hr", () => {
    process.env.APP_PRODUCT_MODE = "hr";
    expect(getProductMode()).toBe("hr");
    const branding = getProductBranding();
    expect(branding.fullName).toBe("Digital Rise HR Concierge");
    expect(branding.name).toBe("Digital Rise");
  });

  it("is case-insensitive and ignores unrecognized values (fails closed to 'finance')", () => {
    process.env.APP_PRODUCT_MODE = "HR";
    expect(getProductMode()).toBe("hr");
    process.env.APP_PRODUCT_MODE = "something-else";
    expect(getProductMode()).toBe("finance");
  });

  it("never contains the demo tenant name 'Northstar Global' — tenant identity is not platform identity", () => {
    process.env.APP_PRODUCT_MODE = "hr";
    const branding = getProductBranding();
    for (const value of Object.values(branding)) {
      expect(String(value)).not.toMatch(/northstar/i);
    }
  });
});

const BASE_REQUEST_ARGS = {
  managerName: "Daniel",
  employeeName: "Sarah Ahmed",
  leaveType: "annual",
  startDate: "2026-10-12",
  endDate: "2026-10-15",
  daysCount: 4,
  reason: null,
  approveUrl: "https://example.com/leave-decision/tok?action=approve",
  rejectUrl: "https://example.com/leave-decision/tok?action=reject",
  remainingDays: 10,
};

const BASE_DECISION_ARGS = {
  employeeName: "Sarah Ahmed",
  decision: "approved" as const,
  leaveType: "annual",
  startDate: "2026-10-12",
  endDate: "2026-10-15",
  daysCount: 4,
  decisionBy: "Daniel",
};

describe("leaveRequestEmail (manager approval email) — branding is deployment-aware", () => {
  it("contains Digital Rise HR Concierge branding, and NOT Verofax, in hr mode", () => {
    process.env.APP_PRODUCT_MODE = "hr";
    const html = leaveRequestEmail(BASE_REQUEST_ARGS);
    expect(html).toContain("Digital Rise HR Concierge");
    expect(html.toLowerCase()).not.toContain("verofax");
  });

  it("contains Verofax Finance branding, and NOT Digital Rise, in the default (finance) mode — existing behavior preserved", () => {
    delete process.env.APP_PRODUCT_MODE;
    const html = leaveRequestEmail(BASE_REQUEST_ARGS);
    expect(html).toContain("Verofax Finance");
    expect(html).not.toContain("Digital Rise");
  });

  it("never hardcodes a tenant name regardless of mode", () => {
    process.env.APP_PRODUCT_MODE = "hr";
    const html = leaveRequestEmail(BASE_REQUEST_ARGS);
    expect(html.toLowerCase()).not.toContain("northstar");
  });
});

describe("employeeDecisionEmail (decision notification email) — branding is deployment-aware", () => {
  it("contains Digital Rise HR Concierge branding in hr mode", () => {
    process.env.APP_PRODUCT_MODE = "hr";
    const html = employeeDecisionEmail(BASE_DECISION_ARGS);
    expect(html).toContain("Digital Rise HR Concierge");
    expect(html.toLowerCase()).not.toContain("verofax");
  });

  it("contains Verofax Finance branding in the default (finance) mode", () => {
    delete process.env.APP_PRODUCT_MODE;
    const html = employeeDecisionEmail(BASE_DECISION_ARGS);
    expect(html).toContain("Verofax Finance");
    expect(html).not.toContain("Digital Rise");
  });

  it("rejection-decision email also carries correct branding in hr mode", () => {
    process.env.APP_PRODUCT_MODE = "hr";
    const html = employeeDecisionEmail({ ...BASE_DECISION_ARGS, decision: "rejected" });
    expect(html).toContain("Digital Rise HR Concierge");
    expect(html).toContain("Leave Not Approved");
  });
});
