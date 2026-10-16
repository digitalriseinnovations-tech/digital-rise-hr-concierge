import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * GET /api/concierge/history in complete isolation — every dependency
 * mocked, zero real Supabase calls. Mirrors the convention established in
 * message-route-error-handling.test.ts. The real cross-employee security
 * property (that getMyLatestConversation itself never leaks another
 * employee's data) is proven against the real database in
 * conversation-history.test.ts; this file proves the ROUTE's own
 * contract: auth is enforced before any data access, and failures degrade
 * to a safe empty response rather than an error reaching the client.
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

const mockGetMyLatestConversation = vi.fn();
vi.mock("@/lib/concierge/conversation-history", () => ({
  getMyLatestConversation: (...args: unknown[]) => mockGetMyLatestConversation(...args),
}));

describe("GET /api/concierge/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 and never calls getMyLatestConversation when there is no valid session", async () => {
    mockVerifySessionToken.mockReturnValue(null);

    const { GET } = await import("../../src/app/api/concierge/history/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockGetMyLatestConversation).not.toHaveBeenCalled();
  });

  it("returns 401 and never calls getMyLatestConversation when the employee record can't be resolved", async () => {
    mockVerifySessionToken.mockReturnValue({ employeeId: "emp-1" });
    mockGetEmployeeById.mockResolvedValue(null);

    const { GET } = await import("../../src/app/api/concierge/history/route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockGetMyLatestConversation).not.toHaveBeenCalled();
  });

  it("on a valid session, scopes the lookup to exactly that session's own employeeId", async () => {
    mockVerifySessionToken.mockReturnValue({ employeeId: "emp-42" });
    mockGetEmployeeById.mockResolvedValue({ id: "emp-42", firstName: "Test", fullName: "Test Employee" });
    mockGetMyLatestConversation.mockResolvedValue({ conversationId: "conv-1", messages: [{ role: "employee", content: "Hi" }] });

    const { GET } = await import("../../src/app/api/concierge/history/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetMyLatestConversation).toHaveBeenCalledWith("emp-42");
    expect(body).toEqual({ conversationId: "conv-1", messages: [{ role: "employee", content: "Hi" }] });
  });

  it("a thrown error from the data layer degrades to a safe empty response, not a 500/leak", async () => {
    mockVerifySessionToken.mockReturnValue({ employeeId: "emp-1" });
    mockGetEmployeeById.mockResolvedValue({ id: "emp-1", firstName: "Test", fullName: "Test Employee" });
    mockGetMyLatestConversation.mockRejectedValue(new Error('relation "concierge_conversations" does not exist'));

    const { GET } = await import("../../src/app/api/concierge/history/route");
    const res = await GET();
    const raw = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(raw)).toEqual({ conversationId: null, messages: [] });
    expect(raw).not.toMatch(/postgres|supabase|relation|constraint/i);
  });

  it("never returns anything beyond conversationId/messages — no accidental metadata passthrough", async () => {
    mockVerifySessionToken.mockReturnValue({ employeeId: "emp-1" });
    mockGetEmployeeById.mockResolvedValue({ id: "emp-1", firstName: "Test", fullName: "Test Employee" });
    mockGetMyLatestConversation.mockResolvedValue({ conversationId: "conv-1", messages: [] });

    const { GET } = await import("../../src/app/api/concierge/history/route");
    const res = await GET();
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(["conversationId", "messages"]);
  });
});
