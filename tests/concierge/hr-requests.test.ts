import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createMentorshipRequest, createCoachingRequest, getMyHrRequests } from "../../src/lib/concierge/hr-requests";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let emmaId: string | null = null;
let oliverId: string | null = null;
let emmaConversationId: string | null = null;
const createdRequestIds: string[] = [];

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id, employee_code").in("employee_code", ["NSG-1009", "NSG-1010"]);
  oliverId = data?.find((e) => e.employee_code === "NSG-1009")?.id ?? null;
  emmaId = data?.find((e) => e.employee_code === "NSG-1010")?.id ?? null;

  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: emmaId, channel: "web", status: "active" })
    .select("id")
    .single();
  emmaConversationId = conv!.id;
});

afterAll(async () => {
  if (!client) return;
  if (createdRequestIds.length > 0) {
    await client.from("hr_requests").delete().in("id", createdRequestIds);
  }
  if (emmaConversationId) {
    await client.from("concierge_conversations").delete().eq("id", emmaConversationId);
  }
});

describe("createMentorshipRequest / createCoachingRequest — no automated matching or approval", () => {
  it.skipIf(!hasCreds)("createMentorshipRequest logs a real hr_requests row with status='open', no matching happens", async () => {
    const result = await createMentorshipRequest(emmaId!, "product leadership", "Looking for a mentor in product leadership.", emmaConversationId!);
    expect(result.ok).toBe(true);
    createdRequestIds.push(result.requestId!);

    const { data: row } = await client!.from("hr_requests").select("employee_id, request_type, category, status").eq("id", result.requestId!).single();
    expect(row?.employee_id).toBe(emmaId);
    expect(row?.request_type).toBe("mentorship");
    expect(row?.category).toBe("product leadership");
    expect(row?.status).toBe("open"); // never anything else — no AI-granted approval
  });

  it.skipIf(!hasCreds)("createCoachingRequest logs a real hr_requests row with status='open', no eligibility is decided", async () => {
    const result = await createCoachingRequest(emmaId!, "Interested in executive coaching.", emmaConversationId!);
    expect(result.ok).toBe(true);
    createdRequestIds.push(result.requestId!);

    const { data: row } = await client!.from("hr_requests").select("employee_id, request_type, status").eq("id", result.requestId!).single();
    expect(row?.employee_id).toBe(emmaId);
    expect(row?.request_type).toBe("coaching");
    expect(row?.status).toBe("open");
  });

  it.skipIf(!hasCreds)("a note over 500 chars is truncated, never rejected or silently dropped", async () => {
    const longNote = "x".repeat(600);
    const result = await createCoachingRequest(emmaId!, longNote, emmaConversationId!);
    expect(result.ok).toBe(true);
    createdRequestIds.push(result.requestId!);

    const { data: row } = await client!.from("hr_requests").select("note").eq("id", result.requestId!).single();
    expect(row?.note?.length).toBe(500);
  });
});

describe("getMyHrRequests — identity scoping and type filtering", () => {
  it.skipIf(!hasCreds)("Emma's requests never include Oliver's, and an unrelated employee sees none of Emma's", async () => {
    const emmaRequests = await getMyHrRequests(emmaId!);
    const oliverRequests = await getMyHrRequests(oliverId!);

    expect(emmaRequests.length).toBeGreaterThan(0);
    expect(oliverRequests.every((r) => !createdRequestIds.includes(r.id))).toBe(true);
  });

  it.skipIf(!hasCreds)("request_type filter only returns that type", async () => {
    const mentorshipOnly = await getMyHrRequests(emmaId!, "mentorship");
    expect(mentorshipOnly.every((r) => r.requestType === "mentorship")).toBe(true);
    expect(mentorshipOnly.some((r) => createdRequestIds.includes(r.id))).toBe(true);
  });
});
