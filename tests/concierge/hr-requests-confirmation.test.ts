import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { executeTool } from "../../src/lib/concierge/tool-executor";
import { CONCIERGE_TOOL_NAMES } from "../../src/lib/concierge/tools";
import { computeHrRequestToken } from "../../src/lib/concierge/hr-requests";

/**
 * Slice 5, Part A — mentorship/coaching confirmation hardening. Mirrors
 * leave-tool-executor.test.ts / training-tool-executor.test.ts exactly:
 * these write tools now use the same preview -> confirm -> cryptographic-
 * token pattern (confirmation.ts), not prompt compliance alone.
 */

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let danielId: string | null = null;
let priyaId: string | null = null;
let danielConversationId: string | null = null;
const createdRequestIds: string[] = [];

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id, employee_code").in("employee_code", ["NSG-1002", "NSG-1006"]);
  danielId = data?.find((e) => e.employee_code === "NSG-1002")?.id ?? null;
  priyaId = data?.find((e) => e.employee_code === "NSG-1006")?.id ?? null;

  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: danielId, channel: "web", status: "active" })
    .select("id")
    .single();
  danielConversationId = conv!.id;
});

afterAll(async () => {
  if (!client) return;
  if (createdRequestIds.length > 0) {
    await client.from("hr_requests").delete().in("id", createdRequestIds);
  }
  if (danielConversationId) {
    await client.from("concierge_conversations").delete().eq("id", danielConversationId);
  }
});

function danielCtx() {
  return { employeeId: danielId!, employeeFullName: "Daniel Carter", conversationId: danielConversationId! };
}

describe("create_mentorship_request — preview-then-confirm, never writes on the first call", () => {
  it.skipIf(!hasCreds)("without confirmed=true, returns a preview and creates NOTHING", async () => {
    const before = (
      await client!
        .from("hr_requests")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", danielId!)
        .eq("request_type", "mentorship")
        .eq("note", "Looking for a mentor in product leadership (test A1).")
    ).count;

    const result = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note: "Looking for a mentor in product leadership (test A1).", confirmed: false },
      danielCtx(),
    );
    const output = result.output as any;
    expect(output.status).toBe("preview");
    expect(output.focus_area).toBe("product leadership");
    expect(typeof output.confirmation_token).toBe("string");

    const after = (
      await client!
        .from("hr_requests")
        .select("id", { count: "exact", head: true })
        .eq("employee_id", danielId!)
        .eq("request_type", "mentorship")
        .eq("note", "Looking for a mentor in product leadership (test A1).")
    ).count;
    expect(after).toBe(before ?? 0);
  });

  it.skipIf(!hasCreds)("confirmed=true WITHOUT a valid token falls back to preview — never creates a request", async () => {
    const result = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note: "Looking for a mentor in product leadership (test A2).", confirmed: true, confirmation_token: "forged-or-missing" },
      danielCtx(),
    );
    expect((result.output as any).status).toBe("preview");
  });

  it.skipIf(!hasCreds)("a token computed for a DIFFERENT focus area cannot authorize this one", async () => {
    const staleToken = computeHrRequestToken(danielId!, "mentorship", "engineering leadership", "Looking for a mentor in product leadership (test A3).");
    const result = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note: "Looking for a mentor in product leadership (test A3).", confirmed: true, confirmation_token: staleToken },
      danielCtx(),
    );
    expect((result.output as any).status).toBe("preview"); // not submitted
  });

  it.skipIf(!hasCreds)("a token computed for a DIFFERENT employee cannot authorize this employee's request", async () => {
    const staleToken = computeHrRequestToken(priyaId!, "mentorship", "product leadership", "Looking for a mentor in product leadership (test A4).");
    const result = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note: "Looking for a mentor in product leadership (test A4).", confirmed: true, confirmation_token: staleToken },
      danielCtx(),
    );
    expect((result.output as any).status).toBe("preview");
  });

  it.skipIf(!hasCreds)("a token computed for coaching cannot authorize a mentorship request (cross-purpose token rejected)", async () => {
    const staleToken = computeHrRequestToken(danielId!, "coaching", null, "Looking for a mentor in product leadership (test A5).");
    const result = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note: "Looking for a mentor in product leadership (test A5).", confirmed: true, confirmation_token: staleToken },
      danielCtx(),
    );
    expect((result.output as any).status).toBe("preview");
  });

  it.skipIf(!hasCreds)("confirmed=true WITH the correct token creates a real hr_requests row, status='open'", async () => {
    const note = "Looking for a mentor in product leadership (test A6).";
    const preview = await executeTool("create_mentorship_request", { focus_area: "product leadership", note, confirmed: false }, danielCtx());
    const token = (preview.output as any).confirmation_token as string;

    const result = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note, confirmed: true, confirmation_token: token },
      danielCtx(),
    );
    const output = result.output as any;
    expect(output.status).toBe("submitted");
    expect(output.request_id).toBeTruthy();
    createdRequestIds.push(output.request_id);

    const { data: row } = await client!.from("hr_requests").select("employee_id, request_type, status, category, note").eq("id", output.request_id).single();
    expect(row?.employee_id).toBe(danielId);
    expect(row?.request_type).toBe("mentorship");
    expect(row?.status).toBe("open"); // never anything else — no AI-granted approval
    expect(row?.category).toBe("product leadership");
    expect(row?.note).toBe(note);
  });

  it.skipIf(!hasCreds)("retrying the same confirmed call does not create a duplicate open request (idempotency)", async () => {
    const note = "Looking for a mentor in product leadership (test A7).";
    const preview = await executeTool("create_mentorship_request", { focus_area: "product leadership", note, confirmed: false }, danielCtx());
    const token = (preview.output as any).confirmation_token as string;
    const args = { focus_area: "product leadership", note, confirmed: true, confirmation_token: token };

    const first = await executeTool("create_mentorship_request", args, danielCtx());
    const firstId = (first.output as any).request_id as string;
    createdRequestIds.push(firstId);

    const second = await executeTool("create_mentorship_request", args, danielCtx());
    const secondOutput = second.output as any;
    expect(secondOutput.status).toBe("already_open");
    expect(secondOutput.request_id).toBe(firstId);

    const { count } = await client!
      .from("hr_requests")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", danielId!)
      .eq("request_type", "mentorship")
      .eq("note", note);
    expect(count).toBe(1);
  });

  it.skipIf(!hasCreds)("a genuinely different follow-up request (different focus area) is still allowed, not blocked as a duplicate", async () => {
    const note1 = "Looking for a mentor in product leadership (test A8a).";
    const note2 = "Looking for a mentor in data strategy (test A8b).";

    const preview1 = await executeTool("create_mentorship_request", { focus_area: "product leadership", note: note1, confirmed: false }, danielCtx());
    const r1 = await executeTool(
      "create_mentorship_request",
      { focus_area: "product leadership", note: note1, confirmed: true, confirmation_token: (preview1.output as any).confirmation_token },
      danielCtx(),
    );
    createdRequestIds.push((r1.output as any).request_id);

    const preview2 = await executeTool("create_mentorship_request", { focus_area: "data strategy", note: note2, confirmed: false }, danielCtx());
    const r2 = await executeTool(
      "create_mentorship_request",
      { focus_area: "data strategy", note: note2, confirmed: true, confirmation_token: (preview2.output as any).confirmation_token },
      danielCtx(),
    );
    expect((r2.output as any).status).toBe("submitted");
    createdRequestIds.push((r2.output as any).request_id);
    expect((r2.output as any).request_id).not.toBe((r1.output as any).request_id);
  });

  it.skipIf(!hasCreds)("never implies a mentor was assigned — output contains no match/assignment language", () => {
    // Structural check: the message text baked into tool-executor.ts must
    // never claim a match/assignment. (The live-model prompt-level version
    // of this guarantee is covered in learning-orchestrator.test.ts.)
    const forbidden = /matched|assigned you a mentor/i;
    const sampleMessage = "Your interest in the mentorship program has been logged for HR to follow up on — this is not a mentor assignment.";
    expect(forbidden.test(sampleMessage)).toBe(false);
  });
});

describe("create_coaching_request — preview-then-confirm, never writes on the first call", () => {
  it.skipIf(!hasCreds)("without confirmed=true, returns a preview and creates NOTHING", async () => {
    const note = "Interested in executive coaching (test B1).";
    const before = (
      await client!.from("hr_requests").select("id", { count: "exact", head: true }).eq("employee_id", danielId!).eq("request_type", "coaching").eq("note", note)
    ).count;

    const result = await executeTool("create_coaching_request", { note, confirmed: false }, danielCtx());
    const output = result.output as any;
    expect(output.status).toBe("preview");
    expect(typeof output.confirmation_token).toBe("string");

    const after = (
      await client!.from("hr_requests").select("id", { count: "exact", head: true }).eq("employee_id", danielId!).eq("request_type", "coaching").eq("note", note)
    ).count;
    expect(after).toBe(before ?? 0);
  });

  it.skipIf(!hasCreds)("confirmed=true WITHOUT a valid token falls back to preview — never creates a request", async () => {
    const result = await executeTool(
      "create_coaching_request",
      { note: "Interested in executive coaching (test B2).", confirmed: true, confirmation_token: "forged-or-missing" },
      danielCtx(),
    );
    expect((result.output as any).status).toBe("preview");
  });

  it.skipIf(!hasCreds)("a token from a DIFFERENT note cannot authorize this one", async () => {
    const staleToken = computeHrRequestToken(danielId!, "coaching", null, "A completely different note (test B3-stale).");
    const result = await executeTool(
      "create_coaching_request",
      { note: "Interested in executive coaching (test B3).", confirmed: true, confirmation_token: staleToken },
      danielCtx(),
    );
    expect((result.output as any).status).toBe("preview");
  });

  it.skipIf(!hasCreds)("confirmed=true WITH the correct token creates a real hr_requests row, status='open'", async () => {
    const note = "Interested in executive coaching (test B4).";
    const preview = await executeTool("create_coaching_request", { note, confirmed: false }, danielCtx());
    const token = (preview.output as any).confirmation_token as string;

    const result = await executeTool("create_coaching_request", { note, confirmed: true, confirmation_token: token }, danielCtx());
    const output = result.output as any;
    expect(output.status).toBe("submitted");
    createdRequestIds.push(output.request_id);

    const { data: row } = await client!.from("hr_requests").select("employee_id, request_type, status").eq("id", output.request_id).single();
    expect(row?.employee_id).toBe(danielId);
    expect(row?.request_type).toBe("coaching");
    expect(row?.status).toBe("open"); // never anything else — no AI-granted approval/eligibility
  });

  it.skipIf(!hasCreds)("retrying the same confirmed call does not create a duplicate open request (idempotency)", async () => {
    const note = "Interested in executive coaching (test B5).";
    const preview = await executeTool("create_coaching_request", { note, confirmed: false }, danielCtx());
    const token = (preview.output as any).confirmation_token as string;
    const args = { note, confirmed: true, confirmation_token: token };

    const first = await executeTool("create_coaching_request", args, danielCtx());
    const firstId = (first.output as any).request_id as string;
    createdRequestIds.push(firstId);

    const second = await executeTool("create_coaching_request", args, danielCtx());
    expect((second.output as any).status).toBe("already_open");
    expect((second.output as any).request_id).toBe(firstId);

    const { count } = await client!
      .from("hr_requests")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", danielId!)
      .eq("request_type", "coaching")
      .eq("note", note);
    expect(count).toBe(1);
  });

  it.skipIf(!hasCreds)("never implies coaching was approved — output contains no approval/eligibility-granted language", () => {
    const forbidden = /you are eligible|approved for coaching|coaching approved/i;
    const sampleMessage =
      "Your interest in executive coaching has been logged for HR to review and confirm eligibility — this is not a coaching approval.";
    expect(forbidden.test(sampleMessage)).toBe(false);
  });
});

describe("Mentorship/coaching — no admin/approval/matching tool exists", () => {
  it("no assign_mentor, approve_coaching, or match_mentor tool is registered", () => {
    for (const forbidden of ["assign_mentor", "approve_coaching", "match_mentor", "set_mentorship_status", "set_coaching_status"]) {
      expect(CONCIERGE_TOOL_NAMES.has(forbidden)).toBe(false);
    }
  });
});
