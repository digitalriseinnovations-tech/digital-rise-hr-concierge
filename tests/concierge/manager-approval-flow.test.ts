import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { submitLeaveRequest, getMyLeaveBalance } from "../../src/lib/concierge/leave";

/**
 * Regression test for the EXISTING manager approval/rejection mechanism
 * (src/app/leave-decision/[token]/page.tsx) — proving Slice 3 did not
 * change its behavior. This exercises the same two operations that route
 * performs on approval (status update + the deduct_leave_balance RPC) and
 * on rejection (status update only) directly against the database, since
 * driving the actual page through a browser is out of scope for this
 * test process — the route's own code was not touched by this slice, so
 * this confirms the deterministic mechanics it depends on are unchanged
 * and still correct, which is the meaningful regression surface here.
 *
 * Deliberately uses Fatima Al-Suwaidi (NSG-1008), NOT Sarah Ahmed —
 * Vitest runs test files in parallel by default, and several other test
 * files read Sarah's balance as a fixed reference value (14 remaining).
 * This is the one file in the suite that genuinely mutates a real balance
 * via the live deduct_leave_balance RPC; using a different, otherwise-
 * untouched employee avoids a real cross-file race rather than trying to
 * force serial execution.
 *
 * SAFETY (TAQA Demo Sprint, Phase 0): every test here calls
 * submitLeaveRequest(), which makes a REAL fetch() to
 * NEXT_PUBLIC_SITE_URL + /api/leave-submit — a genuine network hop, not an
 * in-process call. If a local dev server happens to be running, that
 * fetch is handled INSIDE THE DEV SERVER'S OWN PROCESS, which does not
 * have process.env.VITEST/NODE_ENV=test set (Next.js sets NODE_ENV=
 * development for `next dev` regardless of the caller) — so
 * sendLeaveRequestToManager's test-runtime guard (src/lib/email.ts) does
 * NOT see this as a test run and would NOT block a real SMTP send. This
 * is the same class of risk http-routing.test.ts already gates for
 * /api/concierge/message, applied here to /api/leave-submit. Gated behind
 * the same explicit opt-in so default `npx vitest run` can never
 * accidentally email a real inbox just because a dev server is up.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const liveServerTestsEnabled = process.env.CONCIERGE_ALLOW_LIVE_MODEL_TESTS === "1";
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let fatimaId: string | null = null;
const createdLeaveRequestIds: string[] = [];
let originalTakenDays: number | null = null;

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id").eq("employee_code", "NSG-1008").single();
  fatimaId = data!.id;
  const balance = await getMyLeaveBalance(data!.id, "annual");
  originalTakenDays = balance?.takenDays ?? null;
});

afterAll(async () => {
  if (!client) return;
  if (createdLeaveRequestIds.length > 0) {
    await client.from("leave_requests").delete().in("id", createdLeaveRequestIds);
  }
  // Restore the real balance mutated by the live deduct_leave_balance RPC
  // in the tests below — deleting the leave_requests rows above does NOT
  // reverse it (separate table) — so this test file leaves no lasting
  // side effect on demo data.
  if (fatimaId && originalTakenDays !== null) {
    const currentYear = new Date().getFullYear();
    await client
      .from("leave_balances")
      .update({ taken_days: originalTakenDays })
      .eq("employee_id", fatimaId)
      .eq("year", currentYear)
      .eq("leave_type", "annual");
  }
});

/** Mirrors exactly what leave-decision/[token]/page.tsx does on confirmed
 * approve/reject: a race-safe status update, guarded to only affect a row
 * still 'pending', then (approve only) the same deduct_leave_balance RPC. */
async function decideRequest(requestId: string, decision: "approved" | "rejected") {
  const nowIso = new Date().toISOString();
  const { data: updated } = await client!
    .from("leave_requests")
    .update({ status: decision, decided_at: nowIso, decided_by_email: "daniel.carter@northstarglobal.com", token_used_at: nowIso })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id, employee_id, leave_type, start_date, days_count")
    .maybeSingle();

  if (decision === "approved" && updated) {
    const year = new Date(updated.start_date).getFullYear();
    await client!.rpc("deduct_leave_balance", {
      p_employee_id: updated.employee_id,
      p_leave_type: updated.leave_type,
      p_year: year,
      p_days: Number(updated.days_count),
    });
  }
  return updated;
}

describe("Existing manager approval flow — unchanged by Slice 3", () => {
  it.skipIf(!hasCreds || !liveServerTestsEnabled)("an APPROVED request deducts the balance by exactly the requested days (existing deterministic logic)", async () => {
    // current_leave_balances only ever shows the CURRENT calendar year's
    // row (its own join is `lb.year = extract(year from current_date)`),
    // matching exactly what the real approval route does (it deducts into
    // the leave request's start_date year) — so this test must use a
    // current-year date, not a future year, or the deduction would land
    // in a balance row this view never displays (confirmed by testing).
    const currentYear = new Date().getFullYear();
    const before = await getMyLeaveBalance(fatimaId!, "annual");

    const submitted = await submitLeaveRequest({
      employeeId: fatimaId!,
      leaveType: "annual",
      startDate: `${currentYear}-12-10`,
      endDate: `${currentYear}-12-11`,
      daysCount: 2,
    });
    expect(submitted.ok).toBe(true);
    createdLeaveRequestIds.push(submitted.leaveRequestId!);

    const decided = await decideRequest(submitted.leaveRequestId!, "approved");
    expect(decided?.id).toBe(submitted.leaveRequestId);

    const after = await getMyLeaveBalance(fatimaId!, "annual");
    expect(after?.remainingDays).toBe((before?.remainingDays ?? 0) - 2);
    expect(after?.takenDays).toBe((before?.takenDays ?? 0) + 2);
  });

  it.skipIf(!hasCreds || !liveServerTestsEnabled)("a REJECTED request does NOT deduct the balance", async () => {
    const before = await getMyLeaveBalance(fatimaId!, "annual");

    const submitted = await submitLeaveRequest({
      employeeId: fatimaId!,
      leaveType: "annual",
      startDate: "2027-07-01",
      endDate: "2027-07-03",
      daysCount: 3,
    });
    expect(submitted.ok).toBe(true);
    createdLeaveRequestIds.push(submitted.leaveRequestId!);

    const decided = await decideRequest(submitted.leaveRequestId!, "rejected");
    expect(decided?.id).toBe(submitted.leaveRequestId);

    const after = await getMyLeaveBalance(fatimaId!, "annual");
    expect(after?.remainingDays).toBe(before?.remainingDays ?? 0); // unchanged
    expect(after?.takenDays).toBe(before?.takenDays ?? 0); // unchanged

    const { data: row } = await client!.from("leave_requests").select("status").eq("id", submitted.leaveRequestId!).single();
    expect(row?.status).toBe("rejected");
  });

  it.skipIf(!hasCreds || !liveServerTestsEnabled)("a request already decided cannot be decided again (race-safe guard, unchanged)", async () => {
    // Uses "rejected" as the first decision (not "approved") specifically
    // so this test never invokes deduct_leave_balance — keeping it fully
    // independent of the balance-mutation concerns the first test above
    // already covers, and avoiding creating an extra stray balance row.
    const submitted = await submitLeaveRequest({
      employeeId: fatimaId!,
      leaveType: "annual",
      startDate: "2027-08-01",
      endDate: "2027-08-01",
      daysCount: 1,
    });
    createdLeaveRequestIds.push(submitted.leaveRequestId!);

    const first = await decideRequest(submitted.leaveRequestId!, "rejected");
    expect(first).not.toBeNull();

    const second = await decideRequest(submitted.leaveRequestId!, "approved");
    expect(second).toBeNull(); // guarded update affects 0 rows — already decided

    const { data: row } = await client!.from("leave_requests").select("status").eq("id", submitted.leaveRequestId!).single();
    expect(row?.status).toBe("rejected"); // the first decision stands, never flipped to approved
  });
});
