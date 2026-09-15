import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  isClearAffirmative,
  getPendingConfirmation,
  runConciergeTurn,
  startConversation,
  looksLikeUnbackedActionNarration,
} from "../../src/lib/concierge/orchestrator";
import { claimsFalseApproval } from "./test-helpers";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

describe("isClearAffirmative — narrow, deterministic classifier", () => {
  it("matches short, unambiguous affirmatives", () => {
    for (const msg of ["yes", "Yes", "YES", "yes.", "yeah", "confirm", "go ahead", "submit it", "please submit it", "ok", "okay."]) {
      expect(isClearAffirmative(msg), `expected "${msg}" to match`).toBe(true);
    }
  });

  it("does NOT match longer or hedged messages, even if they contain 'yes'", () => {
    for (const msg of [
      "yes but let me think about it first",
      "yes, actually can you change the dates",
      "I think so, yes",
      "well, maybe",
      "sure, what were the dates again?",
      "no",
      "not yet",
    ]) {
      expect(isClearAffirmative(msg), `expected "${msg}" NOT to match`).toBe(false);
    }
  });

  it("does not match an empty or unrelated message", () => {
    expect(isClearAffirmative("")).toBe(false);
    expect(isClearAffirmative("what is my balance?")).toBe(false);
  });
});

describe("getPendingConfirmation — deterministic recovery from conversation history", () => {
  let sarahId: string;
  const conversationIds: string[] = [];

  beforeAll(async () => {
    if (!client) return;
    const { data } = await client.from("employees").select("id").eq("employee_code", "NSG-1001").single();
    sarahId = data!.id;
  });

  afterEach(async () => {
    if (!client) return;
    for (const id of conversationIds.splice(0)) {
      await client.from("concierge_messages").delete().eq("conversation_id", id);
      await client.from("concierge_conversations").delete().eq("id", id);
    }
  });

  it.skipIf(!hasCreds)("returns null when the conversation has no messages yet", async () => {
    const conversationId = await startConversation(sarahId);
    conversationIds.push(conversationId);
    expect(await getPendingConfirmation(conversationId)).toBeNull();
  });

  it.skipIf(!hasCreds)("returns null when the last assistant message was NOT a preview", async () => {
    const conversationId = await startConversation(sarahId);
    conversationIds.push(conversationId);
    await client!.from("concierge_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: "You have 14 days remaining.",
      tool_calls: [{ toolName: "get_my_leave_balance", output: { found: true, remainingDays: 14 }, isError: false }],
    });
    expect(await getPendingConfirmation(conversationId)).toBeNull();
  });

  it.skipIf(!hasCreds)("recovers the exact tool + input from a genuine preview message", async () => {
    const conversationId = await startConversation(sarahId);
    conversationIds.push(conversationId);
    await client!.from("concierge_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: "Here's your preview...",
      tool_calls: [
        {
          toolName: "create_leave_request",
          output: {
            status: "preview",
            start_date: "2026-10-12",
            end_date: "2026-10-15",
            leave_type: "annual",
            confirmation_token: "abc123token",
          },
          isError: false,
        },
      ],
    });
    const pending = await getPendingConfirmation(conversationId);
    expect(pending).toEqual({
      toolName: "create_leave_request",
      input: {
        start_date: "2026-10-12",
        end_date: "2026-10-15",
        leave_type: "annual",
        confirmed: true,
        confirmation_token: "abc123token",
      },
    });
  });

  it.skipIf(!hasCreds)("returns null once the preview is older than the TTL (stale confirmation cannot resurrect it)", async () => {
    const conversationId = await startConversation(sarahId);
    conversationIds.push(conversationId);
    const staleTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago, TTL is 15
    await client!.from("concierge_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: "Here's your preview...",
      created_at: staleTimestamp,
      tool_calls: [
        {
          toolName: "create_leave_request",
          output: { status: "preview", start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmation_token: "abc123" },
          isError: false,
        },
      ],
    });
    expect(await getPendingConfirmation(conversationId)).toBeNull();
  });

  it.skipIf(!hasCreds)("returns null if a later employee message follows the preview (not the immediately-preceding turn)", async () => {
    const conversationId = await startConversation(sarahId);
    conversationIds.push(conversationId);
    // Inserted as two SEPARATE statements with explicit, distinct
    // timestamps (a single multi-row insert can otherwise land both rows
    // on the same created_at value in this environment, making "most
    // recent" ambiguous — a test-setup artifact, not a real conversation,
    // where messages are always genuinely sequential API calls).
    const t1 = new Date(Date.now() - 2000).toISOString();
    const t2 = new Date().toISOString();
    await client!.from("concierge_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: "Here's your preview...",
      created_at: t1,
      tool_calls: [
        {
          toolName: "create_leave_request",
          output: { status: "preview", start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmation_token: "abc123" },
          isError: false,
        },
      ],
    });
    await client!.from("concierge_messages").insert({
      conversation_id: conversationId,
      role: "employee",
      content: "actually what's my balance again?",
      created_at: t2,
    });
    // Last message is the employee's own follow-up, not an assistant
    // preview — nothing pending from getPendingConfirmation's perspective.
    expect(await getPendingConfirmation(conversationId)).toBeNull();
  });

  // Slice 5 hardening: a real showcase run hit a UX dead-end where the
  // false-completion-claim backstop (reconcileReplyWithRealOutcome) fires
  // and persists a no-tool-call fallback message — which used to make the
  // ORIGINAL genuine preview unrecoverable, since the old implementation
  // only ever looked at the single most recent assistant message. Fixed by
  // scanning back through recent no-op assistant turns to find it.
  it.skipIf(!hasCreds)(
    "skips over an intervening 'yes' + no-tool-call assistant fallback (e.g. the false-claim backstop firing) and still recovers the original preview",
    async () => {
      const conversationId = await startConversation(sarahId);
      conversationIds.push(conversationId);
      // Real conversation turns always alternate employee/assistant — this
      // mirrors the actual sequence that triggered the bug: preview,
      // employee says "yes" (but the model didn't actually call the tool
      // that turn), then the false-claim backstop's no-tool-call fallback.
      const t1 = new Date(Date.now() - 6000).toISOString();
      const t2 = new Date(Date.now() - 4000).toISOString();
      const t3 = new Date(Date.now() - 2000).toISOString();

      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Here's your preview...",
        created_at: t1,
        tool_calls: [
          {
            toolName: "create_mentorship_request",
            output: { status: "preview", focus_area: "product leadership", note: "test note", confirmation_token: "tok-1" },
            isError: false,
          },
        ],
      });
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "employee",
        content: "Yes, please go ahead.",
        created_at: t2,
      });
      // The backstop's own fallback text ("could you say yes one more
      // time?") — no tool call was actually made this turn.
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Let's make sure that's actually been submitted before I confirm anything — could you say \"yes\" one more time?",
        created_at: t3,
        tool_calls: null,
      });

      const pending = await getPendingConfirmation(conversationId);
      expect(pending).toEqual({
        toolName: "create_mentorship_request",
        input: { focus_area: "product leadership", note: "test note", confirmed: true, confirmation_token: "tok-1" },
      });
    },
  );

  it.skipIf(!hasCreds)(
    "a genuinely different employee message between the preview and 'yes' still invalidates it (topic change, not a repeat)",
    async () => {
      const conversationId = await startConversation(sarahId);
      conversationIds.push(conversationId);
      const t1 = new Date(Date.now() - 4000).toISOString();
      const t2 = new Date(Date.now() - 2000).toISOString();

      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Here's your preview...",
        created_at: t1,
        tool_calls: [
          {
            toolName: "create_leave_request",
            output: { status: "preview", start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmation_token: "tok-1" },
            isError: false,
          },
        ],
      });
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "employee",
        content: "actually, what's my balance again?",
        created_at: t2,
      });

      expect(await getPendingConfirmation(conversationId)).toBeNull();
    },
  );

  it.skipIf(!hasCreds)(
    "a trailing READ-ONLY tool call in the same message (e.g. a balance re-check after the preview) does not hide the real preview",
    async () => {
      // Real observed case: the model calls a supplementary read tool
      // (get_my_leave_balance) AFTER the actual write-tool preview, in the
      // SAME message, to double-check a number before replying. The
      // relevant call is the last WRITE-tool call, not the array's last
      // entry overall.
      const conversationId = await startConversation(sarahId);
      conversationIds.push(conversationId);
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Here's your preview... you have 14 days remaining.",
        tool_calls: [
          {
            toolName: "create_leave_request",
            output: { status: "preview", start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmation_token: "tok-1" },
            isError: false,
          },
          { toolName: "get_my_leave_balance", output: { found: true, remainingDays: 14 }, isError: false },
        ],
      });

      const pending = await getPendingConfirmation(conversationId);
      expect(pending).toEqual({
        toolName: "create_leave_request",
        input: { start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmed: true, confirmation_token: "tok-1" },
      });
    },
  );

  it.skipIf(!hasCreds)(
    "does NOT skip past a genuine completed action to an older preview — a real completion after an intervening 'yes' invalidates anything before it",
    async () => {
      const conversationId = await startConversation(sarahId);
      conversationIds.push(conversationId);
      const t1 = new Date(Date.now() - 6000).toISOString();
      const t2 = new Date(Date.now() - 4000).toISOString();
      const t3 = new Date(Date.now() - 2000).toISOString();

      // Preview A — for October 12-15.
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Here's your preview for October 12-15...",
        created_at: t1,
        tool_calls: [
          {
            toolName: "create_leave_request",
            output: { status: "preview", start_date: "2026-10-12", end_date: "2026-10-15", leave_type: "annual", confirmation_token: "tok-1" },
            isError: false,
          },
        ],
      });
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "employee",
        content: "yes",
        created_at: t2,
      });
      // The employee's "yes" led to a REAL, different completed request
      // (e.g. the fast path or LLM path genuinely submitted it) — this
      // must never let a LATER "yes" reach back past it to preview A.
      await client!.from("concierge_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: "Your leave request has been submitted and is pending approval.",
        created_at: t3,
        tool_calls: [
          {
            toolName: "create_leave_request",
            output: { status: "submitted", leave_request_id: "some-id", manager_notified: true },
            isError: false,
          },
        ],
      });

      expect(await getPendingConfirmation(conversationId)).toBeNull();
    },
  );
});

describe("looksLikeUnbackedActionNarration — the tool-forcing retry trigger", () => {
  it("matches phrasing that narrates a pending preview/confirmation without having called a tool", () => {
    for (const text of [
      "Here's what I'll log for you. Does this look correct?",
      "I'll prepare your registration for the program. Shall I go ahead?",
      "Once you confirm, I'll submit it to your manager.",
      "Please confirm and I'll submit it.",
    ]) {
      expect(looksLikeUnbackedActionNarration(text), `expected to match: ${text}`).toBe(true);
    }
  });

  it("does not match ordinary informational answers", () => {
    for (const text of [
      "You accrue 24 days of annual leave per year.",
      "Northstar Global offers executive coaching for Director-level employees and above.",
      "Here are the leadership training programs available: Emerging Leaders Program, Strategic Leadership Essentials.",
    ]) {
      expect(looksLikeUnbackedActionNarration(text), `expected NOT to match: ${text}`).toBe(false);
    }
  });
});

describe("Reliability of the full preview -> 'yes' -> submit flow (empirical, repeated)", () => {
  const hasFullCreds = hasCreds && Boolean(process.env.ANTHROPIC_API_KEY);
  let sarahId: string;
  const conversationIds: string[] = [];
  const leaveRequestIds: string[] = [];

  beforeAll(async () => {
    if (!client) return;
    const { data } = await client.from("employees").select("id").eq("employee_code", "NSG-1001").single();
    sarahId = data!.id;
  });

  afterAll(async () => {
    if (!client) return;
    if (leaveRequestIds.length > 0) await client.from("leave_requests").delete().in("id", leaveRequestIds);
    for (const id of conversationIds) {
      await client.from("concierge_messages").delete().eq("conversation_id", id);
      await client.from("concierge_conversations").delete().eq("id", id);
    }
  });

  it.skipIf(!hasFullCreds)("succeeds every time across repeated runs — no longer subject to LLM sampling variance for recognizing 'yes'", async () => {
    const ATTEMPTS = 5;
    let successes = 0;

    for (let i = 0; i < ATTEMPTS; i++) {
      const conversationId = await startConversation(sarahId);
      conversationIds.push(conversationId);

      // Distinct dates each iteration to avoid the idempotency guard
      // reusing a prior iteration's request and masking a real failure.
      // Explicit year, single day, deliberately simple — this test is
      // about confirmation reliability, not date resolution (covered
      // separately in date-resolution.test.ts).
      const day = 3 + i;
      const iso = `2028-04-${String(day).padStart(2, "0")}`;
      await runConciergeTurn({
        conversationId,
        employeeId: sarahId,
        employeeFirstName: "Sarah",
        employeeFullName: "Sarah Ahmed",
        // Unambiguous single-day range (start == end explicitly) — no room
        // for the model to reasonably ask a clarifying question, so the
        // preview should always be produced on this first turn.
        userMessage: `I want annual leave from ${iso} to ${iso}.`,
      });

      const pendingCheck = await getPendingConfirmation(conversationId);
      expect(pendingCheck, `iteration ${i}: expected a pending preview to exist before confirming`).not.toBeNull();

      const confirmResult = await runConciergeTurn({
        conversationId,
        employeeId: sarahId,
        employeeFirstName: "Sarah",
        employeeFullName: "Sarah Ahmed",
        userMessage: "Yes",
      });

      if (/pending|submitted|awaiting/i.test(confirmResult.reply) && !claimsFalseApproval(confirmResult.reply)) {
        successes++;
      }

      const { data: rows } = await client!
        .from("leave_requests")
        .select("id")
        .eq("employee_id", sarahId)
        .eq("start_date", `2028-04-${String(day).padStart(2, "0")}`);
      if (rows) leaveRequestIds.push(...rows.map((r) => r.id));
    }

    expect(successes, `expected all ${ATTEMPTS} attempts to succeed deterministically`).toBe(ATTEMPTS);
  }, 120000);
});
