import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Production hardening — POST /api/concierge/message previously let an
 * unguarded startConversation() throw reach Next.js's own generic error
 * handler, producing a non-JSON 500 body. ChatPanel.tsx's res.json() then
 * threw a SyntaxError parsing that, landing in its catch block and showing
 * the misleading "Network error. Please try again." — masking the real
 * server-side failure.
 *
 * This file tests the ROUTE's error-handling logic in complete isolation:
 * every dependency (session verification, employee lookup, rate limiting,
 * conversation creation, the orchestrator turn itself) is mocked, so this
 * makes ZERO real Supabase calls, ZERO real Anthropic calls, and ZERO real
 * emails — it proves the shape of the response, not live infrastructure
 * behavior. next/headers' cookies() is mocked too, since Route Handlers
 * normally get it from Next's request-scoped context, which doesn't exist
 * when calling POST() directly in a unit test (this is why every other
 * HTTP-facing test in this repo, e.g. http-routing.test.ts, goes through a
 * real dev server instead — this file deliberately does NOT, precisely so
 * it needs no server, no credentials, and no external services at all).
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => ({ value: "fake-session-token" }),
  }),
}));

const mockVerifySessionToken = vi.fn();
const mockGetEmployeeById = vi.fn();
vi.mock("@/lib/concierge/identity", () => ({
  verifySessionToken: (...args: unknown[]) => mockVerifySessionToken(...args),
  getEmployeeById: (...args: unknown[]) => mockGetEmployeeById(...args),
  SESSION_COOKIE_NAME: "concierge_session",
}));

vi.mock("@/lib/concierge/rate-limit", () => ({
  isRateLimited: () => false,
}));

const mockStartConversation = vi.fn();
const mockRunConciergeTurn = vi.fn();
vi.mock("@/lib/concierge/orchestrator", () => ({
  startConversation: (...args: unknown[]) => mockStartConversation(...args),
  runConciergeTurn: (...args: unknown[]) => mockRunConciergeTurn(...args),
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/concierge/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/concierge/message — error handling around startConversation()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifySessionToken.mockReturnValue({ employeeId: "emp-1" });
    mockGetEmployeeById.mockResolvedValue({ id: "emp-1", firstName: "Test", fullName: "Test Employee" });
  });

  it("when startConversation() throws, the route returns valid JSON with HTTP 500 — not an unhandled exception", async () => {
    mockStartConversation.mockRejectedValue(new Error("Could not start a new Concierge conversation."));

    const { POST } = await import("../../src/app/api/concierge/message/route");
    const res = await POST(makeRequest({ message: "Hello" }));

    expect(res.status).toBe(500);
    // Must parse cleanly — this is exactly what ChatPanel.tsx's res.json()
    // needs; a non-JSON body is what previously produced "Network error".
    const body = await res.json();
    expect(body.error).toBe("Unable to start the conversation. Please try again.");
  });

  it("the JSON error response never contains Supabase/Postgres diagnostic detail", async () => {
    mockStartConversation.mockRejectedValue(
      new Error('insert or update on table "concierge_conversations" violates foreign key constraint "fk_employee"'),
    );

    const { POST } = await import("../../src/app/api/concierge/message/route");
    const res = await POST(makeRequest({ message: "Hello" }));
    const raw = await res.text();

    expect(raw).not.toMatch(/postgres|supabase|foreign key|constraint|relation/i);
  });

  it("a failure in startConversation() never reaches runConciergeTurn — Anthropic cannot be called for this request", async () => {
    mockStartConversation.mockRejectedValue(new Error("Could not start a new Concierge conversation."));

    const { POST } = await import("../../src/app/api/concierge/message/route");
    await POST(makeRequest({ message: "Hello" }));

    expect(mockRunConciergeTurn).not.toHaveBeenCalled();
  });

  it("successful behavior is unchanged — a request with no conversationId still starts one and calls runConciergeTurn", async () => {
    mockStartConversation.mockResolvedValue("conv-123");
    mockRunConciergeTurn.mockResolvedValue({ reply: "Hi there!", usedKnowledge: false, escalated: false, toolCallSummaries: [] });

    const { POST } = await import("../../src/app/api/concierge/message/route");
    const res = await POST(makeRequest({ message: "Hello" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversationId).toBe("conv-123");
    expect(body.reply).toBe("Hi there!");
    expect(mockStartConversation).toHaveBeenCalledTimes(1);
    expect(mockRunConciergeTurn).toHaveBeenCalledTimes(1);
  });

  it("an existing conversationId skips startConversation entirely — unchanged behavior", async () => {
    mockRunConciergeTurn.mockResolvedValue({ reply: "Continuing...", usedKnowledge: false, escalated: false, toolCallSummaries: [] });

    const { POST } = await import("../../src/app/api/concierge/message/route");
    const res = await POST(makeRequest({ conversationId: "existing-conv", message: "Follow-up" }));

    expect(res.status).toBe(200);
    expect(mockStartConversation).not.toHaveBeenCalled();
  });
});
