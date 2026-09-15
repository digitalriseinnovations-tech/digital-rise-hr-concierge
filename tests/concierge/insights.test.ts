import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { computeConciergeInsights, computeKnowledgeGaps, ESTIMATED_MINUTES_PER_SELF_SERVICE_QUERY } from "../../src/lib/concierge/insights";
import { can } from "../../src/lib/auth";

const hasCreds = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const client = hasCreds
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let jamesId: string | null = null;
let jamesConversationId: string | null = null;
const createdConversationIds: string[] = [];

beforeAll(async () => {
  if (!client) return;
  const { data } = await client.from("employees").select("id").eq("employee_code", "NSG-1005").single();
  jamesId = data!.id;

  const { data: conv } = await client
    .from("concierge_conversations")
    .insert({ employee_id: jamesId, channel: "web", status: "active" })
    .select("id")
    .single();
  jamesConversationId = conv!.id;
  createdConversationIds.push(jamesConversationId!);

  // Two synthetic messages: one resolved knowledge hit (self-service), one
  // unanswered ("knowledge gap") — enough to exercise every branch of both
  // aggregation functions deterministically, without depending on live
  // model output or on whatever other tests happen to have written.
  await client.from("concierge_messages").insert({
    conversation_id: jamesConversationId,
    role: "employee",
    content: "What is our parental leave policy?",
    created_at: new Date(Date.now() - 20000).toISOString(),
  });
  await client.from("concierge_messages").insert({
    conversation_id: jamesConversationId,
    role: "assistant",
    content: "Here is what I found about parental leave...",
    tool_calls: [
      { toolName: "search_hr_knowledge", isError: false, output: { found: true, entries: [{ category: "leave", topic: "Parental leave" }] } },
    ],
    created_at: new Date(Date.now() - 19000).toISOString(),
  });
  await client.from("concierge_messages").insert({
    conversation_id: jamesConversationId,
    role: "employee",
    content: "Do we have a sabbatical program for 10-year tenure employees specifically?",
    created_at: new Date(Date.now() - 10000).toISOString(),
  });
  await client.from("concierge_messages").insert({
    conversation_id: jamesConversationId,
    role: "assistant",
    content: "I couldn't find anything on that in our HR knowledge base.",
    tool_calls: [{ toolName: "search_hr_knowledge", isError: false, output: { found: false, message: "no results" } }],
    created_at: new Date(Date.now() - 9000).toISOString(),
  });
});

afterAll(async () => {
  if (!client) return;
  if (createdConversationIds.length > 0) {
    await client.from("concierge_messages").delete().in("conversation_id", createdConversationIds);
    await client.from("concierge_conversations").delete().in("id", createdConversationIds);
  }
});

describe("computeConciergeInsights — real aggregation, no invented numbers", () => {
  it.skipIf(!hasCreds)("reflects the real underlying row counts (non-negative, internally consistent)", async () => {
    const insights = await computeConciergeInsights();
    expect(insights.totalConversations).toBeGreaterThan(0);
    expect(insights.totalEmployeeMessages).toBeGreaterThan(0);
    expect(insights.totalToolActionsCompleted).toBeGreaterThanOrEqual(0);
    // Internal consistency: total = sum of parts.
    expect(insights.trainingEnrollments.total).toBe(
      insights.trainingEnrollments.requested + insights.trainingEnrollments.confirmed + insights.trainingEnrollments.waitlisted,
    );
    expect(insights.activeKnowledgeEntries).toBeLessThanOrEqual(insights.totalKnowledgeEntries);
  });

  it.skipIf(!hasCreds)("picks up the synthetic resolved knowledge hit written in beforeAll", async () => {
    const insights = await computeConciergeInsights();
    expect(insights.knowledgeCategoryQueryCounts.leave).toBeGreaterThanOrEqual(1);
    expect(insights.estimate.resolvedSelfServiceInteractions).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(!hasCreds)("the time-saved figure is an explicit, labeled estimate with a shown formula — not silently presented as measured", async () => {
    const insights = await computeConciergeInsights();
    expect(insights.estimate.minutesPerQueryAssumption).toBe(ESTIMATED_MINUTES_PER_SELF_SERVICE_QUERY);
    expect(insights.estimate.estimatedMinutesSaved).toBe(insights.estimate.resolvedSelfServiceInteractions * ESTIMATED_MINUTES_PER_SELF_SERVICE_QUERY);
    expect(insights.estimate.formula).toMatch(/estimated_minutes_saved/);
    expect(insights.estimate.formula).toMatch(/×/); // shows the actual multiplication, not just a bare number
  });
});

describe("computeKnowledgeGaps — surfaces the question, never sensitive raw content", () => {
  it.skipIf(!hasCreds)("includes the synthetic unanswered query written in beforeAll", async () => {
    const gaps = await computeKnowledgeGaps();
    const match = gaps.find((g) => g.query.includes("sabbatical program"));
    expect(match).toBeTruthy();
    expect(match?.status).toBe("unanswered");
  });

  it.skipIf(!hasCreds)("never returns an employee identifier, only the question text/status/date", async () => {
    const gaps = await computeKnowledgeGaps();
    for (const gap of gaps) {
      expect(Object.keys(gap).sort()).toEqual(["occurredAt", "query", "status"]);
      expect(gap.query.length).toBeLessThanOrEqual(120);
    }
  });

  it.skipIf(!hasCreds)("caps result size (does not attempt to return unbounded history)", async () => {
    const gaps = await computeKnowledgeGaps();
    expect(gaps.length).toBeLessThanOrEqual(25);
  });
});

describe("Concierge Insights — admin-only access is enforced by the permission model", () => {
  it("hr and admin roles can view Concierge Insights; finance and viewer cannot", () => {
    expect(can("admin", "concierge_insights.view")).toBe(true);
    expect(can("hr", "concierge_insights.view")).toBe(true);
    expect(can("finance", "concierge_insights.view")).toBe(false);
    expect(can("viewer", "concierge_insights.view")).toBe(false);
  });

  it("hr and admin roles can view/edit Employee Requests; finance and viewer cannot", () => {
    expect(can("admin", "employee_requests.view")).toBe(true);
    expect(can("hr", "employee_requests.edit")).toBe(true);
    expect(can("finance", "employee_requests.view")).toBe(false);
    expect(can("viewer", "employee_requests.edit")).toBe(false);
  });
});
