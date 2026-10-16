import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * POST /api/concierge/identify — same production-hardening pattern as
 * message-route-error-handling.test.ts, applied to the route where the
 * gap was actually found live: a Vercel Preview deployment where either
 * SUPABASE_SERVICE_ROLE_KEY or HR_CONCIERGE_SESSION_SECRET was missing
 * caused createServiceClient()/issueSessionToken() to throw, reaching
 * Next.js's own generic (non-JSON) error handler — the identify form's
 * res.json() then threw, and the employee saw a misleading "Network
 * error" with no way to tell a real misconfiguration from being offline.
 *
 * Every dependency mocked — ZERO real Supabase calls, matching the
 * convention established in message-route-error-handling.test.ts.
 */

const mockIdentifyEmployee = vi.fn();
const mockIssueSessionToken = vi.fn();
vi.mock("@/lib/concierge/identity", () => ({
  identifyEmployee: (...args: unknown[]) => mockIdentifyEmployee(...args),
  issueSessionToken: (...args: unknown[]) => mockIssueSessionToken(...args),
  SESSION_COOKIE_NAME: "concierge_session",
}));

vi.mock("@/lib/concierge/rate-limit", () => ({
  isRateLimited: () => false,
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/concierge/identify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/concierge/identify — error handling around identifyEmployee()/issueSessionToken()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("when identifyEmployee() throws (e.g. a missing Supabase credential), the route returns valid JSON with HTTP 500 — not an unhandled exception", async () => {
    mockIdentifyEmployee.mockRejectedValue(new Error("SUPABASE_SERVICE_ROLE_KEY is not set."));

    const { POST } = await import("../../src/app/api/concierge/identify/route");
    const res = await POST(makeRequest({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unable to verify your identity right now. Please try again shortly.");
  });

  it("the JSON error response never contains Supabase/env-var diagnostic detail", async () => {
    mockIdentifyEmployee.mockRejectedValue(new Error("SUPABASE_SERVICE_ROLE_KEY is not set. In Supabase Dashboard..."));

    const { POST } = await import("../../src/app/api/concierge/identify/route");
    const res = await POST(makeRequest({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }));
    const raw = await res.text();

    expect(raw).not.toMatch(/supabase|postgres|service_role|dashboard/i);
  });

  it("when issueSessionToken() throws (e.g. a missing session secret), the route returns valid JSON with HTTP 500 — not an unhandled exception", async () => {
    mockIdentifyEmployee.mockResolvedValue({ id: "emp-1", firstName: "Sarah", fullName: "Sarah Ahmed" });
    mockIssueSessionToken.mockImplementation(() => {
      throw new Error("HR_CONCIERGE_SESSION_SECRET is not set — cannot issue or verify Concierge sessions.");
    });

    const { POST } = await import("../../src/app/api/concierge/identify/route");
    const res = await POST(makeRequest({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unable to start your session right now. Please try again shortly.");
  });

  it("a thrown error never sets a session cookie", async () => {
    mockIdentifyEmployee.mockResolvedValue({ id: "emp-1", firstName: "Sarah", fullName: "Sarah Ahmed" });
    mockIssueSessionToken.mockImplementation(() => {
      throw new Error("HR_CONCIERGE_SESSION_SECRET is not set.");
    });

    const { POST } = await import("../../src/app/api/concierge/identify/route");
    const res = await POST(makeRequest({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }));

    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("successful behavior is unchanged — a valid identity still issues a session cookie", async () => {
    mockIdentifyEmployee.mockResolvedValue({ id: "emp-1", firstName: "Sarah", fullName: "Sarah Ahmed" });
    mockIssueSessionToken.mockReturnValue({ token: "fake-token", maxAgeSeconds: 28800 });

    const { POST } = await import("../../src/app/api/concierge/identify/route");
    const res = await POST(makeRequest({ employee_code: "NSG-1001", email: "sarah.ahmed@northstarglobal.com" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.firstName).toBe("Sarah");
    expect(res.headers.get("set-cookie")).toContain("concierge_session=fake-token");
  });

  it("a nonexistent employee still gets the generic 401 (unchanged, not swallowed by the new try/catch)", async () => {
    mockIdentifyEmployee.mockResolvedValue(null);

    const { POST } = await import("../../src/app/api/concierge/identify/route");
    const res = await POST(makeRequest({ employee_code: "does-not-exist", email: "nobody@example.com" }));

    expect(res.status).toBe(401);
    expect(mockIssueSessionToken).not.toHaveBeenCalled();
  });
});
