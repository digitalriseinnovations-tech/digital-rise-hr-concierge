import { describe, expect, it, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { executeTool } from "../../src/lib/concierge/tool-executor";
import { CONCIERGE_TOOL_NAMES } from "../../src/lib/concierge/tools";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Sarah Ahmed (NSG-1001) — the seeded demo persona — used as the test
// employee. Test-created hr_requests/conversations are cleaned up in
// afterAll so repeated test runs don't accumulate demo-DB clutter.
let testEmployeeId: string | null = null;
let testConversationId: string | null = null;
const createdHrRequestIds: string[] = [];

async function setup() {
  if (!client) return;
  const { data: emp } = await client.from("employees").select("id, full_name").eq("employee_code", "NSG-1001").single();
  testEmployeeId = emp!.id;
  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: testEmployeeId, channel: "web", status: "active" })
    .select("id")
    .single();
  testConversationId = conv!.id;
}

describe("Tool executor — the permission boundary", () => {
  it.skipIf(!hasCreds)("rejects an unknown tool name (fail closed)", async () => {
    if (!testEmployeeId) await setup();
    const result = await executeTool(
      "approve_leave", // does not exist in the allow-list — simulates a prompt-injection attempt
      { leave_request_id: "whatever" },
      { employeeId: testEmployeeId!, employeeFullName: "Sarah Ahmed", conversationId: testConversationId! },
    );
    expect(result.isError).toBe(true);
    expect(result.summary).toMatch(/REJECTED/);
    expect(CONCIERGE_TOOL_NAMES.has("approve_leave")).toBe(false);
  });

  it.skipIf(!hasCreds)("search_hr_knowledge executes and returns grounded results", async () => {
    if (!testEmployeeId) await setup();
    const result = await executeTool(
      "search_hr_knowledge",
      { query: "hybrid work policy" },
      { employeeId: testEmployeeId!, employeeFullName: "Sarah Ahmed", conversationId: testConversationId! },
    );
    expect(result.isError).toBe(false);
    expect((result.output as any).found).toBe(true);
  });

  it.skipIf(!hasCreds)("get_mentorship_information only returns mentorship-category content", async () => {
    if (!testEmployeeId) await setup();
    const result = await executeTool(
      "get_mentorship_information",
      {},
      { employeeId: testEmployeeId!, employeeFullName: "Sarah Ahmed", conversationId: testConversationId! },
    );
    const entries = (result.output as any).entries as Array<{ category: string }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.category === "mentorship")).toBe(true);
  });

  it.skipIf(!hasCreds)("escalate_to_hr creates a real hr_requests row scoped to the calling employee only (preview then confirm — Showcase Hardening)", async () => {
    if (!testEmployeeId) await setup();
    const ctx = { employeeId: testEmployeeId!, employeeFullName: "Sarah Ahmed", conversationId: testConversationId! };
    const reason = "Test escalation from automated test suite";

    const preview = await executeTool("escalate_to_hr", { category: "general", reason, confirmed: false }, ctx);
    expect((preview.output as any).status).toBe("preview");
    const token = (preview.output as any).confirmation_token as string;

    const result = await executeTool(
      "escalate_to_hr",
      { category: "general", reason, confirmed: true, confirmation_token: token },
      ctx,
    );
    expect(result.isError).toBe(false);
    const requestId = (result.output as any).request_id as string;
    expect(requestId).toBeTruthy();
    createdHrRequestIds.push(requestId);

    const { data: row } = await client!.from("hr_requests").select("employee_id, request_type, status").eq("id", requestId).single();
    expect(row?.employee_id).toBe(testEmployeeId);
    expect(row?.request_type).toBe("escalation");
    expect(row?.status).toBe("open");
  });

  it.skipIf(!hasCreds)("escalate_to_hr never writes another employee's id, regardless of tool input (preview then confirm)", async () => {
    if (!testEmployeeId) await setup();
    const ctx = { employeeId: testEmployeeId!, employeeFullName: "Sarah Ahmed", conversationId: testConversationId! };
    const reason = "test";
    // Even if a prompt-injected tool call tried to smuggle a different
    // employee_id through the input, the executor's context (ctx.employeeId,
    // resolved server-side from the session, never from the model's input)
    // is what gets written — the tool schema doesn't even accept an
    // employee_id field, so there's nothing for the model to pass here.
    const preview = await executeTool(
      "escalate_to_hr",
      { category: "general", reason, employee_id: "00000000-0000-0000-0000-000000000000", confirmed: false },
      ctx,
    );
    const token = (preview.output as any).confirmation_token as string;

    const result = await executeTool(
      "escalate_to_hr",
      { category: "general", reason, employee_id: "00000000-0000-0000-0000-000000000000", confirmed: true, confirmation_token: token },
      ctx,
    );
    const requestId = (result.output as any).request_id as string;
    createdHrRequestIds.push(requestId);
    const { data: row } = await client!.from("hr_requests").select("employee_id").eq("id", requestId).single();
    expect(row?.employee_id).toBe(testEmployeeId);
    expect(row?.employee_id).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  afterAll(async () => {
    if (!client) return;
    if (createdHrRequestIds.length > 0) {
      await client.from("hr_requests").delete().in("id", createdHrRequestIds);
    }
    if (testConversationId) {
      await client.from("concierge_conversations").delete().eq("id", testConversationId);
    }
  });
});
