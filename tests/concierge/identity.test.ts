import { describe, expect, it, vi, afterEach } from "vitest";
import { identifyEmployee, issueSessionToken, verifySessionToken } from "../../src/lib/concierge/identity";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Employee identity — two-factor lookup", () => {
  it.skipIf(!hasCreds)("correct employee_code + correct email succeeds", async () => {
    const employee = await identifyEmployee("NSG-1001", "sarah.ahmed@northstarglobal.com");
    expect(employee).not.toBeNull();
    expect(employee?.firstName).toBe("Sarah");
  });

  it.skipIf(!hasCreds)("correct employee_code + WRONG email fails (no partial match)", async () => {
    const employee = await identifyEmployee("NSG-1001", "wrong.email@northstarglobal.com");
    expect(employee).toBeNull();
  });

  it.skipIf(!hasCreds)("WRONG employee_code + correct email fails (no partial match)", async () => {
    const employee = await identifyEmployee("NSG-9999", "sarah.ahmed@northstarglobal.com");
    expect(employee).toBeNull();
  });

  it.skipIf(!hasCreds)("mismatched pair (real code, someone else's real email) fails", async () => {
    // NSG-1001 is Sarah Ahmed; daniel.carter@... is a real email but for a
    // DIFFERENT employee — this must not succeed just because both values
    // individually exist somewhere in the table.
    const employee = await identifyEmployee("NSG-1001", "daniel.carter@northstarglobal.com");
    expect(employee).toBeNull();
  });

  it.skipIf(!hasCreds)("another employee's data is not exposed via a mismatched lookup", async () => {
    const employee = await identifyEmployee("NSG-1002", "sarah.ahmed@northstarglobal.com");
    expect(employee).toBeNull();
  });
});

describe("Session token — signing and verification", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a freshly issued token verifies successfully", () => {
    const { token } = issueSessionToken("00000000-0000-0000-0000-000000000001");
    const verified = verifySessionToken(token);
    expect(verified?.employeeId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("a tampered signature is rejected", () => {
    const { token } = issueSessionToken("00000000-0000-0000-0000-000000000001");
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.${signature.slice(0, -2)}xx`;
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("a tampered payload is rejected", () => {
    const { token } = issueSessionToken("00000000-0000-0000-0000-000000000001");
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ employeeId: "someone-else", exp: 9999999999 })).toString("base64url");
    expect(verifySessionToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it("malformed tokens are rejected without throwing", () => {
    expect(verifySessionToken("not-a-real-token")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken(null)).toBeNull();
  });

  it("an expired token is rejected", () => {
    const { token } = issueSessionToken("00000000-0000-0000-0000-000000000001");
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000); // 9h later, past the 8h TTL
    expect(verifySessionToken(token)).toBeNull();
  });
});
