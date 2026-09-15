import { describe, expect, it, beforeAll, afterEach, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { executeTool } from "../../src/lib/concierge/tool-executor";
import { CONCIERGE_TOOL_NAMES } from "../../src/lib/concierge/tools";
import { computeConfirmationToken } from "../../src/lib/concierge/leave";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let sarahId: string | null = null;
let danielId: string | null = null;
let sarahConversationId: string | null = null;
const createdLeaveRequestIds: string[] = [];

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id, employee_code").in("employee_code", ["NSG-1001", "NSG-1002"]);
  sarahId = data?.find((e) => e.employee_code === "NSG-1001")?.id ?? null;
  danielId = data?.find((e) => e.employee_code === "NSG-1002")?.id ?? null;

  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: sarahId, channel: "web", status: "active" })
    .select("id")
    .single();
  sarahConversationId = conv!.id;
});

afterAll(async () => {
  if (!client) return;
  if (createdLeaveRequestIds.length > 0) {
    await client.from("leave_requests").delete().in("id", createdLeaveRequestIds);
  }
  if (sarahConversationId) {
    await client.from("concierge_conversations").delete().eq("id", sarahConversationId);
  }
});

function sarahCtx() {
  return { employeeId: sarahId!, employeeFullName: "Sarah Ahmed", conversationId: sarahConversationId! };
}

describe("Leave tools — the absolute security rule: no approve/reject/mutate capability exists", () => {
  it("no approve_leave, reject_leave, set_leave_status, or update_leave_balance tool is registered", () => {
    for (const forbidden of ["approve_leave", "reject_leave", "set_leave_status", "update_leave_balance"]) {
      expect(CONCIERGE_TOOL_NAMES.has(forbidden)).toBe(false);
    }
  });

  it.skipIf(!hasCreds)("calling one of those names is rejected, fail closed, before touching the database", async () => {
    const result = await executeTool("approve_leave", { leave_request_id: "whatever" }, sarahCtx());
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/REJECTED/);
  });
});

describe("get_my_leave_balance — identity boundary", () => {
  it.skipIf(!hasCreds)("returns exactly Sarah's own balance (24/10/14) regardless of tool input", async () => {
    const result = await executeTool("get_my_leave_balance", { leave_type: "annual" }, sarahCtx());
    expect((result.output as any).remainingDays).toBe(14);
  });

  it.skipIf(!hasCreds)("tool input cannot override the session employee — the schema has no such field, and even a smuggled one is ignored", async () => {
    // The tool schema (tools.ts) deliberately has no employee_id field, but
    // this proves the executor ignores it even if present in raw input
    // (e.g. from a prompt-injection attempt shaping arguments by hand).
    const result = await executeTool(
      "get_my_leave_balance",
      { leave_type: "annual", employee_id: danielId },
      sarahCtx(), // ctx still says Sarah
    );
    // Must still be Sarah's balance (14), never Daniel's (18).
    expect((result.output as any).remainingDays).toBe(14);
  });
});

describe("create_leave_request — preview-then-confirm, never writes on the first call", () => {
  it.skipIf(!hasCreds)("without confirmed=true, returns a preview and creates NOTHING", async () => {
    // Scoped to these exact dates rather than a total-count-for-employee
    // comparison — the suite runs multiple test files in parallel, several
    // of which create real (different-dated) leave_requests for Sarah
    // concurrently, so a global before/after count is racy across files
    // even though this specific tool call itself creates nothing.
    const scoped = () =>
      client!
        .from("leave_requests")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", sarahId!)
        .eq("start_date", "2026-10-12")
        .eq("end_date", "2026-10-15");

    const before = (await scoped()).count;

    const result = await executeTool(
      "create_leave_request",
      { start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmed: false },
      sarahCtx(),
    );
    const output = result.output as any;
    expect(output.status).toBe("preview");
    expect(output.days_count).toBe(4);
    expect(output.current_remaining_days).toBe(14);
    expect(output.remaining_after_this_request).toBe(10);
    expect(typeof output.confirmation_token).toBe("string");

    const after = (await scoped()).count;
    expect(after).toBe(before ?? 0);
  });

  it.skipIf(!hasCreds)("confirmed=true WITHOUT a valid token falls back to preview — never creates a request", async () => {
    const before = (await client!.from("leave_requests").select("id", { count: "exact", head: true }).eq("employee_id", sarahId!)).count;

    const result = await executeTool(
      "create_leave_request",
      { start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmed: true, confirmation_token: "forged-or-missing" },
      sarahCtx(),
    );
    expect((result.output as any).status).toBe("preview");

    const after = (await client!.from("leave_requests").select("id", { count: "exact", head: true }).eq("employee_id", sarahId!)).count;
    expect(after).toBe(before);
  });

  it.skipIf(!hasCreds)("a token from a DIFFERENT request cannot authorize this one — stale confirmation is rejected", async () => {
    // Token computed for different dates than what's being submitted here.
    const staleToken = computeConfirmationToken({
      employeeId: sarahId!,
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      leaveType: "annual",
      daysCount: 2,
    });
    const result = await executeTool(
      "create_leave_request",
      { start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmed: true, confirmation_token: staleToken },
      sarahCtx(),
    );
    expect((result.output as any).status).toBe("preview"); // not submitted
  });

  it.skipIf(!hasCreds)("confirmed=true WITH the correct token creates a real request through /api/leave-submit", async () => {
    const preview = await executeTool(
      "create_leave_request",
      { start_date: "2026-11-03", end_date: "2026-11-04", leave_type: "annual", confirmed: false },
      sarahCtx(),
    );
    const token = (preview.output as any).confirmation_token as string;

    const result = await executeTool(
      "create_leave_request",
      { start_date: "2026-11-03", end_date: "2026-11-04", leave_type: "annual", confirmed: true, confirmation_token: token },
      sarahCtx(),
    );
    const output = result.output as any;
    expect(output.status).toBe("submitted");
    expect(output.leave_request_id).toBeTruthy();
    createdLeaveRequestIds.push(output.leave_request_id);

    const { data: row } = await client!.from("leave_requests").select("employee_id, status, days_count").eq("id", output.leave_request_id).single();
    expect(row?.employee_id).toBe(sarahId);
    expect(row?.status).toBe("pending"); // never anything else — AI cannot set this
    expect(row?.days_count).toBe(2);
  });

  it.skipIf(!hasCreds)("retrying the same confirmed call does not create a duplicate request (idempotency)", async () => {
    const preview = await executeTool(
      "create_leave_request",
      { start_date: "2026-12-01", end_date: "2026-12-02", leave_type: "annual", confirmed: false },
      sarahCtx(),
    );
    const token = (preview.output as any).confirmation_token as string;
    const args = { start_date: "2026-12-01", end_date: "2026-12-02", leave_type: "annual" as const, confirmed: true, confirmation_token: token };

    const first = await executeTool("create_leave_request", args, sarahCtx());
    const firstId = (first.output as any).leave_request_id as string;
    createdLeaveRequestIds.push(firstId);

    const second = await executeTool("create_leave_request", args, sarahCtx());
    const secondOutput = second.output as any;

    // Either explicitly recognized as already-pending, or (at minimum)
    // resolves to the SAME request id — never a second row.
    if (secondOutput.status === "already_pending") {
      expect(secondOutput.leave_request_id).toBe(firstId);
    } else {
      expect(secondOutput.leave_request_id).toBe(firstId);
    }

    const { count } = await client!
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", sarahId!)
      .eq("start_date", "2026-12-01")
      .eq("end_date", "2026-12-02");
    expect(count).toBe(1);
  });
});

describe("get_my_leave_requests / get_leave_request_status — identity boundary", () => {
  it.skipIf(!hasCreds)("Sarah only ever sees her own requests, never another employee's", async () => {
    const result = await executeTool("get_my_leave_requests", { limit: 20 }, sarahCtx());
    const requests = (result.output as any).requests as Array<{ id: string }>;
    // Cross-check every returned id actually belongs to Sarah in the DB.
    if (requests.length > 0) {
      const { data } = await client!.from("leave_requests").select("employee_id").in("id", requests.map((r) => r.id));
      expect(data?.every((r) => r.employee_id === sarahId)).toBe(true);
    }
  });

  it.skipIf(!hasCreds)("a submitted request shows status pending via get_leave_request_status", async () => {
    const result = await executeTool(
      "get_leave_request_status",
      { start_date: "2026-11-03", end_date: "2026-11-04" },
      sarahCtx(),
    );
    expect((result.output as any).status).toBe("pending");
  });
});
