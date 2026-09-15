import { describe, expect, it, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  getMyLeaveBalance,
  calculateDaysCount,
  computeConfirmationToken,
  verifyConfirmationToken,
  getMyLeaveRequests,
  getLeaveRequestStatus,
  findExistingPendingRequest,
} from "../../src/lib/concierge/leave";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let sarahId: string | null = null;
let danielId: string | null = null;

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id, employee_code").in("employee_code", ["NSG-1001", "NSG-1002"]);
  sarahId = data?.find((e) => e.employee_code === "NSG-1001")?.id ?? null;
  danielId = data?.find((e) => e.employee_code === "NSG-1002")?.id ?? null;
});

describe("calculateDaysCount — mirrors the existing public form's formula exactly", () => {
  it("Oct 12 -> Oct 15 is 4 inclusive calendar days", () => {
    expect(calculateDaysCount("2026-10-12", "2026-10-15")).toBe(4);
  });

  it("same start and end date is 1 day", () => {
    expect(calculateDaysCount("2026-10-12", "2026-10-12")).toBe(1);
  });

  it("end before start is invalid (0)", () => {
    expect(calculateDaysCount("2026-10-15", "2026-10-12")).toBe(0);
  });
});

describe("Leave balance — canonical view only, no second formula", () => {
  it.skipIf(!hasCreds)("Sarah Ahmed's own balance resolves to 24 accrued / 10 taken / 14 remaining", async () => {
    const balance = await getMyLeaveBalance(sarahId!, "annual");
    expect(balance?.accruedDays).toBe(24);
    expect(balance?.takenDays).toBe(10);
    expect(balance?.remainingDays).toBe(14);
  });

  it.skipIf(!hasCreds)("a different employee's own balance is independent of Sarah's", async () => {
    const balance = await getMyLeaveBalance(danielId!, "annual");
    // Daniel Carter's seed: 24 accrued, 6 taken -> 18 remaining. Confirms
    // the query is genuinely scoped per employeeId, not returning a
    // cached/shared value.
    expect(balance?.remainingDays).toBe(18);
  });
});

describe("Confirmation token — bound to exact request details", () => {
  const base = { employeeId: "emp-1", startDate: "2026-10-12", endDate: "2026-10-15", leaveType: "annual" as const, daysCount: 4 };

  it("the same details always produce the same token", () => {
    expect(computeConfirmationToken(base)).toBe(computeConfirmationToken({ ...base }));
  });

  it("a token verifies against the exact details it was computed for", () => {
    const token = computeConfirmationToken(base);
    expect(verifyConfirmationToken(token, base)).toBe(true);
  });

  it("a token does NOT verify against different dates (cannot authorize a different request)", () => {
    const token = computeConfirmationToken(base);
    expect(verifyConfirmationToken(token, { ...base, startDate: "2026-11-01", endDate: "2026-11-04" })).toBe(false);
  });

  it("a token does NOT verify against a different leave type", () => {
    const token = computeConfirmationToken(base);
    expect(verifyConfirmationToken(token, { ...base, leaveType: "sick" })).toBe(false);
  });

  it("a token does NOT verify against a different day count", () => {
    const token = computeConfirmationToken(base);
    expect(verifyConfirmationToken(token, { ...base, daysCount: 10 })).toBe(false);
  });

  it("a token does NOT verify for a different employee", () => {
    const token = computeConfirmationToken(base);
    expect(verifyConfirmationToken(token, { ...base, employeeId: "someone-else" })).toBe(false);
  });

  it("an empty/undefined token never verifies", () => {
    expect(verifyConfirmationToken(undefined, base)).toBe(false);
    expect(verifyConfirmationToken("", base)).toBe(false);
    expect(verifyConfirmationToken("garbage", base)).toBe(false);
  });
});

describe("Leave requests — read scoping", () => {
  it.skipIf(!hasCreds)("getMyLeaveRequests respects the limit parameter", async () => {
    const requests = await getMyLeaveRequests(sarahId!, 1);
    expect(requests.length).toBeLessThanOrEqual(1);
  });

  it.skipIf(!hasCreds)("getLeaveRequestStatus returns null (not another employee's request) when nothing matches", async () => {
    const result = await getLeaveRequestStatus(sarahId!, { startDate: "1999-01-01", endDate: "1999-01-02" });
    expect(result).toBeNull();
  });

  it.skipIf(!hasCreds)("findExistingPendingRequest returns null when no matching pending request exists", async () => {
    const result = await findExistingPendingRequest(sarahId!, "1999-01-01", "1999-01-02", "annual");
    expect(result).toBeNull();
  });
});
