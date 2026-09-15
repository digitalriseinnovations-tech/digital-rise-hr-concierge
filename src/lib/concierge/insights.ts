import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Concierge Insights — the HR-admin "what is my HR AI Employee actually
 * handling" view (Slice 5, Part B). Deliberately lightweight aggregation,
 * not a metrics warehouse: every number here is computed directly from the
 * same structured data the product already writes for its own operation
 * (concierge_conversations, concierge_messages.tool_calls, hr_requests,
 * training_registrations, hr_knowledge_base) — no new event table, no
 * separate pipeline, nothing invented. If a metric can't be computed
 * reliably from what's actually captured, it is not included (see the
 * module-level comment on estimatedMinutesSaved for the one deliberate
 * exception, which is clearly labeled an estimate with its formula shown).
 *
 * Scale note: this reads the full concierge_messages table into memory to
 * parse tool_calls JSONB (PostgREST/Supabase-JS has no practical way to
 * query inside a JSONB array of objects), which is fine for a demo/
 * showcase project's message volume but would need a real aggregation
 * pipeline (or a materialized summary table) before this is safe at
 * production scale — documented, not hidden.
 */

interface StoredToolCall {
  toolName: string;
  output: unknown;
  isError: boolean;
}

interface RawMessage {
  conversation_id: string;
  role: "employee" | "assistant" | "system";
  content: string;
  tool_calls: StoredToolCall[] | null;
  created_at: string;
}

const KNOWLEDGE_LOOKUP_TOOLS = new Set([
  "search_hr_knowledge",
  "get_onboarding_information",
  "get_mentorship_information",
  "get_coaching_information",
]);

// Documented, explicit assumption behind the one estimate this module
// produces — never presented as measured. Adjust here if the business
// wants a different assumption; it is intentionally a single named
// constant, not a magic number buried in a calculation.
export const ESTIMATED_MINUTES_PER_SELF_SERVICE_QUERY = 4;

export interface ConciergeInsights {
  totalConversations: number;
  escalatedConversations: number;
  totalEmployeeMessages: number;
  totalToolActionsCompleted: number;
  leaveRequestsViaConcierge: number;
  trainingEnrollments: { requested: number; confirmed: number; waitlisted: number; total: number };
  mentorshipRequests: number;
  coachingRequests: number;
  hrEscalations: number;
  knowledgeCategoryQueryCounts: Record<string, number>;
  activeKnowledgeEntries: number;
  totalKnowledgeEntries: number;
  activeTrainingPrograms: number;
  estimate: {
    resolvedSelfServiceInteractions: number;
    minutesPerQueryAssumption: number;
    estimatedMinutesSaved: number;
    formula: string;
  };
}

function parseToolCalls(row: { tool_calls: unknown }): StoredToolCall[] {
  if (!Array.isArray(row.tool_calls)) return [];
  return row.tool_calls as StoredToolCall[];
}

export async function computeConciergeInsights(): Promise<ConciergeInsights> {
  const supabase = createServiceClient();

  const [{ data: conversations }, { data: messages }, { count: activeKnowledgeCount }, { count: totalKnowledgeCount }, { count: activeProgramCount }] =
    await Promise.all([
      supabase.from("concierge_conversations").select("id, status"),
      supabase.from("concierge_messages").select("conversation_id, role, content, tool_calls, created_at").order("created_at", { ascending: true }),
      supabase.from("hr_knowledge_base").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("hr_knowledge_base").select("id", { count: "exact", head: true }),
      supabase.from("training_programs").select("id", { count: "exact", head: true }).eq("active", true),
    ]);

  const escalatedConversationIds = new Set((conversations ?? []).filter((c) => c.status === "escalated").map((c) => c.id));
  const rows = (messages ?? []) as RawMessage[];

  let totalEmployeeMessages = 0;
  let totalToolActionsCompleted = 0;
  let leaveRequestsViaConcierge = 0;
  const trainingEnrollments = { requested: 0, confirmed: 0, waitlisted: 0, total: 0 };
  let mentorshipRequests = 0;
  let coachingRequests = 0;
  let hrEscalations = 0;
  const knowledgeCategoryQueryCounts: Record<string, number> = {};
  let resolvedSelfServiceInteractions = 0;

  for (const row of rows) {
    if (row.role === "employee") {
      totalEmployeeMessages++;
      continue;
    }
    if (row.role !== "assistant") continue;

    const calls = parseToolCalls(row);
    let messageHadResolvedKnowledgeHit = false;

    for (const call of calls) {
      if (!call.isError) totalToolActionsCompleted++;

      const output = call.output as Record<string, unknown> | null;

      if (call.toolName === "create_leave_request" && !call.isError && output?.status === "submitted") {
        leaveRequestsViaConcierge++;
      }
      if (call.toolName === "request_training_enrollment" && !call.isError) {
        if (output?.status === "requested") trainingEnrollments.requested++;
        if (output?.status === "confirmed") trainingEnrollments.confirmed++;
        if (output?.status === "waitlisted") trainingEnrollments.waitlisted++;
      }
      if (call.toolName === "create_mentorship_request" && !call.isError && output?.status === "submitted") {
        mentorshipRequests++;
      }
      if (call.toolName === "create_coaching_request" && !call.isError && output?.status === "submitted") {
        coachingRequests++;
      }
      if (call.toolName === "escalate_to_hr" && !call.isError) {
        hrEscalations++;
      }
      if (KNOWLEDGE_LOOKUP_TOOLS.has(call.toolName) && !call.isError) {
        const found = output?.found === true;
        if (found) {
          messageHadResolvedKnowledgeHit = true;
          const entries = Array.isArray(output?.entries) ? (output!.entries as Array<{ category?: string }>) : [];
          for (const entry of entries) {
            const category = entry.category ?? "unknown";
            knowledgeCategoryQueryCounts[category] = (knowledgeCategoryQueryCounts[category] ?? 0) + 1;
          }
        }
      }
    }

    // A resolved, self-service interaction: this assistant turn answered
    // from real knowledge AND its conversation was never escalated. Used
    // only for the labeled estimate below — never presented as a hard count
    // of "questions answered" on its own.
    if (messageHadResolvedKnowledgeHit && !escalatedConversationIds.has(row.conversation_id)) {
      resolvedSelfServiceInteractions++;
    }
  }

  trainingEnrollments.total = trainingEnrollments.requested + trainingEnrollments.confirmed + trainingEnrollments.waitlisted;

  return {
    totalConversations: (conversations ?? []).length,
    escalatedConversations: escalatedConversationIds.size,
    totalEmployeeMessages,
    totalToolActionsCompleted,
    leaveRequestsViaConcierge,
    trainingEnrollments,
    mentorshipRequests,
    coachingRequests,
    hrEscalations,
    knowledgeCategoryQueryCounts,
    activeKnowledgeEntries: activeKnowledgeCount ?? 0,
    totalKnowledgeEntries: totalKnowledgeCount ?? 0,
    activeTrainingPrograms: activeProgramCount ?? 0,
    estimate: {
      resolvedSelfServiceInteractions,
      minutesPerQueryAssumption: ESTIMATED_MINUTES_PER_SELF_SERVICE_QUERY,
      estimatedMinutesSaved: resolvedSelfServiceInteractions * ESTIMATED_MINUTES_PER_SELF_SERVICE_QUERY,
      formula: "estimated_minutes_saved = resolved_self_service_interactions × minutes_per_hr_query_assumption",
    },
  };
}

// ── Knowledge gaps ──────────────────────────────────────────────────────

export interface KnowledgeGapEntry {
  /** The employee's own question, truncated — never the full transcript. */
  query: string;
  status: "unanswered" | "escalated";
  occurredAt: string;
}

const MAX_GAP_QUERY_LENGTH = 120;
const MAX_GAP_ENTRIES = 25;

/**
 * "What do employees keep asking that our knowledge base can't answer?"
 * Built from two real signals already captured, nothing inferred beyond
 * them: (1) a knowledge-lookup tool call that returned found:false — the
 * employee's own immediately-preceding message is shown as the query,
 * truncated, never the full surrounding transcript; (2) an escalation to
 * HR, using its short non-sensitive category as the "query" label (the
 * escalation's free-text reason is deliberately NOT surfaced here — it can
 * legitimately contain sensitive personal content the HR knowledge-gap
 * view has no reason to display).
 */
export async function computeKnowledgeGaps(): Promise<KnowledgeGapEntry[]> {
  const supabase = createServiceClient();
  const { data: messages } = await supabase
    .from("concierge_messages")
    .select("conversation_id, role, content, tool_calls, created_at")
    .order("created_at", { ascending: true });

  const rows = (messages ?? []) as RawMessage[];
  const gaps: KnowledgeGapEntry[] = [];

  // Track the most recent employee message per conversation as we walk in
  // chronological order, so an unanswered-knowledge assistant turn can be
  // paired with the question that actually prompted it.
  const lastEmployeeMessageByConversation = new Map<string, string>();

  for (const row of rows) {
    if (row.role === "employee") {
      lastEmployeeMessageByConversation.set(row.conversation_id, row.content);
      continue;
    }
    if (row.role !== "assistant") continue;

    for (const call of parseToolCalls(row)) {
      const output = call.output as Record<string, unknown> | null;

      if (KNOWLEDGE_LOOKUP_TOOLS.has(call.toolName) && !call.isError && output?.found === false) {
        const query = lastEmployeeMessageByConversation.get(row.conversation_id);
        if (query) {
          gaps.push({ query: query.slice(0, MAX_GAP_QUERY_LENGTH), status: "unanswered", occurredAt: row.created_at });
        }
      }

      if (call.toolName === "escalate_to_hr" && !call.isError) {
        const query = lastEmployeeMessageByConversation.get(row.conversation_id);
        if (query) {
          gaps.push({ query: query.slice(0, MAX_GAP_QUERY_LENGTH), status: "escalated", occurredAt: row.created_at });
        }
      }
    }
  }

  return gaps.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).slice(0, MAX_GAP_ENTRIES);
}
