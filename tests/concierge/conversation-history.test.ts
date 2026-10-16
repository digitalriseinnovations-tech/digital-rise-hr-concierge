import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getMyLatestConversation } from "../../src/lib/concierge/conversation-history";

/**
 * Real-database security/regression coverage for the "resume my latest
 * conversation" feature. getMyLatestConversation() takes ONLY an
 * employeeId — never a conversationId from a caller — specifically so
 * there is no id-guessing surface to test against; what actually needs
 * proving here is that the query is genuinely scoped per employee, that
 * no unsafe fields ever leak, and that every edge case (no conversation,
 * empty conversation, another employee's data) degrades gracefully
 * instead of erroring or cross-leaking.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let sarahId: string | null = null;
let danielId: string | null = null;
// A third, otherwise-untouched employee used only to prove the "no
// conversation at all" path — picked at runtime so this test never
// depends on a specific employee having zero history.
let neverChattedId: string | null = null;

let sarahTestConversationId: string | null = null;
let emptyTestConversationId: string | null = null;

const PROBE_MARKER = "CONVERSATION_HISTORY_TEST_PROBE_2026-10-16";

beforeAll(async () => {
  if (!client) return;

  const { data: named } = await client
    .from("employees")
    .select("id, employee_code")
    .in("employee_code", ["NSG-1001", "NSG-1002"]);
  sarahId = named?.find((e) => e.employee_code === "NSG-1001")?.id ?? null;
  danielId = named?.find((e) => e.employee_code === "NSG-1002")?.id ?? null;

  const { data: candidates } =
    sarahId && danielId
      ? await client.from("employees").select("id").not("id", "in", `(${sarahId},${danielId})`).limit(5)
      : { data: null };
  if (candidates && candidates.length > 0) {
    // Prefer one with zero existing conversation rows, so this really
    // exercises the "no conversation at all" path rather than coincidentally
    // picking someone who already has history from earlier manual testing.
    for (const c of candidates) {
      const { count } = await client
        .from("concierge_conversations")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", c.id);
      if (!count) {
        neverChattedId = c.id;
        break;
      }
    }
  }

  if (!sarahId) return;

  // A real conversation + message for Sarah, clearly marked as a test
  // fixture, cleaned up in afterAll.
  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: sarahId, channel: "web", status: "active" })
    .select("id")
    .single();
  sarahTestConversationId = conv?.id ?? null;
  if (sarahTestConversationId) {
    await client.from("concierge_messages").insert([
      { conversation_id: sarahTestConversationId, role: "employee", content: PROBE_MARKER },
      {
        conversation_id: sarahTestConversationId,
        role: "assistant",
        content: `Acknowledged: ${PROBE_MARKER}`,
        // Deliberately include tool_calls with a fake confirmation token —
        // this is exactly the shape that must NEVER reach the client.
        tool_calls: [{ toolName: "get_my_leave_balance", output: { confirmation_token: "SHOULD-NEVER-LEAK" }, isError: false }],
      },
    ]);

    // Back-date so this doesn't race a differently-timed row from other
    // concurrent test runs for "most recent" ordering guarantees.
    await client
      .from("concierge_conversations")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", sarahTestConversationId);
  }

  // A conversation row for Daniel with NO messages — the "empty
  // conversation" edge case (e.g. an interrupted first turn).
  const { data: emptyConv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: danielId, channel: "web", status: "active" })
    .select("id")
    .single();
  emptyTestConversationId = emptyConv?.id ?? null;
  if (emptyTestConversationId) {
    // Ensure this is genuinely Daniel's most recent conversation, so the
    // "empty conversation is skipped" test actually exercises that logic
    // rather than trivially passing because an older conversation sorts
    // first anyway.
    await client
      .from("concierge_conversations")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", emptyTestConversationId);
  }
});

afterAll(async () => {
  if (!client) return;
  // concierge_messages cascades on conversation delete (see
  // migration_008_hr_concierge_core.sql) — deleting the conversation rows
  // is sufficient cleanup.
  if (sarahTestConversationId) await client.from("concierge_conversations").delete().eq("id", sarahTestConversationId);
  if (emptyTestConversationId) await client.from("concierge_conversations").delete().eq("id", emptyTestConversationId);
});

describe("getMyLatestConversation — resume-my-own-conversation, real database", () => {
  it.skipIf(!hasCreds)("returns the employee's own latest conversation with only safe fields", async () => {
    const result = await getMyLatestConversation(sarahId!);
    expect(result.conversationId).toBe(sarahTestConversationId);
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages[0]).toEqual({ role: "employee", content: PROBE_MARKER });

    // The hard security requirement: no message object may carry
    // tool_calls, confirmation_token, or any key beyond role/content.
    for (const m of result.messages) {
      expect(Object.keys(m).sort()).toEqual(["content", "role"]);
      expect(JSON.stringify(m)).not.toContain("SHOULD-NEVER-LEAK");
      expect(JSON.stringify(m)).not.toContain("tool_calls");
      expect(JSON.stringify(m)).not.toContain("confirmation_token");
    }
  });

  it.skipIf(!hasCreds)("never returns another employee's conversation — cross-employee isolation", async () => {
    const danielResult = await getMyLatestConversation(danielId!);
    expect(danielResult.conversationId).not.toBe(sarahTestConversationId);
    const danielText = JSON.stringify(danielResult);
    expect(danielText).not.toContain(PROBE_MARKER);
    expect(danielText).not.toContain("SHOULD-NEVER-LEAK");
  });

  it.skipIf(!hasCreds)("an employee with zero conversations resolves gracefully, not an error", async () => {
    if (!neverChattedId) return; // environment didn't have a clean candidate this run — not a failure
    const result = await getMyLatestConversation(neverChattedId);
    expect(result).toEqual({ conversationId: null, messages: [] });
  });

  it.skipIf(!hasCreds)("a conversation row with zero messages resolves gracefully, not an error", async () => {
    const result = await getMyLatestConversation(danielId!);
    // Daniel's only test fixture is the empty conversation — must not
    // surface it as if it had real content to resume.
    expect(result.conversationId).not.toBe(emptyTestConversationId);
  });

  it.skipIf(!hasCreds)("a nonexistent employeeId resolves gracefully, not a crash", async () => {
    const result = await getMyLatestConversation("00000000-0000-0000-0000-000000000000");
    expect(result).toEqual({ conversationId: null, messages: [] });
  });
});
